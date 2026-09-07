/**
 * backend/tests/helpers/serverProcess.js — start and stop a real backend for a test.
 *
 * WHY A CHILD PROCESS RATHER THAN IMPORTING THE APP
 *   Importing `app` and driving it in-process is faster, but it cannot test
 *   three of the things that matter most here:
 *
 *     1. The password-leak canary. That bug was in what the server WRITES TO
 *        STDOUT. You can only assert on that by owning the process's streams.
 *     2. Import-time crashes. `server.js` calls app.listen() at module scope,
 *        so "does it boot" is a question about running the real entry point.
 *        An in-process test that imported a hand-picked router would have
 *        happily passed while the actual server was unstartable — which is
 *        exactly the failure mode reported against this tree today.
 *     3. Per-scenario environment. NODE_ENV, CORS origins and Google
 *        credentials are read once at module load, so changing them means a
 *        fresh process, not a mutated `process.env`.
 *
 *   It also means the tests exercise the same command a developer runs, over
 *   real HTTP, with no test-only code path anywhere in `src/`. Nothing in the
 *   production tree knows these tests exist.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** backend/ — the directory `pnpm --filter 1on1-backend` would run in. */
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Ask the OS for a port nobody is using, by binding port 0 (which means "pick
 * one") and immediately releasing it.
 *
 * Hardcoding 5000 would make the suite fail whenever a dev server is already
 * running — and worse, could make tests talk to THAT server, reporting on code
 * that is not the code under test.
 *
 * There is a theoretical race between closing here and the child binding, but
 * the OS does not hand out the same ephemeral port twice in that window in
 * practice, and every server gets its own port so tests cannot collide.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Boot the real server and wait until it answers.
 *
 * @param {object}  options
 * @param {object}  options.env      extra env vars for this server only
 * @param {string?} options.preload  absolute path to a module to run via
 *                                   `--import` BEFORE src/server.js loads.
 *                                   Used to stub Google — see googleStub.js.
 */
export async function startServer({ env = {}, preload = null } = {}) {
  const port = await freePort();

  const args = [];
  // `--import` runs a module to completion before the entry point is loaded,
  // which is the only reliable moment to replace a global the app will capture.
  if (preload) args.push('--import', pathToFileURL(preload).href);
  args.push('src/server.js');

  const child = spawn(process.execPath, args, {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      // Pinned so tokens are stable and the boot warning does not appear.
      JWT_ACCESS_SECRET: 'test-only-secret-not-used-anywhere-real',
      // Explicit, so a repo-root .env appearing later cannot change what the
      // tests are testing. dotenv does not overwrite an already-set variable.
      GOOGLE_OAUTH_CLIENT_ID: '',
      GOOGLE_OAUTH_CLIENT_SECRET: '',
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
      FRONTEND_URL: 'http://localhost:3000',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Everything the server writes, in order. This is what the canary test reads.
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  let exited = null;
  child.on('exit', (code, signal) => { exited = { code, signal }; });

  const baseUrl = `http://127.0.0.1:${port}`;

  // Poll rather than sleep. A fixed sleep is either flaky (too short) or slow
  // (too long); polling is both faster and more reliable. Bail out early if the
  // process dies, so an import-time crash surfaces as a clear message here
  // instead of a 10-second timeout with no explanation.
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (exited) {
      throw new Error(
        `server exited during startup (code ${exited.code}). Output:\n${output}`
      );
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`server did not become ready within 15s. Output:\n${output}`);
    }
    try {
      const probe = await fetch(`${baseUrl}/api/health`);
      if (probe.ok) break;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  return {
    baseUrl,
    /** Everything written to stdout+stderr so far. */
    output: () => output,
    async stop() {
      if (exited) return;
      child.kill();
      // Give it a moment to go down so the port is released before the next test.
      const until = Date.now() + 5_000;
      while (!exited && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 25));
      }
      if (!exited) child.kill('SIGKILL');
    },
  };
}

/**
 * Start a server that is EXPECTED to die, and report how. Used for the
 * production guard, where refusing to boot is the correct behaviour and a
 * successful start is the failure.
 */
export async function startServerExpectingExit({ env = {} } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, PORT: String(port), JWT_ACCESS_SECRET: 'test-only-secret', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (c) => { output += c; });
  child.stderr.on('data', (c) => { output += c; });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, output, timedOut: true });
    }, 15_000);

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut: false });
    });
  });
}

/**
 * Minimal cookie handling — a tiny cookie jar, so tests can follow a session
 * the way a browser would without pulling in a dependency.
 *
 * Deliberately naive: it keeps name=value pairs and ignores attributes. That is
 * enough to REPLAY cookies, and the attributes themselves (HttpOnly, SameSite)
 * are asserted directly against the raw Set-Cookie header instead, which is
 * what those tests actually care about.
 */
export function parseSetCookie(response) {
  // getSetCookie() returns every Set-Cookie header separately; a plain get()
  // would join them into one string and make multi-cookie responses (the Google
  // handshake sets two) impossible to read correctly.
  return response.headers.getSetCookie?.() ?? [];
}

export function cookieHeaderFrom(setCookies) {
  return setCookies.map((line) => line.split(';')[0]).join('; ');
}

/** Pull one cookie's value out of a Set-Cookie list. */
export function cookieValue(setCookies, name) {
  const line = setCookies.find((c) => c.startsWith(`${name}=`));
  if (!line) return null;
  return line.split(';')[0].slice(name.length + 1);
}

/** Unique email per test, so tests never collide in the shared in-memory store. */
let counter = 0;
export function uniqueEmail(label = 'user') {
  counter += 1;
  return `${label}-${process.pid}-${counter}@example.com`;
}

/**
 * Pack an identity into a fake Google authorization code.
 *
 * Lives here rather than in googleStub.js on purpose: that module replaces
 * `globalThis.fetch` as a side effect of being imported, which is correct in
 * the server child process and wrong in the test process. This is the one piece
 * both sides need, so it is kept where importing it is harmless. The decoder is
 * `decodeIdentity()` in googleStub.js — keep the two in step.
 *
 * @param {object} identity
 * @param {string}  identity.sub            Google's stable account id
 * @param {string}  identity.email
 * @param {boolean} identity.emailVerified  the account-linking hinge
 * @param {string} [identity.name]
 * @param {number} [identity.tokenStatus]   force this HTTP status from /token
 * @param {boolean}[identity.wrongAudience] sign for a different `aud`
 * @param {boolean}[identity.omitIdToken]   answer 200 with no id_token
 */
export function encodeIdentity(identity) {
  return Buffer.from(JSON.stringify(identity), 'utf8').toString('base64url');
}

export async function postJson(baseUrl, path, body, extraHeaders = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    redirect: 'manual',
  });
}
