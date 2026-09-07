/**
 * backend/src/lib/validation.js — request-body validation for the auth routes.
 *
 * These limits are a DELIBERATE MIRROR of frontend/src/lib/validate.ts, which
 * documents them as "mirroring the Node API's request validation so the two
 * never disagree". This file is the authority half of that pair: the client
 * check only spares the user a round trip and is trivially bypassed with curl,
 * so the same rules must exist here or they are not rules at all.
 *
 * Written by hand rather than pulling in zod/joi: it is four fields, and the
 * dependency would be bigger than the code. Revisit that when the API grows a
 * dozen more request shapes.
 */
import { badRequest } from './httpError.js';

/** Kept numerically identical to LIMITS in frontend/src/lib/validate.ts. */
export const LIMITS = Object.freeze({
  emailMax: 255,
  passwordMin: 8,
  passwordMax: 100,
  fullNameMax: 120,
});

/** Same practical shape check the client uses: one @, no spaces, a dot in the domain. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Guards against `req.body` being undefined (no Content-Type header) or a
 * non-object (a bare JSON string/array), either of which would otherwise make
 * every field read below throw a TypeError and surface as a 500 instead of the
 * 400 it actually is.
 */
function fields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Expected a JSON object body.');
  }
  return body;
}

function requireString(body, key, label) {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${label} is required.`);
  }
  return value;
}

/**
 * Emails are stored and compared lowercased. Without this, "Teja@x.com" and
 * "teja@x.com" register as two separate accounts and the duplicate-email 409
 * never fires — the classic account-duplication bug. The domain half of an
 * email is case-insensitive by spec; the local part technically is not, but
 * every mail provider treats it that way, and matching that expectation beats
 * being pedantically correct and confusing users.
 */
export function normalizeEmail(raw) {
  return raw.trim().toLowerCase();
}

export function parseRegisterBody(rawBody) {
  const body = fields(rawBody);

  const email = normalizeEmail(requireString(body, 'email', 'Email'));
  if (!EMAIL_SHAPE.test(email)) throw badRequest('Enter a valid email address.');
  if (email.length > LIMITS.emailMax) {
    throw badRequest(`Email must be ${LIMITS.emailMax} characters or fewer.`);
  }

  // NOT trimmed: leading/trailing spaces are legitimate password characters,
  // and silently stripping them means the password you set is not the password
  // you typed. Only the *emptiness* check above uses trim().
  const password = requireString(body, 'password', 'Password');
  if (password.length < LIMITS.passwordMin) {
    throw badRequest(`Password must be at least ${LIMITS.passwordMin} characters.`);
  }
  if (password.length > LIMITS.passwordMax) {
    throw badRequest(`Password must be ${LIMITS.passwordMax} characters or fewer.`);
  }

  const fullName = requireString(body, 'fullName', 'Full name').trim();
  if (fullName.length > LIMITS.fullNameMax) {
    throw badRequest(`Full name must be ${LIMITS.fullNameMax} characters or fewer.`);
  }

  return { email, password, fullName };
}

export function parseLoginBody(rawBody) {
  const body = fields(rawBody);
  const email = normalizeEmail(requireString(body, 'email', 'Email'));
  // No minimum length on login, matching validateExistingPassword() on the
  // client: enforcing today's rule would lock out an account whose password was
  // set before the rule existed. Length is a rule for CHOOSING a password.
  const password = requireString(body, 'password', 'Password');
  return { email, password };
}
