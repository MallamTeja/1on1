/**
 * backend/tests/helpers/googleStub.js — a fake Google, loaded before the app.
 *
 * HOW THIS WORKS, AND WHY IT TOUCHES NO PRODUCTION CODE
 *   Node's `--import` flag runs a module to completion BEFORE the entry point
 *   is loaded. That gives us the one moment where `globalThis.fetch` can be
 *   replaced such that every later module — ours and `jose`'s — sees the
 *   replacement, whether it calls fetch lazily or captured a reference at load.
 *
 *   So `src/services/googleOAuth.js` keeps its real, hardcoded Google URLs.
 *   There is no injectable endpoint, no `if (process.env.NODE_ENV === 'test')`,
 *   and no test-only export anywhere in src/. That matters: a configurable
 *   token URL would be a genuine security regression, since it is the endpoint
 *   the client secret is sent to. Testability is not worth that, and this
 *   technique means we do not have to trade one for the other.
 *
 * WHAT IT FAKES
 *   GET  https://www.googleapis.com/oauth2/v3/certs   -> a JWKS we control
 *   POST https://oauth2.googleapis.com/token          -> an ID token we sign
 *
 *   Because we sign with a key whose public half is served at the JWKS URL, the
 *   real verification path in googleOAuth.js runs for real: signature, issuer,
 *   audience and expiry are all genuinely checked. Only the network is fake.
 *
 * HOW A TEST CHOOSES WHICH PERSON IS SIGNING IN
 *   The identity rides inside the authorization CODE, as base64url JSON. That
 *   is a close analogue of the real thing — a Google code is likewise an opaque
 *   handle that only the token endpoint can turn into an identity — and it
 *   means one server process can serve many different sign-ins. Keying it off
 *   environment variables instead would pin one identity per process and make
 *   "same `sub`, different email" untestable without a restart.
 *
 *   Build one with encodeIdentity() below:
 *       { sub, email, emailVerified, name, tokenStatus, wrongAudience }
 */
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const KID = 'stub-key-1';

// One keypair for the life of the process. `extractable: true` is required or
// exportJWK() cannot produce the public half for the JWKS document.
const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });

const publicJwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' };

const realFetch = globalThis.fetch;

/** Decode the identity a test packed into the authorization code. */
function decodeIdentity(code) {
  try {
    return JSON.parse(Buffer.from(String(code), 'base64url').toString('utf8'));
  } catch {
    // A code the test did not build — e.g. the literal "bad-code" used to
    // exercise the exchange-failure path.
    return null;
  }
}

async function makeIdToken(identity) {
  const audience = identity.wrongAudience
    ? 'some-other-app.apps.googleusercontent.com'
    : process.env.GOOGLE_OAUTH_CLIENT_ID;

  const claims = {
    email: identity.email,
    // Sent as a real boolean. googleOAuth.js checks `=== true` precisely
    // because the STRING "false" is truthy in JavaScript.
    email_verified: identity.emailVerified === true,
  };
  if (identity.name) claims.name = identity.name;

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setSubject(identity.sub || 'stub-sub-default')
    .setIssuer('https://accounts.google.com')
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);

  if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) {
    return json({ keys: [publicJwk] });
  }

  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    // googleOAuth.js posts form-encoded, so the body is URLSearchParams.
    const params = new URLSearchParams(String(init?.body ?? ''));
    const identity = decodeIdentity(params.get('code'));

    // An unrecognised code is what Google answers with `invalid_grant` for an
    // expired, forged or already-redeemed code.
    if (!identity) return json({ error: 'invalid_grant' }, 400);
    if (identity.tokenStatus) return json({ error: 'invalid_grant' }, identity.tokenStatus);
    // Lets a test cover "Google answered 200 but sent no id_token".
    if (identity.omitIdToken) return json({ access_token: 'x', token_type: 'Bearer' });

    return json({
      access_token: 'stub-access-token',
      token_type: 'Bearer',
      expires_in: 3599,
      id_token: await makeIdToken(identity),
    });
  }

  // Anything else is a genuine outbound call the tests did not anticipate.
  // Loudly refusing rather than passing through keeps the suite hermetic: a
  // test that starts depending on the real internet should fail, not pass
  // slowly and then fail on a plane.
  if (/^https?:\/\//.test(url) && !url.includes('127.0.0.1') && !url.includes('localhost')) {
    throw new Error(`googleStub: blocked unexpected outbound request to ${url}`);
  }

  return realFetch(input, init);
};
