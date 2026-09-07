/**
 * backend/tests/security.test.js — regressions and boundaries.
 *
 * The first two suites here pin bugs that were REAL and were found in this
 * codebase on 2026-09-06 during manual testing. A bug found once and not
 * pinned by a test comes back, usually during a tidy-up that looks harmless.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer,
  startServerExpectingExit,
  uniqueEmail,
  postJson,
} from './helpers/serverProcess.js';

/* ========================================================================== */
/* REGRESSION 1 — stack traces must not ride out on client errors             */
/* ========================================================================== */
describe('regression: error responses do not leak internals', () => {
  let server;
  let base;

  before(async () => { server = await startServer(); base = server.baseUrl; });
  after(async () => { await server?.stop(); });

  test('malformed JSON returns 400 with NO stack trace in the body', async () => {
    /**
     * THE BUG: the error handler attached `err.stack` to any error it had not
     * raised itself. express.json() throws a SyntaxError on a malformed body,
     * which is a CLIENT mistake — but it is not an HttpError, so it fell into
     * the "unexpected crash" branch and shipped a stack trace to the browser.
     *
     * The stack named absolute filesystem paths, the OneDrive directory layout
     * and pinned dependency versions, all to an unauthenticated caller.
     *
     * THE FIX: gate the stack on `status === 500`, not on "did we raise this".
     */
    const response = await postJson(base, '/api/auth/login', '{"email":"a@b.com",');

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.message, 'Request body is not valid JSON.');
    assert.equal(body.stack, undefined, 'a 400 response carried a stack trace');

    const raw = JSON.stringify(body);
    assert.doesNotMatch(raw, /node_modules/);
    assert.doesNotMatch(raw, /C:\\\\|\/Users\//);
    assert.doesNotMatch(raw, /body-parser/);
  });

  test('a 4xx from our own validation carries no stack either', async () => {
    const response = await postJson(base, '/api/auth/register', { email: 'nope' });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).stack, undefined);
  });

  test('error bodies always have a `message` string', async () => {
    // frontend/src/lib/api.ts reads `.message` to build its ApiError. A body
    // without one degrades every error in the UI to "Request failed with 4xx".
    for (const [path, body] of [
      ['/api/auth/login', { email: 'x@y.com', password: 'wrong' }],
      ['/api/auth/register', { email: 'bad' }],
      ['/api/auth/refresh', undefined],
    ]) {
      const response = await postJson(base, path, body ?? {});
      assert.equal(typeof (await response.json()).message, 'string');
    }
  });
});

/* ========================================================================== */
/* REGRESSION 2 — the password canary                                         */
/* ========================================================================== */
describe('regression: passwords never reach the logs', () => {
  let server;

  before(async () => { server = await startServer(); });
  after(async () => { await server?.stop(); });

  test('a malformed login body does not write the password to stdout/stderr', async () => {
    /**
     * THE BUG, AND WHY IT IS THE MOST IMPORTANT TEST IN THIS FILE.
     *
     * body-parser attaches the RAW REQUEST BODY to the SyntaxError it throws,
     * as `err.body`. The error handler logged with `console.error(msg, err)`,
     * which prints the whole object — so a malformed POST /api/auth/login wrote
     * the user's password, in cleartext, to stdout. From there it goes wherever
     * logs go: CloudWatch, a terminal, a pasted issue, a screenshot. Log stores
     * are typically readable by far more people than the database is, and the
     * value persists long after the request.
     *
     * Nothing about `console.error(err)` looks dangerous, which is exactly why
     * this needs a test rather than a comment.
     *
     * !! DO NOT "SIMPLIFY" middleware/errorHandler.js BY PASSING `err` TO THE  !!
     * !! LOGGER ON THE MALFORMED-JSON PATH. THAT REINTRODUCES THE LEAK.        !!
     */
    const CANARY = 'CANARY-PASSWORD-DO-NOT-LOG-8f3a91';

    const response = await postJson(
      server.baseUrl,
      '/api/auth/login',
      `{"email":"canary@example.com","password":"${CANARY}"`
    );
    assert.equal(response.status, 400);

    // Logging is synchronous but the parent reads the pipe asynchronously, so
    // give the stream a moment to drain before asserting on its absence —
    // otherwise this test could pass simply by looking too early.
    await new Promise((r) => setTimeout(r, 250));

    const logs = server.output();
    // Prove we are looking at real output and not an empty string, or the
    // assertion below would be vacuously true.
    assert.match(logs, /malformed JSON body rejected/, 'the request was not logged at all');
    assert.ok(!logs.includes(CANARY), `the password appeared in the logs:\n${logs}`);
    assert.ok(!logs.includes('canary@example.com'), 'the raw request body reached the logs');
  });

  test('a wrong-password login does not log the attempted password', async () => {
    const CANARY = 'CANARY-WRONG-PASSWORD-2b7c04';
    const email = uniqueEmail('canary2');

    await postJson(server.baseUrl, '/api/auth/register', {
      fullName: 'Canary', email, password: 'a-valid-password-123',
    });
    await postJson(server.baseUrl, '/api/auth/login', { email, password: CANARY });

    await new Promise((r) => setTimeout(r, 250));
    assert.ok(!server.output().includes(CANARY));
  });
});

/* ========================================================================== */
/* CORS — the allowlist that makes cookie auth possible                       */
/* ========================================================================== */
describe('CORS allowlist', () => {
  let server;
  let base;

  before(async () => {
    server = await startServer({
      env: { CORS_ALLOWED_ORIGINS: 'http://localhost:3000,https://app.example.com' },
    });
    base = server.baseUrl;
  });
  after(async () => { await server?.stop(); });

  for (const origin of ['http://localhost:3000', 'https://app.example.com']) {
    test(`echoes the allowed origin ${origin} with credentials:true`, async () => {
      const response = await fetch(`${base}/api/health`, { headers: { Origin: origin } });
      // With credentials the server must name ONE origin. `*` is not merely
      // insecure here — the browser rejects the pairing outright, so every
      // credentialed call in frontend/src/lib/api.ts would fail.
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    });
  }

  test('omits the header entirely for a disallowed origin', async () => {
    const response = await fetch(`${base}/api/health`, {
      headers: { Origin: 'https://evil.example.com' },
    });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });

  test('never answers with a wildcard origin', async () => {
    const response = await fetch(`${base}/api/health`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
  });

  test('answers a credentialed preflight from an allowed origin', async () => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.ok(response.status === 204 || response.status === 200);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  });

  test('a request with no Origin header still works (curl, health checks)', async () => {
    // CORS is a browser mechanism. Rejecting origin-less requests would break
    // load-balancer probes and every server-to-server caller while protecting
    // nothing.
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
  });
});

/* ========================================================================== */
/* The in-memory store must never run in production                           */
/* ========================================================================== */
describe('production guard on the in-memory repository', () => {
  test('NODE_ENV=production refuses to boot', async () => {
    // Silently starting with a store that forgets every account on restart is
    // far worse than crashing on startup with a message that names the problem.
    const result = await startServerExpectingExit({ env: { NODE_ENV: 'production' } });

    assert.equal(result.timedOut, false, 'the server started in production mode');
    assert.notEqual(result.code, 0, 'the process should exit non-zero');
    assert.match(result.output, /in-memory store cannot run in production/);
  });

  test('NODE_ENV=production also requires a real JWT secret', async () => {
    // The dev fallback generates a random secret per process; in production
    // that would silently invalidate every token on each deploy.
    const result = await startServerExpectingExit({
      env: { NODE_ENV: 'production', JWT_ACCESS_SECRET: '' },
    });
    assert.notEqual(result.code, 0);
  });
});
