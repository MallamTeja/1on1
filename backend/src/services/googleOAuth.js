/**
 * =============================================================================
 * backend/src/services/googleOAuth.js — Google Sign-In, spoken directly
 * =============================================================================
 *
 * READ THIS FIRST — "GOOGLE OAUTH" IS NOT "HOSTING ON GCP"
 *   The project rule is that infrastructure is AWS-only, and this file does not
 *   bend it. Google here is an IDENTITY PROVIDER: this server makes two ordinary
 *   HTTPS calls to public endpoints at accounts.google.com to answer one
 *   question — "does this person control this Google account?" — and then
 *   stores its own user in its own database and issues its own tokens.
 *
 *   Nothing is hosted, deployed, billed or persisted on Google Cloud. There is
 *   deliberately no @google-cloud/* package, no Firebase, and no
 *   google-auth-library: the protocol is a redirect, one POST and a signature
 *   check, and doing it with `fetch` plus `jose` keeps the dependency surface
 *   at zero and makes every step of the flow visible in this file. Signing in
 *   with Google is exactly as much a GCP commitment as signing in with GitHub
 *   is an Azure commitment.
 *
 * THE FLOW — OAuth 2.0 AUTHORIZATION CODE GRANT (with PKCE)
 *   1. Browser hits GET /api/auth/google. We generate `state` and a PKCE
 *      verifier, stash both in short-lived cookies, and 302 the browser to
 *      Google.
 *   2. The person authenticates with Google. We never see their password —
 *      that is the entire value of federated identity.
 *   3. Google 302s the browser back to our redirect URI with a one-time `code`
 *      and the `state` we sent.
 *   4. We check `state` matches the cookie, then POST the code + client secret
 *      + PKCE verifier to Google server-to-server and get back an ID token.
 *   5. We verify the ID token's signature against Google's published keys, then
 *      trust its claims about who this is.
 *
 *   Why the round trip through a code instead of Google just handing the
 *   browser a token: the code is useless without the client secret, which lives
 *   only on this server. A token in a redirect URL would sit in browser
 *   history, in the Referer header and in every proxy log along the way.
 */
import crypto from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config/env.js';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Google's public signing keys, fetched lazily and cached by `jose`.
 *
 * Google ROTATES these keys every few weeks, which is why the JWKS URL is
 * fetched at runtime rather than a key being pasted into config. createRemote-
 * JWKSet handles the caching, the cache-control headers and the re-fetch when a
 * token arrives signed by a key id it has not seen — so key rotation is
 * invisible here instead of being a production outage every few weeks.
 *
 * Built once at module load: a new set per request would throw away the cache
 * and make an HTTPS round trip on every single sign-in.
 */
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs')
);

/** Google signs ID tokens with either spelling of the issuer. Both are valid. */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * PKCE — "Proof Key for Code Exchange" (RFC 7636).
 *
 * We generate a random `verifier`, send only its SHA-256 hash (the `challenge`)
 * to Google with the authorization request, and send the raw verifier later
 * when redeeming the code. Google checks they match, which proves the party
 * redeeming the code is the same party that requested it.
 *
 * PKCE was designed for mobile and single-page apps that cannot keep a secret.
 * This is a confidential client — we DO have a client secret — so it is not
 * strictly required. It is included anyway as defence in depth: it closes
 * authorization-code injection, where an attacker who intercepts a code from a
 * redirect (a shared machine, browser history, a leaky proxy) tries to redeem
 * it. Without the verifier, a stolen code is inert. It costs about ten lines.
 */
export function createPkcePair() {
  // 32 random bytes -> 43 base64url characters, inside the spec's 43-128 range.
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Opaque random value used to tie the callback back to the request that started it. */
export function createState() {
  return crypto.randomBytes(32).toString('base64url');
}

export function buildAuthorizationUrl({ state, codeChallenge }) {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    // Must match a URI registered in the Google console byte for byte, and
    // Google also compares it again at token-exchange time.
    redirect_uri: config.google.redirectUri,
    // "code" selects the authorization-code grant. The alternative ("token",
    // the implicit flow) puts an access token straight in the redirect URL and
    // is deprecated precisely because of that.
    response_type: 'code',
    /**
     * SCOPES — what we are asking for. Exactly three, and no more: `openid`
     * requests an ID token at all, `email` and `profile` add the address and
     * display name. We are not asking for Gmail, Drive, Calendar or contacts.
     * Requesting the minimum is both a privacy obligation and a conversion
     * concern — a long permissions screen is where people abandon a signup.
     */
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256', // never 'plain' — that sends the verifier itself
    /**
     * Ask Google to show the account chooser rather than silently reusing the
     * one session already signed in. On a shared computer, auto-selecting the
     * previous person's account is a real way to sign someone into the wrong
     * account without either of them noticing.
     */
    prompt: 'select_account',
  });

  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Step 4: redeem the one-time code. This is a BACK-CHANNEL call — server to
 * server over HTTPS, never through the browser — which is what lets us send the
 * client secret at all.
 */
export async function exchangeCodeForTokens({ code, codeVerifier }) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    // The token endpoint takes form encoding, not JSON. Sending JSON here gets
    // an "invalid_request" back with no hint as to why.
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    /**
     * The body here can echo request parameters back, so it is read for the
     * SERVER LOG only and never returned to the browser. Google's error codes
     * ("invalid_grant" for an expired or reused code, "redirect_uri_mismatch"
     * for a console misconfiguration) are the useful part when debugging.
     */
    const detail = await response.text().catch(() => '');
    throw new Error(`Google token exchange failed (${response.status}): ${detail}`);
  }

  return response.json();
}

/**
 * Step 5: verify the ID token — the step that actually makes any of this
 * trustworthy.
 *
 * An ID token is a JWT, which means it is a base64 string anyone can write. The
 * four checks below are what separate "Google says this is alice@gmail.com"
 * from "somebody typed alice@gmail.com into a JSON object":
 *
 *   SIGNATURE  verified against Google's published keys, so only Google could
 *              have produced it.
 *   ISSUER     `iss` is Google, not some other identity provider.
 *   AUDIENCE   `aud` is OUR client id. This one is easy to skip and critical:
 *              without it, an ID token that Google legitimately issued to a
 *              DIFFERENT application would verify perfectly here, and anyone
 *              running any Google-integrated app could sign in as any of our
 *              users. This is the classic OAuth confused-deputy bug.
 *   EXPIRY     `exp`, enforced by jwtVerify by default.
 *
 * jwtVerify throws on any failure, and the caller turns that into a rejected
 * sign-in.
 */
export async function verifyIdToken(idToken) {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUERS,
    audience: config.google.clientId,
  });

  return {
    /**
     * `sub` — Google's permanent, unique id for this account. THIS is the
     * identity to store and match on, not the email address. An email can be
     * changed by its owner, and a Workspace address can be deleted and later
     * reassigned to a different employee; `sub` never changes and is never
     * reused. Keying accounts on email is how someone eventually inherits a
     * stranger's account along with their old address.
     */
    googleId: payload.sub,
    email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
    /**
     * Whether GOOGLE has verified the address, which is a different claim from
     * "the address is present". See the account-linking decision in
     * routes/googleAuth.js — this boolean is the hinge the whole thing turns on.
     */
    emailVerified: payload.email_verified === true,
    fullName: typeof payload.name === 'string' ? payload.name : null,
  };
}
