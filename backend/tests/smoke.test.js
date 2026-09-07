/**
 * backend/tests/smoke.test.js — does the thing start?
 *
 * THIS FILE EXISTS BECAUSE OF A REAL INCIDENT. On 2026-09-06 a peer reading
 * this tree reported that server.js failed to import with
 * "fileURLToPath is not defined" and that the routers were imported but never
 * mounted. Both were true of a mid-edit snapshot and neither survived, but
 * nothing in the repo could have told the difference — the only evidence either
 * way was a human running curl by hand.
 *
 * An import-time crash is the cheapest possible failure to catch and the most
 * embarrassing to ship: every other test in the suite is meaningless if the
 * process cannot reach `app.listen`. So this runs first and asserts the boring
 * things — it boots, it says so, and the routes are actually MOUNTED rather
 * than merely imported. An unused import is silent; only `app.use` makes a
 * route reachable, and only a request proves `app.use` ran.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/serverProcess.js';

describe('smoke: the server boots and its routers are mounted', () => {
  let server;

  before(async () => {
    // startServer() throws with the captured output if the process dies during
    // startup, so an import-time error fails here with the real stack rather
    // than as an inscrutable connection refused.
    server = await startServer();
  });

  after(async () => { await server?.stop(); });

  test('boots with no import-time error and logs its port', () => {
    const output = server.output();
    assert.match(output, /Backend server is running on http:\/\/localhost:\d+/);
    assert.doesNotMatch(output, /is not defined/);
    assert.doesNotMatch(output, /Cannot find module/);
    assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND/);
  });

  test('prints a config summary that never contains a secret value', () => {
    const output = server.output();
    assert.match(output, /\[config\] env=development/);
    // The JWT secret the harness injects must appear nowhere in the logs.
    assert.doesNotMatch(output, /test-only-secret-not-used-anywhere-real/);
  });

  test('GET /api/health answers 200', async () => {
    const response = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'ok');
  });

  // Each of these proves a specific `app.use(...)` line actually executed. They
  // assert "not 404" rather than a success code, because reaching the handler
  // at all is the thing being tested — a 401 or 400 from a mounted router is a
  // pass here, while a 404 means the router was never wired in.
  for (const [method, path] of [
    ['POST', '/api/auth/register'],
    ['POST', '/api/auth/login'],
    ['POST', '/api/auth/refresh'],
    ['POST', '/api/auth/logout'],
    ['GET', '/api/auth/me'],
    ['GET', '/api/auth/google'],
    ['GET', '/api/auth/google/callback'],
  ]) {
    test(`${method} ${path} is mounted (does not 404)`, async () => {
      const response = await fetch(`${server.baseUrl}${path}`, {
        method,
        redirect: 'manual',
      });
      assert.notEqual(
        response.status,
        404,
        `${path} returned 404 — the router is imported but not mounted`
      );
    });
  }

  test('an unknown route still 404s, as JSON rather than HTML', async () => {
    const response = await fetch(`${server.baseUrl}/api/definitely-not-a-route`);
    assert.equal(response.status, 404);
    // frontend/src/lib/api.ts parses error bodies as JSON to read `.message`.
    // Express's built-in 404 is HTML and would break that.
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.match((await response.json()).message, /Cannot GET/);
  });
});
