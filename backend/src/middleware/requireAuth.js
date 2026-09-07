/**
 * backend/src/middleware/requireAuth.js — the gate every protected route sits
 * behind.
 *
 * Nothing in the app is protected yet beyond GET /api/auth/me, but this is the
 * piece the feed, profile and meeting-room routes will all reuse, and having it
 * now is what makes the access token verifiable end to end instead of a value
 * nobody ever checks.
 *
 * Usage:  router.get('/thing', requireAuth, handler)  ->  req.user is set.
 */
import { verifyAccessToken } from '../lib/tokens.js';
import { HttpError } from '../lib/httpError.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';

  // The scheme is case-insensitive per RFC 7235, so match it that way rather
  // than with `startsWith('Bearer ')` — some clients send "bearer".
  const [scheme, token] = header.split(' ');
  if (!token || scheme?.toLowerCase() !== 'bearer') {
    return next(new HttpError(401, 'Authentication required.'));
  }

  try {
    const payload = await verifyAccessToken(token);
    // Attached for downstream handlers. This is the DECODED TOKEN, not a
    // database record: it is whatever was true when the token was signed, up to
    // 15 minutes ago. A route that needs current data — a role check, a
    // suspended-account check — must load the user rather than trust these
    // claims. That staleness is the cost of stateless auth and the reason the
    // access token TTL is short.
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch {
    /**
     * Every verification failure collapses to the same 401 with the same
     * message. The reason is deliberate: telling a caller "token expired"
     * versus "bad signature" tells an attacker which half of a forgery attempt
     * was wrong, and turns the endpoint into an oracle for testing guesses. The
     * client cannot act differently on the two cases anyway — both mean
     * "refresh or sign in again".
     */
    return next(new HttpError(401, 'Session expired. Please sign in again.'));
  }
}
