/**
 * backend/src/lib/tokens.js — minting and checking the two tokens this app uses.
 *
 * THE TWO-TOKEN DESIGN (from docs/03-system-design.md)
 *
 *   ACCESS TOKEN — a short-lived signed JWT, returned in the response BODY and
 *   held by the browser in a plain JavaScript variable (see the header comment
 *   in frontend/src/lib/api.ts). It is a BEARER token: whoever holds it is
 *   treated as the user, and this server does not look it up anywhere — it only
 *   verifies the signature. That is what makes it fast, and also why it must be
 *   short-lived: there is no way to revoke one before it expires.
 *
 *   REFRESH TOKEN — a long-lived OPAQUE random string in an HTTP-only cookie.
 *   Not a JWT, and that is deliberate. It carries no claims, means nothing
 *   without the stored record it points at, and can therefore be revoked
 *   instantly by deleting that record. It is single-use and rotates on every
 *   refresh (see routes/auth.js).
 *
 * WHY THE SPLIT
 *   The access token cannot be stolen by an XSS payload reading localStorage,
 *   because it is never in localStorage. The refresh cookie cannot be read by
 *   JavaScript at all. Each token covers the other's weak spot: the readable
 *   one expires in minutes, and the durable one is invisible to script.
 *
 * WHY `jose` AND NOT `jsonwebtoken`
 *   Two jobs needed doing: signing our own HS256 tokens, and verifying Google's
 *   RS256 ID tokens against Google's rotating public keys. `jsonwebtoken` does
 *   only the first and needs a companion (`jwks-rsa`) for the second. `jose` is
 *   one zero-dependency library that does both, is built on Node's WebCrypto,
 *   and defaults to safe behaviour — notably it will not accept "alg: none" or
 *   let the token itself choose the algorithm, which is the classic JWT
 *   vulnerability.
 */
import crypto from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config/env.js';

/** HS256 needs raw bytes, not a JS string. Encoded once at module load. */
const ACCESS_SECRET = new TextEncoder().encode(config.accessTokenSecret);

/**
 * Issuer and audience are pinned on both sign and verify. It looks like
 * ceremony on a single-service app, but it is what stops a token minted by some
 * OTHER system that happens to share this secret from being accepted here.
 */
const ISSUER = '1on1-api';
const AUDIENCE = '1on1-app';

export async function signAccessToken(user) {
  return new SignJWT({
    // Claims kept to the minimum a request handler needs without a lookup.
    // A JWT is signed, NOT encrypted — anyone holding it can base64-decode the
    // payload and read every claim. Never put anything private in here.
    email: user.email,
    name: user.fullName,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id) // "sub" — the standard "who this token is about" claim
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${config.accessTokenTtlSeconds}s`)
    .sign(ACCESS_SECRET);
}

/**
 * Verifies signature, issuer, audience and expiry in one call. Throws on any
 * failure — middleware/requireAuth.js turns that into a 401.
 */
export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, ACCESS_SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return payload;
}

/**
 * A fresh opaque refresh token: 32 bytes from the OS CSPRNG, base64url encoded.
 *
 * `crypto.randomBytes` and NOT `Math.random()` — Math.random is a statistical
 * generator seeded from process state, and its output is predictable from
 * earlier outputs. Guessing a refresh token is a full account takeover, so this
 * needs the cryptographic generator. 32 bytes is 256 bits, which is not
 * brute-forceable.
 *
 * base64url rather than plain base64 because the value travels in a cookie: it
 * uses only letters, digits, underscore and hyphen, so there is no plus, slash
 * or equals sign to be mangled in transit.
 */
export function mintRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * What we actually STORE for a refresh token — never the token itself.
 *
 * Same reasoning as password hashing, one step weaker: if the session store
 * leaks, the attacker gets hashes, and a hash cannot be replayed as a cookie.
 * Plain SHA-256 with no salt and no cost factor is the RIGHT choice here (and
 * would be badly wrong for a password) because the input is already 256 bits of
 * uniform randomness — there is no dictionary to attack and nothing to slow
 * down.
 */
export function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiryDate() {
  const expires = new Date();
  expires.setDate(expires.getDate() + config.refreshTokenTtlDays);
  return expires;
}
