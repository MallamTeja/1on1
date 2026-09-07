/**
 * backend/src/routes/auth.js — email + password authentication.
 *
 * This is the AUTH CORE. Per docs/01-product-requirements.md, email+password is
 * the primary mechanism and everything else (Google, in ./googleAuth.js) is
 * optional and additive — this router must keep working on its own with no
 * Google credentials configured at all.
 *
 * Endpoints, all mounted under /api/auth by server.js:
 *   POST /register  201  -> AuthResponse   409 if the email is taken
 *   POST /login     200  -> AuthResponse   401 on bad credentials
 *   POST /refresh   200  -> AuthResponse   401 if the cookie is missing/stale
 *   POST /logout    204
 *   GET  /me        200  -> UserResponse   401 without a valid access token
 *
 * The statuses are a contract, not a preference: Register.tsx branches on 409
 * to show "An account already uses this email", and Login.tsx branches on 401.
 */
import { Router } from 'express';
import { asyncHandler, conflict, unauthorized, HttpError } from '../lib/httpError.js';
import { parseRegisterBody, parseLoginBody } from '../lib/validation.js';
import { hashPassword, verifyPassword, DUMMY_HASH } from '../lib/passwords.js';
import { hashRefreshToken } from '../lib/tokens.js';
import {
  issueSession,
  clearSessionCookie,
  toUserResponse,
  REFRESH_COOKIE,
} from '../lib/session.js';
import { requireAuth } from '../middleware/requireAuth.js';
import * as users from '../repositories/userRepository.js';

export const authRouter = Router();

/* -------------------------------------------------------------------------- */
/* POST /api/auth/register                                                     */
/* -------------------------------------------------------------------------- */
authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    // Throws a 400 with a specific message on any bad field. Validation happens
    // before anything touches the store, so a malformed request never gets as
    // far as a write.
    const { email, password, fullName } = parseRegisterBody(req.body);

    const existing = await users.findByEmail(email);
    if (existing) {
      /**
       * A DELIBERATE DISCLOSURE. Telling an anonymous caller that an address is
       * registered is user enumeration — the same leak login goes out of its
       * way to avoid. It is accepted here because the alternative is a
       * registration form that fails with no explanation, and because a signup
       * form is enumerable in practice no matter what you return.
       *
       * The real fix is to always answer 201 and send an email that says either
       * "confirm your account" or "you already have one" — the disclosure moves
       * to the inbox, which only the owner can read. That needs an email
       * pipeline this app does not have yet. Revisit when it does.
       */
      throw conflict('An account already uses this email.');
    }

    const user = await users.createUser({
      email,
      fullName,
      passwordHash: await hashPassword(password),
      googleId: null,
      authProvider: 'LOCAL',
      // No email-confirmation flow exists yet, so this is honest rather than
      // optimistic: the address is unproven until something proves it.
      verificationStatus: 'UNVERIFIED',
    });

    // 201 Created, not 200 — a new resource exists that did not before.
    res.status(201).json(await issueSession(res, user));
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/auth/login                                                        */
/* -------------------------------------------------------------------------- */
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = parseLoginBody(req.body);
    const user = await users.findByEmail(email);

    /**
     * Compare against a dummy hash when the user does not exist, so both paths
     * spend the same ~300ms in bcrypt. See the DUMMY_HASH comment in
     * lib/passwords.js for why an early return here would leak the membership
     * list to anyone with a stopwatch.
     *
     * `user.passwordHash` is null for an account created through Google that
     * has never set a password — fall through to the dummy hash there too, so
     * that case is indistinguishable from a wrong password. Saying "this
     * account uses Google" would confirm the address is registered.
     */
    const hash = user?.passwordHash || DUMMY_HASH;
    const passwordMatches = await verifyPassword(password, hash);

    if (!user || !user.passwordHash || !passwordMatches) {
      // ONE message for every failure mode: no such user, wrong password,
      // Google-only account. Any variation turns this into an oracle.
      throw unauthorized('Invalid email or password.');
    }

    res.json(await issueSession(res, user));
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/auth/refresh                                                      */
/* -------------------------------------------------------------------------- */
/**
 * Trade the HTTP-only refresh cookie for a new access token, ROTATING the
 * cookie in the process: the presented token is consumed and a brand-new one is
 * issued, so every refresh token is valid exactly once.
 *
 * WHY ROTATE
 *   A refresh token lives for 30 days. Without rotation, one stolen cookie is
 *   30 days of silent access. With rotation, the thief and the real user are
 *   racing: whoever refreshes second presents a token that has already been
 *   consumed and gets a 401. That does not prevent the theft, but it caps the
 *   damage and makes it detectable instead of indefinite.
 *
 * The client side of this contract is already built: the `started` ref in
 * frontend/src/lib/auth.tsx exists specifically so React StrictMode's double
 * mount cannot fire two concurrent refreshes, where the second would present
 * the token the first just consumed.
 */
authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE];
    if (!presented) {
      // The ordinary "not signed in" case — a first-time visitor has no cookie.
      // AuthProvider calls this on every mount and treats the rejection as
      // "signed out", so this path is normal traffic, not an error condition.
      throw new HttpError(401, 'Not signed in.');
    }

    // Looks the token up and deletes it in one step; returns null if it was
    // unknown, already used, or expired.
    const record = await users.consumeRefreshToken(hashRefreshToken(presented));
    if (!record) {
      clearSessionCookie(res);
      /**
       * A token that does not resolve is either expired, already rotated, or
       * forged. A hardened version treats "already rotated" as REUSE DETECTION
       * and revokes every session for that user, on the theory that a valid
       * token being presented twice means one of the two holders is a thief.
       * That needs the store to keep consumed tokens around long enough to
       * recognise them, so it is a decision for the real repository rather than
       * something to fake here. Flagged in userRepository.js.
       */
      throw new HttpError(401, 'Session expired. Please sign in again.');
    }

    const user = await users.findById(record.userId);
    if (!user) {
      // The token was valid but the account is gone (deleted, or — far more
      // likely right now — the in-memory store was wiped by a nodemon restart).
      clearSessionCookie(res);
      throw new HttpError(401, 'Session expired. Please sign in again.');
    }

    res.json(await issueSession(res, user));
  })
);

/* -------------------------------------------------------------------------- */
/* POST /api/auth/logout                                                       */
/* -------------------------------------------------------------------------- */
authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE];

    if (presented) {
      const record = await users.consumeRefreshToken(hashRefreshToken(presented));
      /**
       * Revoke EVERY session for the user, not just the one presented. Logging
       * out is the action a person takes on a shared or lost machine, and the
       * useful meaning of it there is "end my sessions", not "end this tab".
       * If per-device logout is wanted later it should be an explicit choice in
       * the UI, with this as the default.
       */
      if (record) await users.revokeRefreshTokensForUser(record.userId);
    }

    // Always clear the cookie and always answer 204, even with no cookie or an
    // unknown one. Logout has no failure mode worth reporting: every outcome
    // ends with the client signed out, and a 401 here would only ever confuse.
    clearSessionCookie(res);
    res.status(204).end();
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/auth/me                                                            */
/* -------------------------------------------------------------------------- */
/**
 * The current user, per the access token. Not used by the frontend yet — the
 * AuthResponse from refresh already carries `user` — but it is the endpoint
 * that proves the access token works, and the template every protected route
 * will follow.
 */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await users.findById(req.user.id);
    if (!user) throw new HttpError(401, 'Session expired. Please sign in again.');
    res.json(toUserResponse(user));
  })
);
