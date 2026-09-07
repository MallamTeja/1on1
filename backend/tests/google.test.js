/**
 * backend/tests/google.test.js — Google sign-in, entirely offline.
 *
 * HERMETIC BY CONSTRUCTION. `tests/helpers/googleStub.js` is loaded with
 * `--import` before the app starts and replaces `globalThis.fetch`, so the real
 * verification path runs for real — signature, issuer, audience and expiry are
 * all genuinely checked against a JWKS we serve — while nothing leaves the
 * machine. The stub throws on any unexpected outbound request, so a test that
 * accidentally starts depending on the internet fails rather than passing
 * slowly. No production code was changed to make this possible.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {
  startServer,
  parseSetCookie,
  cookieHeaderFrom,
  cookieValue,
  uniqueEmail,
  encodeIdentity,
  postJson,
} from './helpers/serverProcess.js';

const STUB = path.resolve(import.meta.dirname, 'helpers/googleStub.js');
const CLIENT_ID = 'stub-client.apps.googleusercontent.com';

const GOOGLE_ENV = {
  GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: 'stub-client-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:5000/api/auth/google/callback',
  FRONTEND_URL: 'http://localhost:3000',
};

/* ========================================================================== */
/* Not configured                                                             */
/* ========================================================================== */
describe('Google routes when no credentials are configured', () => {
  let server;
  before(async () => { server = await startServer(); }); // helper blanks the creds
  after(async () => { await server?.stop(); });

  test('GET /api/auth/google answers 503, not 500', async () => {
    // "Capability not enabled here", not "the server broke" — and it makes a
    // missing .env obvious the moment someone clicks the button.
    const response = await fetch(`${server.baseUrl}/api/auth/google`, { redirect: 'manual' });
    assert.equal(response.status, 503);
  });

  test('email+password auth is completely unaffected', async () => {
    // Google is optional and ADDITIVE. This is the test that keeps it so.
    const response = await postJson(server.baseUrl, '/api/auth/register', {
      fullName: 'No Google', email: uniqueEmail('nogoogle'), password: 'a-valid-password-123',
    });
    assert.equal(response.status, 201);
  });
});

/* ========================================================================== */
/* The authorize redirect                                                     */
/* ========================================================================== */
describe('GET /api/auth/google — the authorize redirect', () => {
  let server;
  let base;

  before(async () => {
    server = await startServer({ preload: STUB, env: GOOGLE_ENV });
    base = server.baseUrl;
  });
  after(async () => { await server?.stop(); });

  async function authorize() {
    const response = await fetch(`${base}/api/auth/google`, { redirect: 'manual' });
    const cookies = parseSetCookie(response);
    return {
      response,
      cookies,
      url: new URL(response.headers.get('location')),
      state: cookieValue(cookies, 'g_oauth_state'),
      verifier: cookieValue(cookies, 'g_oauth_verifier'),
    };
  }

  test('redirects to Google with every required parameter', async () => {
    const { response, url } = await authorize();
    assert.equal(response.status, 302);
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'http://localhost:5000/api/auth/google/callback'
    );
    assert.equal(url.searchParams.get('response_type'), 'code');
    // The authorization-code grant, never the implicit flow — "token" would put
    // a credential straight into the redirect URL.
    assert.notEqual(url.searchParams.get('response_type'), 'token');
  });

  test('requests only the three minimum scopes', async () => {
    const { url } = await authorize();
    const scopes = url.searchParams.get('scope').split(' ').sort();
    assert.deepEqual(scopes, ['email', 'openid', 'profile']);
  });

  test('asks for the account chooser rather than silently reusing a session', async () => {
    // On a shared computer, auto-selecting the previous person's account signs
    // someone into the wrong account without either of them noticing.
    const { url } = await authorize();
    assert.equal(url.searchParams.get('prompt'), 'select_account');
  });

  test('sets state and PKCE cookies, HttpOnly and short-lived', async () => {
    const { cookies } = await authorize();
    assert.equal(cookies.length, 2);
    for (const name of ['g_oauth_state', 'g_oauth_verifier']) {
      const cookie = cookies.find((c) => c.startsWith(`${name}=`));
      assert.ok(cookie, `${name} was not set`);
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
      // Lax is REQUIRED, not a preference: the callback arrives as a top-level
      // cross-site navigation from accounts.google.com, and Strict would make
      // the browser withhold these exact cookies on exactly that request.
      assert.doesNotMatch(cookie, /SameSite=Strict/i);
      assert.match(cookie, /Path=\/api\/auth\/google/);
      assert.match(cookie, /Max-Age=600/);
    }
  });

  test('state is unpredictable and different on every request', async () => {
    const first = await authorize();
    const second = await authorize();
    assert.notEqual(first.state, second.state);
    // 32 random bytes -> 43 base64url characters.
    assert.equal(first.state.length, 43);
  });

  test('the PKCE challenge really is S256 of the verifier cookie', async () => {
    // Proves the challenge is a genuine hash rather than a copy of the
    // verifier — sending the verifier as its own challenge (the "plain" method)
    // would make PKCE decorative.
    const { url, verifier } = await authorize();
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');

    const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
    assert.equal(url.searchParams.get('code_challenge'), expected);
    assert.notEqual(url.searchParams.get('code_challenge'), verifier);
  });

  test('the state in the URL matches the state in the cookie', async () => {
    const { url, state } = await authorize();
    assert.equal(url.searchParams.get('state'), state);
  });

  test('the client secret never appears in the redirect', async () => {
    const { response } = await authorize();
    assert.ok(!response.headers.get('location').includes('stub-client-secret'));
  });
});

/* ========================================================================== */
/* The callback                                                               */
/* ========================================================================== */
describe('GET /api/auth/google/callback', () => {
  let server;
  let base;

  before(async () => {
    server = await startServer({ preload: STUB, env: GOOGLE_ENV });
    base = server.baseUrl;
  });
  after(async () => { await server?.stop(); });

  /** Walk the authorize leg and return the handshake cookies + state. */
  async function beginHandshake() {
    const response = await fetch(`${base}/api/auth/google`, { redirect: 'manual' });
    const cookies = parseSetCookie(response);
    return { cookieHeader: cookieHeaderFrom(cookies), state: cookieValue(cookies, 'g_oauth_state') };
  }

  function callback(query, cookieHeader) {
    return fetch(`${base}/api/auth/google/callback?${query}`, {
      redirect: 'manual',
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
    });
  }

  /** Complete a whole sign-in and return the resulting session user. */
  async function signInWith(identity) {
    const { cookieHeader, state } = await beginHandshake();
    const response = await callback(
      `code=${encodeIdentity(identity)}&state=${state}`,
      cookieHeader
    );
    const session = parseSetCookie(response).find((c) => c.startsWith('refresh_token='));
    if (!session) return { response, user: null };

    const refreshed = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: session.split(';')[0] },
    });
    return { response, user: (await refreshed.json()).user };
  }

  /* ------------------------------------------------------ rejection paths */
  // Every one of these must REDIRECT, never 500. This is a browser navigation:
  // a JSON error body or a stack-trace page is not something a person can act on.

  const rejections = [
    ['no handshake cookies at all (forged callback)', () => ({ query: 'code=x&state=y', cookies: null }), 'google_failed'],
    ['the user pressed Cancel', () => ({ query: 'error=access_denied&state=y', cookies: null }), 'google_cancelled'],
    ['no code parameter', () => ({ query: 'state=y', cookies: null }), 'google_failed'],
  ];

  for (const [label, build, expectedCode] of rejections) {
    test(`redirects with ?error=${expectedCode} when ${label}`, async () => {
      const { query, cookies } = build();
      const response = await callback(query, cookies);
      assert.equal(response.status, 302);
      const location = new URL(response.headers.get('location'));
      assert.equal(location.origin + location.pathname, 'http://localhost:3000/login');
      assert.equal(location.searchParams.get('error'), expectedCode);
    });
  }

  test('CSRF: a mismatched state is rejected', async () => {
    // Without this check an attacker can complete the flow with THEIR code in
    // your browser, silently signing you into their account so that everything
    // you then do is visible in their profile.
    const { cookieHeader } = await beginHandshake();
    const response = await callback('code=x&state=attacker-chosen-state', cookieHeader);
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location'), /error=google_failed/);
  });

  test('CSRF: a SAME-LENGTH mismatched state is rejected without crashing', async () => {
    // crypto.timingSafeEqual throws on differing lengths, so the equal-length
    // case is the one that actually reaches the comparison. A naive guard that
    // only length-checks would pass the previous test and blow up here.
    const { cookieHeader, state } = await beginHandshake();
    const spoofed = state.split('').reverse().join('');
    assert.equal(spoofed.length, state.length);

    const response = await callback(`code=x&state=${spoofed}`, cookieHeader);
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location'), /error=google_failed/);
  });

  test('a failed token exchange redirects rather than 500s', async () => {
    const { cookieHeader, state } = await beginHandshake();
    const code = encodeIdentity({ sub: 'x', email: 'x@y.com', emailVerified: true, tokenStatus: 400 });
    const response = await callback(`code=${code}&state=${state}`, cookieHeader);
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location'), /error=google_failed/);
  });

  test('a 200 from Google with no id_token is rejected', async () => {
    const { cookieHeader, state } = await beginHandshake();
    const code = encodeIdentity({ sub: 'x', email: 'x@y.com', emailVerified: true, omitIdToken: true });
    const response = await callback(`code=${code}&state=${state}`, cookieHeader);
    assert.match(response.headers.get('location'), /error=google_failed/);
  });

  test('AUDIENCE: an ID token minted for a different app is rejected', async () => {
    /**
     * The confused-deputy bug, and the easiest check to forget. Without an
     * audience check, a token Google legitimately issued to some OTHER
     * application verifies perfectly here — so anyone running any
     * Google-integrated app could sign in as any of our users.
     *
     * The token in this test is genuinely signed by the same key and passes
     * signature, issuer and expiry. Only `aud` is wrong.
     */
    const { cookieHeader, state } = await beginHandshake();
    const code = encodeIdentity({
      sub: 'other-app-user', email: 'victim@example.com',
      emailVerified: true, wrongAudience: true,
    });
    const response = await callback(`code=${code}&state=${state}`, cookieHeader);
    assert.match(response.headers.get('location'), /error=google_failed/);
  });

  test('the callback clears the handshake cookies', async () => {
    /**
     * WHAT THIS DOES AND DOES NOT CLAIM — worth being precise, because an
     * earlier version of this test asserted the wrong thing and failed.
     *
     * It asserts our behaviour: the callback expires both handshake cookies, so
     * a browser that completed a sign-in cannot be walked back through the same
     * half-finished handshake. googleAuth.js clears them BEFORE the token
     * exchange, so they are gone even if a later step throws.
     *
     * It does NOT claim the server makes an authorization code single-use. It
     * cannot: the code is Google's, and Google is what refuses to redeem it
     * twice (`invalid_grant`). A test replaying a code against a stub that
     * happily re-issues tokens would be measuring the stub, not this codebase.
     * Our side of that contract — handling `invalid_grant` as a redirect rather
     * than a 500 — is covered by the failed-exchange test above.
     */
    const { cookieHeader, state } = await beginHandshake();
    const code = encodeIdentity({
      sub: `sub-clear-${Date.now()}`, email: uniqueEmail('clear'), emailVerified: true,
    });

    const response = await callback(`code=${code}&state=${state}`, cookieHeader);
    assert.equal(response.headers.get('location'), 'http://localhost:3000');

    const cleared = parseSetCookie(response);
    for (const name of ['g_oauth_state', 'g_oauth_verifier']) {
      const cookie = cleared.find((c) => c.startsWith(`${name}=`));
      assert.ok(cookie, `${name} was not cleared by the callback`);
      assert.match(cookie, /Expires=Thu, 01 Jan 1970/i);
    }
  });

  /* ---------------------------------------------------------- happy paths */

  test('a new verified Google user is created and signed in', async () => {
    const email = uniqueEmail('newgoogle');
    const { response, user } = await signInWith({
      sub: `sub-new-${Date.now()}`, email, emailVerified: true, name: 'New Person',
    });

    // Redirects to the frontend ROOT with no token in the URL — the session
    // travels in the HTTP-only cookie, and AuthProvider picks it up on mount.
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'http://localhost:3000');
    assert.ok(!response.headers.get('location').includes('token'));

    assert.equal(user.email, email);
    assert.equal(user.fullName, 'New Person');
    assert.equal(user.authProvider, 'GOOGLE');
    // Google has proven the address, which is the only email verification the
    // app currently has.
    assert.equal(user.verificationStatus, 'VERIFIED');
  });

  test('a missing name falls back to the email local part', async () => {
    const email = uniqueEmail('noname');
    const { user } = await signInWith({ sub: `sub-noname-${Date.now()}`, email, emailVerified: true });
    assert.equal(user.fullName, email.split('@')[0]);
  });

  test('IDENTITY IS MATCHED ON `sub`, NOT EMAIL', async () => {
    /**
     * The same Google account signing in after changing its email address must
     * land on the SAME user. Matching on email instead would create a second
     * account here — and, worse, would eventually hand someone a stranger's
     * account when a Workspace address is deleted and reassigned. `sub` is
     * permanent and never reused.
     */
    const sub = `sub-stable-${Date.now()}`;
    const first = await signInWith({ sub, email: uniqueEmail('before'), emailVerified: true });
    const second = await signInWith({ sub, email: uniqueEmail('after'), emailVerified: true });

    assert.equal(second.user.id, first.user.id, 'a changed email created a duplicate account');
  });

  test('LINKING: a verified Google email attaches to an existing password account', async () => {
    const email = uniqueEmail('link');
    const registered = await (await postJson(base, '/api/auth/register', {
      fullName: 'Password First', email, password: 'a-valid-password-123',
    })).json();
    assert.equal(registered.user.verificationStatus, 'UNVERIFIED');

    const { user } = await signInWith({ sub: `sub-link-${Date.now()}`, email, emailVerified: true });

    assert.equal(user.id, registered.user.id, 'linking created a duplicate account instead');
    // Provenance is preserved — the account was CREATED with a password.
    assert.equal(user.authProvider, 'LOCAL');
    // ...but Google proving the address upgrades the verification status.
    assert.equal(user.verificationStatus, 'VERIFIED');
  });

  test('after linking, the original password still works', async () => {
    // Google must be ADDITIVE. Linking that quietly disabled the password would
    // lock people out of their own accounts.
    const email = uniqueEmail('bothways');
    await postJson(base, '/api/auth/register', {
      fullName: 'Both Ways', email, password: 'a-valid-password-123',
    });
    await signInWith({ sub: `sub-both-${Date.now()}`, email, emailVerified: true });

    const login = await postJson(base, '/api/auth/login', {
      email, password: 'a-valid-password-123',
    });
    assert.equal(login.status, 200);
  });

  /* ------------------------------------------------- the linking security rule */

  test('UNVERIFIED EMAIL: refuses to link to an existing password account', async () => {
    /**
     * THE ACCOUNT-TAKEOVER THIS PREVENTS. `email_verified: false` means Google
     * is relaying an address it has NOT confirmed the account controls. If we
     * linked on the email alone, an attacker could put a victim's address on
     * their own Google account, click Continue with Google, and be handed the
     * victim's account — treating a self-asserted string as proof of identity.
     */
    const email = uniqueEmail('unverified');
    const registered = await (await postJson(base, '/api/auth/register', {
      fullName: 'Victim', email, password: 'a-valid-password-123',
    })).json();

    const { response } = await signInWith({
      sub: `sub-attacker-${Date.now()}`, email, emailVerified: false,
    });

    assert.equal(response.status, 302);
    assert.match(response.headers.get('location'), /error=google_email_unverified/);
    assert.equal(
      parseSetCookie(response).find((c) => c.startsWith('refresh_token=')),
      undefined,
      'a session was issued for an unverified Google email'
    );

    // The victim's own password login must be untouched.
    const login = await postJson(base, '/api/auth/login', {
      email, password: 'a-valid-password-123',
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.id, registered.user.id);
  });

  test('UNVERIFIED EMAIL: refuses to CREATE an account either', async () => {
    /**
     * The second-order half of the decision. Creating an account on an
     * unproven address would squat on it: the real owner would later hit a 409
     * on registration and be locked out of their own email address.
     */
    const email = uniqueEmail('squat');
    const { response } = await signInWith({
      sub: `sub-squat-${Date.now()}`, email, emailVerified: false,
    });
    assert.match(response.headers.get('location'), /error=google_email_unverified/);

    // Proof that nothing was created: the real owner can still register.
    const registration = await postJson(base, '/api/auth/register', {
      fullName: 'Real Owner', email, password: 'a-valid-password-123',
    });
    assert.equal(registration.status, 201, 'an unverified Google sign-in squatted on the email');
  });

  test('a Google-only account cannot be logged into with a guessed password', async () => {
    // Its passwordHash is null. That must read as "wrong password", never as a
    // 500 and never as a successful login.
    const email = uniqueEmail('googleonly');
    await signInWith({ sub: `sub-only-${Date.now()}`, email, emailVerified: true });

    const login = await postJson(base, '/api/auth/login', { email, password: 'anything-at-all' });
    assert.equal(login.status, 401);
    // Identical to any other failure — saying "this account uses Google" would
    // confirm the address is registered.
    assert.equal((await login.json()).message, 'Invalid email or password.');
  });

  test('the client secret never appears in any response to the browser', async () => {
    const { cookieHeader, state } = await beginHandshake();
    const code = encodeIdentity({
      sub: `sub-secret-${Date.now()}`, email: uniqueEmail('secret'), emailVerified: true,
    });
    const response = await callback(`code=${code}&state=${state}`, cookieHeader);

    const everything = [...response.headers.entries()].join(' ') + (await response.text());
    assert.ok(!everything.includes('stub-client-secret'));
  });
});
