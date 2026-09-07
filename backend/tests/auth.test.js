/**
 * backend/tests/auth.test.js — email + password auth, and the invariants the
 * frontend depends on.
 *
 * WHAT IS PRIORITISED HERE
 *   The happy path is the least valuable thing to test — it is the path every
 *   developer walks by hand anyway, and it fails loudly. What earns its keep is
 *   the behaviour that breaks SILENTLY:
 *
 *     * exact status codes, because the UI branches on the numbers (Register.tsx
 *       on 409, Login.tsx on 401). Change a 409 to a 400 and the pages still
 *       "work" — they just show the wrong message forever.
 *     * refresh-token rotation being single-use, which fails as random logouts
 *       rather than as an error.
 *     * cookie flags, which no request-level test would ever notice missing.
 *
 * ISOLATION
 *   The in-memory store persists for the life of the server process, so every
 *   test allocates its own email via uniqueEmail(). That gives real isolation
 *   without paying for a process restart per test — and unlike "reset the store
 *   between tests", it cannot be defeated by tests running in a different order.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer,
  parseSetCookie,
  cookieValue,
  uniqueEmail,
  postJson,
} from './helpers/serverProcess.js';

const PASSWORD = 'a-valid-password-123';

describe('email + password auth', () => {
  let server;
  let base;

  before(async () => {
    server = await startServer();
    base = server.baseUrl;
  });
  after(async () => { await server?.stop(); });

  /** Register a fresh account and hand back the response plus its cookies. */
  async function register(email, overrides = {}) {
    const response = await postJson(base, '/api/auth/register', {
      fullName: 'Test Person',
      email,
      password: PASSWORD,
      ...overrides,
    });
    return response;
  }

  /* ---------------------------------------------------------------- register */

  test('register returns 201 and an AuthResponse the frontend can consume', async () => {
    const email = uniqueEmail('reg');
    const response = await register(email);
    assert.equal(response.status, 201);

    const body = await response.json();
    // These four keys are the AuthResponse type in frontend/src/lib/types.ts.
    assert.equal(typeof body.accessToken, 'string');
    assert.equal(body.tokenType, 'Bearer');
    assert.equal(typeof body.expiresInSeconds, 'number');
    assert.deepEqual(Object.keys(body.user).sort(), [
      'authProvider', 'email', 'fullName', 'id', 'username', 'verificationStatus',
    ]);
    assert.equal(body.user.email, email);
    assert.equal(body.user.authProvider, 'LOCAL');
    assert.equal(body.user.verificationStatus, 'UNVERIFIED');
  });

  test('register never leaks the password hash or internal fields', async () => {
    const response = await register(uniqueEmail('leak'));
    const raw = await response.text();
    // The response shape is an allowlist in lib/session.js; this is the test
    // that keeps it one. A blocklist would leak the next field somebody adds.
    assert.doesNotMatch(raw, /passwordHash/);
    assert.doesNotMatch(raw, /googleId/);
    assert.doesNotMatch(raw, new RegExp(PASSWORD));
  });

  test('DUPLICATE EMAIL RETURNS 409 — Register.tsx branches on this exact code', async () => {
    const email = uniqueEmail('dup');
    assert.equal((await register(email)).status, 201);

    const second = await register(email);
    assert.equal(second.status, 409);
    assert.equal((await second.json()).message, 'An account already uses this email.');
  });

  test('duplicate detection is CASE-INSENSITIVE', async () => {
    // Without normalisation "A@x.com" and "a@x.com" become two accounts and the
    // 409 never fires — the classic account-duplication bug.
    const email = uniqueEmail('Case').replace('case', 'Case');
    assert.equal((await register(email.toUpperCase())).status, 201);
    assert.equal((await register(email.toLowerCase())).status, 409);
  });

  test('email is stored lowercased regardless of how it was typed', async () => {
    const email = uniqueEmail('mixed');
    const response = await register(email.toUpperCase());
    assert.equal((await response.json()).user.email, email.toLowerCase());
  });

  /* ------------------------------------------------------------- validation */

  const invalidBodies = [
    ['missing fullName', { email: 'a@b.com', password: PASSWORD }],
    ['blank fullName', { fullName: '   ', email: 'a@b.com', password: PASSWORD }],
    ['malformed email', { fullName: 'X', email: 'not-an-email', password: PASSWORD }],
    ['password under 8 chars', { fullName: 'X', email: 'a@b.com', password: 'short' }],
    ['password over 100 chars', { fullName: 'X', email: 'a@b.com', password: 'x'.repeat(101) }],
    ['fullName over 120 chars', { fullName: 'x'.repeat(121), email: 'a@b.com', password: PASSWORD }],
  ];

  for (const [label, body] of invalidBodies) {
    test(`register rejects ${label} with 400 and a message`, async () => {
      const response = await postJson(base, '/api/auth/register', body);
      assert.equal(response.status, 400);
      // The limits here mirror frontend/src/lib/validate.ts. If one side moves
      // and the other does not, this is where it shows up.
      assert.ok((await response.json()).message.length > 0);
    });
  }

  test('a JSON array body is rejected as 400, not a 500', async () => {
    const response = await postJson(base, '/api/auth/register', [1, 2, 3]);
    assert.equal(response.status, 400);
  });

  /* ------------------------------------------------------------------ login */

  test('login with correct credentials returns 200 and the same user id', async () => {
    const email = uniqueEmail('login');
    const registered = await (await register(email)).json();

    const response = await postJson(base, '/api/auth/login', { email, password: PASSWORD });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.id, registered.user.id);
  });

  test('BAD PASSWORD RETURNS 401 — Login.tsx branches on this exact code', async () => {
    const email = uniqueEmail('badpw');
    await register(email);

    const response = await postJson(base, '/api/auth/login', { email, password: 'wrong-password' });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).message, 'Invalid email or password.');
  });

  test('an unknown email returns the IDENTICAL 401 body as a wrong password', async () => {
    // Any difference between these two is a user-enumeration oracle: it would
    // let anyone ask "is this person a member?" and read the answer.
    const known = uniqueEmail('enum');
    await register(known);

    const wrongPassword = await postJson(base, '/api/auth/login', { email: known, password: 'nope' });
    const unknownUser = await postJson(base, '/api/auth/login', {
      email: uniqueEmail('ghost'), password: 'nope',
    });

    assert.equal(wrongPassword.status, unknownUser.status);
    assert.deepEqual(await wrongPassword.json(), await unknownUser.json());
  });

  test('login is case-insensitive on the email', async () => {
    const email = uniqueEmail('logincase');
    await register(email);
    const response = await postJson(base, '/api/auth/login', {
      email: email.toUpperCase(),
      password: PASSWORD,
    });
    assert.equal(response.status, 200);
  });

  test('login does not apply the registration minimum length', async () => {
    // validateExistingPassword() on the client deliberately has no minimum, so
    // a short password must reach bcrypt and fail as 401, never as 400.
    const response = await postJson(base, '/api/auth/login', {
      email: uniqueEmail('shortpw'), password: 'x',
    });
    assert.equal(response.status, 401);
  });

  /* --------------------------------------------------------------- cookies */

  test('the refresh cookie is HttpOnly, SameSite=Lax and Path=/', async () => {
    const response = await register(uniqueEmail('cookie'));
    const cookies = parseSetCookie(response);
    const refresh = cookies.find((c) => c.startsWith('refresh_token='));

    assert.ok(refresh, 'no refresh_token cookie was set');
    // HttpOnly is what keeps an XSS payload from reading a durable credential.
    assert.match(refresh, /HttpOnly/i);
    assert.match(refresh, /SameSite=Lax/i);
    assert.match(refresh, /Path=\//);
    // Secure must be OFF here: NODE_ENV is development and the browser would
    // silently drop a Secure cookie over plain http://localhost.
    assert.doesNotMatch(refresh, /Secure/i);
  });

  test('the access token is in the BODY and never in a cookie', async () => {
    const response = await register(uniqueEmail('nobodytoken'));
    const body = await response.json();
    const cookies = parseSetCookie(response).join(' ; ');
    assert.ok(body.accessToken);
    assert.ok(
      !cookies.includes(body.accessToken),
      'the access token must not be placed in a cookie'
    );
  });

  /* --------------------------------------------------------------- refresh */

  test('refresh exchanges the cookie for a new access token', async () => {
    const email = uniqueEmail('refresh');
    const registered = await register(email);
    const cookie = parseSetCookie(registered)[0].split(';')[0];

    const response = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.email, email);
  });

  test('ROTATION: refresh issues a DIFFERENT cookie value', async () => {
    const registered = await register(uniqueEmail('rotate'));
    const first = cookieValue(parseSetCookie(registered), 'refresh_token');

    const refreshed = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `refresh_token=${first}` },
    });
    const second = cookieValue(parseSetCookie(refreshed), 'refresh_token');

    assert.ok(second, 'refresh did not set a new cookie');
    assert.notEqual(second, first, 'the refresh token was not rotated');
  });

  test('SINGLE USE: replaying a consumed refresh cookie returns 401', async () => {
    // The invariant that breaks silently. Without it, a stolen 30-day cookie is
    // 30 days of access; with it, the thief and the real user race and the
    // loser is locked out. It is also what the `started` ref in the frontend's
    // auth.tsx exists to protect, so a regression here logs users out at random.
    const registered = await register(uniqueEmail('replay'));
    const original = cookieValue(parseSetCookie(registered), 'refresh_token');

    const firstUse = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST', headers: { Cookie: `refresh_token=${original}` },
    });
    assert.equal(firstUse.status, 200, 'the first use should succeed');

    const replay = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST', headers: { Cookie: `refresh_token=${original}` },
    });
    assert.equal(replay.status, 401, 'a consumed refresh token was accepted twice');
  });

  test('refresh with no cookie returns 401 — the ordinary signed-out case', async () => {
    const response = await fetch(`${base}/api/auth/refresh`, { method: 'POST' });
    assert.equal(response.status, 401);
  });

  test('refresh with a forged cookie value returns 401', async () => {
    const response = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: 'refresh_token=totally-made-up-value' },
    });
    assert.equal(response.status, 401);
  });

  /* -------------------------------------------------------------------- me */

  test('GET /me returns the user for a valid access token', async () => {
    const email = uniqueEmail('me');
    const { accessToken, user } = await (await register(email)).json();

    const response = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).id, user.id);
  });

  test('GET /me accepts a lowercase "bearer" scheme', async () => {
    const { accessToken } = await (await register(uniqueEmail('scheme'))).json();
    const response = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `bearer ${accessToken}` },
    });
    assert.equal(response.status, 200);
  });

  for (const [label, headers] of [
    ['no Authorization header', {}],
    ['a malformed token', { Authorization: 'Bearer not.a.real.jwt' }],
    ['the wrong scheme', { Authorization: 'Basic abc123' }],
    ['an empty bearer', { Authorization: 'Bearer ' }],
  ]) {
    test(`GET /me returns 401 with ${label}`, async () => {
      const response = await fetch(`${base}/api/auth/me`, { headers });
      assert.equal(response.status, 401);
    });
  }

  test('a token signed with a different secret is rejected', async () => {
    // Proves the signature is actually verified rather than just decoded. The
    // payload here is well-formed and unexpired; only the signature is wrong.
    const forged =
      'eyJhbGciOiJIUzI1NiJ9.' +
      Buffer.from(JSON.stringify({
        sub: 'someone', iss: '1on1-api', aud: '1on1-app',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url') +
      '.bm90LWEtdmFsaWQtc2lnbmF0dXJl';

    const response = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${forged}` },
    });
    assert.equal(response.status, 401);
  });

  /* ---------------------------------------------------------------- logout */

  test('logout returns 204 and expires the cookie', async () => {
    const registered = await register(uniqueEmail('logout'));
    const cookie = cookieValue(parseSetCookie(registered), 'refresh_token');

    const response = await fetch(`${base}/api/auth/logout`, {
      method: 'POST', headers: { Cookie: `refresh_token=${cookie}` },
    });
    assert.equal(response.status, 204);

    const cleared = parseSetCookie(response).find((c) => c.startsWith('refresh_token='));
    assert.ok(cleared, 'logout did not send a clearing Set-Cookie');
    // The clearing cookie must carry the same flags or the browser will not
    // match it against the one it holds, and logout silently does nothing.
    assert.match(cleared, /HttpOnly/i);
    assert.match(cleared, /Expires=Thu, 01 Jan 1970/i);
  });

  test('LOGOUT REVOKES: the refresh cookie is dead afterwards', async () => {
    const registered = await register(uniqueEmail('revoke'));
    const cookie = cookieValue(parseSetCookie(registered), 'refresh_token');

    await fetch(`${base}/api/auth/logout`, {
      method: 'POST', headers: { Cookie: `refresh_token=${cookie}` },
    });

    const afterLogout = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST', headers: { Cookie: `refresh_token=${cookie}` },
    });
    assert.equal(afterLogout.status, 401, 'the refresh token survived logout');
  });

  test('logout revokes EVERY session, not just the one presented', async () => {
    // Logging out is what you do on a shared or lost machine; "end this tab" is
    // the wrong default meaning.
    const email = uniqueEmail('multi');
    const sessionA = cookieValue(parseSetCookie(await register(email)), 'refresh_token');
    const loginB = await postJson(base, '/api/auth/login', { email, password: PASSWORD });
    const sessionB = cookieValue(parseSetCookie(loginB), 'refresh_token');
    assert.notEqual(sessionA, sessionB);

    await fetch(`${base}/api/auth/logout`, {
      method: 'POST', headers: { Cookie: `refresh_token=${sessionA}` },
    });

    const other = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST', headers: { Cookie: `refresh_token=${sessionB}` },
    });
    assert.equal(other.status, 401, 'a second session survived logout');
  });

  test('logout with no cookie still returns 204', async () => {
    const response = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
    assert.equal(response.status, 204);
  });
});
