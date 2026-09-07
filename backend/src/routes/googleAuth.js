/**
 * backend/src/routes/googleAuth.js — the two browser-facing Google endpoints.
 *
 *   GET /api/auth/google           302 -> accounts.google.com
 *   GET /api/auth/google/callback  302 -> the frontend, with the session cookie set
 *
 * The route path is not arbitrary: googleAuthorizeUrl() in
 * frontend/src/lib/api.ts returns `${API_BASE}/api/auth/google`, and
 * AuthShell.tsx does window.location.assign() on it. This file matches that
 * exactly, so no frontend change is needed.
 *
 * These are GET routes that a BROWSER navigates to, not fetch() calls. Two
 * consequences shape everything below:
 *   * failures cannot return JSON — nobody would parse it. They redirect back
 *     to the frontend with an ?error= code, so the person lands on a real page.
 *   * no Authorization header is possible on a top-level navigation, which is
 *     why the state and PKCE values travel in cookies.
 *
 * HOW THE SESSION GETS TO THE FRONTEND
 *   The callback sets the same HTTP-only refresh cookie that password login
 *   sets, then redirects to the frontend root. No token ever appears in a URL.
 *   The frontend needs no new code to pick this up: AuthProvider in
 *   frontend/src/lib/auth.tsx already calls refreshSession() once on mount, and
 *   that call now finds a valid cookie and returns the access token and user.
 *   The comment in api.ts already describes this exact handshake.
 */
import crypto from 'crypto';
import { Router } from 'express';
import { asyncHandler } from '../lib/httpError.js';
import { config, isGoogleOAuthConfigured } from '../config/env.js';
import {
  buildAuthorizationUrl,
  createPkcePair,
  createState,
  exchangeCodeForTokens,
  verifyIdToken,
} from '../services/googleOAuth.js';
import { issueSession } from '../lib/session.js';
import * as users from '../repositories/userRepository.js';

export const googleAuthRouter = Router();

const STATE_COOKIE = 'g_oauth_state';
const VERIFIER_COOKIE = 'g_oauth_verifier';

/**
 * The state and PKCE cookies exist only for the seconds between leaving for
 * Google and coming back.
 *
 * sameSite 'lax' is REQUIRED here and is the subtle part: the callback arrives
 * as a top-level navigation from accounts.google.com, which is a cross-site
 * request. 'strict' would make the browser withhold these cookies on exactly
 * that request, and every sign-in would fail the state check with no obvious
 * cause. 'lax' sends cookies on top-level GET navigations, which is precisely
 * this case.
 *
 * The 10-minute lifetime bounds how long a half-finished attempt stays usable.
 */
function handshakeCookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: 'lax',
    path: '/api/auth/google', // also covers /api/auth/google/callback
    maxAge: 10 * 60 * 1000,
  };
}

function clearHandshakeCookies(res) {
  const { maxAge, ...options } = handshakeCookieOptions();
  res.clearCookie(STATE_COOKIE, options);
  res.clearCookie(VERIFIER_COOKIE, options);
}

/**
 * Send the browser back to the frontend with a machine-readable reason.
 *
 * The codes are deliberately coarse and non-specific. A precise message
 * ("no account with that email", "that address is registered with a password")
 * would tell an attacker probing with their own Google account which of our
 * users exist — the same enumeration leak login is careful about. The detail
 * goes to the server log instead.
 */
function failRedirect(res, code) {
  clearHandshakeCookies(res);
  res.redirect(`${config.frontendUrl}/login?error=${encodeURIComponent(code)}`);
}

/* -------------------------------------------------------------------------- */
/* GET /api/auth/google — start the handshake                                  */
/* -------------------------------------------------------------------------- */
googleAuthRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    /**
     * Google sign-in is optional and additive: the app must run fine with no
     * Google credentials configured. 503 rather than 500 because this is
     * "capability not enabled here", not "the server broke" — and it makes a
     * missing .env obvious the moment someone clicks the button.
     */
    if (!isGoogleOAuthConfigured) {
      return res
        .status(503)
        .json({ message: 'Google sign-in is not configured on this server.' });
    }

    const state = createState();
    const { verifier, challenge } = createPkcePair();

    /**
     * STATE IS THE CSRF DEFENCE, and it works because of what an attacker
     * cannot do. They can trick your browser into visiting our callback URL
     * carrying THEIR authorization code — which, without this check, would
     * quietly sign you into the attacker's account, so that everything you then
     * do in "your" session is visible in their Google-linked profile. What they
     * cannot do is set a cookie on our origin. So we require the state in the
     * URL to match the state in a cookie only we could have set. A forged
     * callback has one and not the other.
     *
     * Keeping state in a cookie rather than server memory is what makes this
     * survive a nodemon restart mid-handshake, and what makes it work if this
     * ever runs as more than one instance behind a load balancer.
     */
    res.cookie(STATE_COOKIE, state, handshakeCookieOptions());
    res.cookie(VERIFIER_COOKIE, verifier, handshakeCookieOptions());

    res.redirect(buildAuthorizationUrl({ state, codeChallenge: challenge }));
  })
);

/* -------------------------------------------------------------------------- */
/* GET /api/auth/google/callback — finish the handshake                        */
/* -------------------------------------------------------------------------- */
googleAuthRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    if (!isGoogleOAuthConfigured) return failRedirect(res, 'google_unavailable');

    const { code, state, error: googleError } = req.query;

    // The person pressed "Cancel" on Google's consent screen. Not an error.
    if (googleError) return failRedirect(res, 'google_cancelled');

    const expectedState = req.cookies?.[STATE_COOKIE];
    const codeVerifier = req.cookies?.[VERIFIER_COOKIE];

    if (typeof code !== 'string' || typeof state !== 'string' || !expectedState || !codeVerifier) {
      console.warn('[google-oauth] callback missing code, state or handshake cookies');
      return failRedirect(res, 'google_failed');
    }

    if (!timingSafeEquals(state, expectedState)) {
      // Either a forged callback or a stale tab from an earlier attempt. Both
      // get rejected; the log line is what distinguishes them in practice.
      console.warn('[google-oauth] state mismatch — rejecting callback');
      return failRedirect(res, 'google_failed');
    }

    // The handshake values are single-use. Clear them before doing any work, so
    // they cannot be replayed even if a later step throws.
    clearHandshakeCookies(res);

    let identity;
    try {
      const tokens = await exchangeCodeForTokens({ code, codeVerifier });
      if (!tokens.id_token) throw new Error('Google response contained no id_token');
      identity = await verifyIdToken(tokens.id_token);
    } catch (problem) {
      // Logged in full server-side; the browser only learns that it failed.
      console.error('[google-oauth] could not verify Google identity:', problem.message);
      return failRedirect(res, 'google_failed');
    }

    if (!identity.email) {
      console.warn('[google-oauth] id_token carried no email claim');
      return failRedirect(res, 'google_failed');
    }

    const user = await findOrCreateGoogleUser(identity);
    if (!user) return failRedirect(res, 'google_email_unverified');

    // Same cookie, same token pair, same code path as a password login — a
    // Google session is not a second class of session.
    await issueSession(res, user);

    /**
     * Redirect to the frontend ROOT, not to a URL carrying a token. The browser
     * now holds the refresh cookie; AuthProvider mounts, calls refreshSession()
     * once, and gets the access token in a response body where it cannot leak
     * into history, logs or a Referer header.
     *
     * Landing on "/" matches what Login.tsx and Register.tsx do on success
     * (`navigate("/")`), so all three routes end in the same place.
     */
    res.redirect(config.frontendUrl);
  })
);

/**
 * =============================================================================
 * ACCOUNT LINKING — the security decision in this file
 * =============================================================================
 *
 * THE SITUATION
 *   Someone registered with teja@example.com and a password. Later they click
 *   "Continue with Google" and Google says "this is teja@example.com". Do we
 *   log them into the existing account?
 *
 * THE OPTIONS
 *   a) Always link on matching email. Best experience, and a vulnerability.
 *   b) Never link — create a second account. Safe, and terrible: the person now
 *      has two accounts, one holding all their data and one they cannot escape.
 *   c) Link ONLY when Google reports the email as VERIFIED.  <-- chosen
 *
 * WHY (a) IS A VULNERABILITY
 *   `email_verified: false` means Google is passing along an address it has NOT
 *   confirmed the account controls — it happens with some Workspace and
 *   federated setups. If we linked on the email alone, an attacker could stand
 *   up an account whose unverified address is teja@example.com, click Continue
 *   with Google, and be handed the real Teja's account. The email would be
 *   nothing more than a claim typed by the attacker, and we would be treating
 *   it as proof of identity. This is a well-documented real-world OAuth account
 *   takeover, not a theoretical one.
 *
 * WHY (c) IS SAFE
 *   `email_verified: true` means Google itself has confirmed control of that
 *   mailbox. That is the same evidence a "click the link we emailed you" flow
 *   would produce, arriving from a provider we have chosen to trust. Linking on
 *   it is equivalent in strength to email verification, which is the standard
 *   bar for merging two identities.
 *
 * WHAT HAPPENS WHEN GOOGLE SAYS UNVERIFIED
 *   The sign-in is refused outright, and no account is created either. Creating
 *   one would be its own problem: it would squat on an address its owner has
 *   not proven, and the real owner would later hit a 409 on registration and be
 *   locked out of their own email address. Refusing is the only option that
 *   cannot be abused; in practice it is rare, since consumer Google accounts
 *   report verified.
 *
 * THE REMAINING GAP, STATED PLAINLY
 *   Linking happens silently. Best practice is to also email the account owner
 *   ("Google sign-in was added to your account"), so an unexpected link is
 *   visible to them. That needs an email pipeline this app does not have yet —
 *   TODO once it does.
 * =============================================================================
 */
async function findOrCreateGoogleUser(identity) {
  // 1. Returning Google user. Matched on `sub`, never on email — see the note
  //    on googleId in services/googleOAuth.js.
  const byGoogleId = await users.findByGoogleId(identity.googleId);
  if (byGoogleId) return byGoogleId;

  // Everything past this point relies on the email, so the verified claim is
  // the gate for all of it.
  if (!identity.emailVerified) {
    console.warn('[google-oauth] refusing sign-in: Google reports email unverified');
    return null;
  }

  // 2. Existing account with this address -> LINK rather than duplicate.
  const byEmail = await users.findByEmail(identity.email);
  if (byEmail) {
    return users.linkGoogleAccount(byEmail.id, identity.googleId, {
      // Google has proven the address, which is stronger evidence than the
      // UNVERIFIED a password registration leaves behind. Upgrade it.
      verificationStatus: 'VERIFIED',
    });
  }

  // 3. Brand new person.
  return users.createUser({
    email: identity.email,
    // Google's `name` can be absent on a minimal profile; fall back to the
    // email local part so fullName is never empty in the UI.
    fullName: identity.fullName || identity.email.split('@')[0],
    // No password, and that is a valid state — see the passwordHash comment in
    // repositories/userRepository.js. They sign in with Google or, later, use a
    // password-reset flow to add one.
    passwordHash: null,
    googleId: identity.googleId,
    authProvider: 'GOOGLE',
    verificationStatus: 'VERIFIED',
  });
}

/**
 * Constant-time string comparison for the state check.
 *
 * `a === b` on strings short-circuits at the first differing character, so how
 * long it takes leaks how many leading characters were right — enough, given
 * many attempts, to reconstruct a secret one character at a time.
 * timingSafeEqual always compares every byte. The length check in front is not
 * a leak: timingSafeEqual throws on mismatched lengths, and the length of a
 * state token is not secret.
 */
function timingSafeEquals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
