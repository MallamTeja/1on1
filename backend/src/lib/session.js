/**
 * backend/src/lib/session.js — the single place a signed-in session is created
 * or destroyed.
 *
 * Four different code paths hand a user a session: register, login, refresh and
 * the Google callback. If each set its own cookie, one of them would eventually
 * forget `httpOnly`, or use a different Max-Age, or return a response the
 * frontend cannot parse. So they all call issueSession() and none of them
 * touches res.cookie() directly.
 *
 * The shape returned here is the AuthResponse type in
 * frontend/src/lib/types.ts. Every field name below is load-bearing.
 */
import { config } from '../config/env.js';
import {
  mintRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryDate,
  signAccessToken,
} from './tokens.js';
import * as users from '../repositories/userRepository.js';

export const REFRESH_COOKIE = 'refresh_token';

/**
 * Cookie options, derived once so the flags cannot drift between call sites.
 *
 *   httpOnly  JavaScript cannot read this cookie — document.cookie simply does
 *             not show it. This is the entire reason the refresh token lives in
 *             a cookie rather than in the response body: an XSS payload on the
 *             page can call the API as the user while it runs, but it cannot
 *             exfiltrate a durable credential to keep using afterwards.
 *
 *   secure    HTTPS only. Off in local dev because the browser drops Secure
 *             cookies sent over plain http://localhost.
 *
 *   sameSite  'lax' means the browser will not attach this cookie to a
 *             cross-site POST — which is a free CSRF defence for the refresh
 *             endpoint, since a form auto-submitted from evil.com cannot make
 *             the browser include it. Lax DOES send the cookie on a top-level
 *             GET navigation, which is what makes the Google redirect work.
 *
 *   path      Deliberately '/' and not '/api/auth'. Narrowing the path is
 *             tempting, but the browser only sends a cookie whose path is a
 *             prefix of the request path, and any future endpoint that needs to
 *             see it would silently get nothing.
 */
function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: '/',
    maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000, // ms, not seconds
  };
}

/**
 * Strip a stored user record down to exactly what the client is allowed to see.
 *
 * This is an ALLOWLIST, not a blocklist, and that is the whole point: it names
 * the six fields to include rather than deleting the ones to hide. A blocklist
 * (`delete user.passwordHash`) leaks the next sensitive column somebody adds to
 * the record, because nobody remembers to update the delete list. Here, a new
 * field is invisible until someone deliberately adds it.
 */
export function toUserResponse(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    authProvider: user.authProvider,
    verificationStatus: user.verificationStatus,
  };
}

/**
 * Mint a new access token + refresh token pair, set the refresh cookie on the
 * response, and return the AuthResponse body.
 *
 * The caller decides what to do with the returned object: the JSON routes send
 * it, and the Google callback throws it away and redirects instead — it only
 * needs the cookie side effect.
 */
export async function issueSession(res, user) {
  const refreshToken = mintRefreshToken();

  // Only the HASH is stored; the raw token exists solely inside the cookie.
  await users.saveRefreshToken(
    user.id,
    hashRefreshToken(refreshToken),
    refreshTokenExpiryDate().toISOString()
  );

  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());

  return {
    accessToken: await signAccessToken(user),
    // "Bearer" tells the client how to present it: `Authorization: Bearer <t>`.
    // frontend/src/lib/api.ts hardcodes that prefix, so this is documentation
    // of an agreement rather than something the client reads — but it is the
    // agreed field, and an OAuth-shaped response is expected to carry it.
    tokenType: 'Bearer',
    expiresInSeconds: config.accessTokenTtlSeconds,
    user: toUserResponse(user),
  };
}

/**
 * Clear the cookie on the way out.
 *
 * res.clearCookie() works by setting the cookie to an empty value with an
 * expiry in the past, and the browser only matches that against the existing
 * cookie if the FLAGS LINE UP — same path, same sameSite, same secure. Passing
 * the same options object is not defensive coding, it is required; get it wrong
 * and logout appears to succeed while the cookie stays put.
 */
export function clearSessionCookie(res) {
  const { maxAge, ...options } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE, options);
}
