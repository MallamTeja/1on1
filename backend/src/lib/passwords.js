/**
 * backend/src/lib/passwords.js — hashing and verifying user passwords.
 *
 * WHY bcryptjs AND NOT bcrypt
 *   docs/02-technology-stack.md specifies bcrypt, and this IS bcrypt — the same
 *   algorithm producing the same "$2b$" hash format. The difference is only the
 *   implementation: `bcrypt` is a native C++ addon that needs node-gyp or a
 *   prebuilt binary, and this repo's .npmrc pins
 *       only-built-dependencies=["esbuild"]
 *   which means pnpm refuses to run any other package's install script. A
 *   native bcrypt would install and then fail at import with a missing-binding
 *   error. `bcryptjs` is pure JavaScript, so there is no build step, nothing to
 *   break on a Node upgrade, and no root config change (which this workstream
 *   does not own anyway).
 *
 *   The tradeoff is real: pure JS is roughly 3-4x slower per hash. At cost 12
 *   that is a few hundred milliseconds on a login, which is acceptable — and
 *   because the hash STRING FORMAT is identical, swapping in native bcrypt
 *   later is a one-line import change that leaves every stored hash valid.
 */
import bcrypt from 'bcryptjs';

/**
 * The bcrypt "cost factor": the hash runs 2^12 = 4096 key-expansion rounds.
 *
 * This number is the entire point of bcrypt. A fast hash (MD5, SHA-256) is a
 * liability for passwords precisely because it is fast — an attacker holding a
 * stolen table can try billions of guesses per second. bcrypt is deliberately
 * slow, and the cost is TUNABLE so it can be raised as hardware gets faster.
 * The cost is embedded in each hash string, so raising it later does not
 * invalidate old hashes; they keep verifying at the cost they were made with.
 *
 * 12 is the current sensible default. Raise it when the latency budget allows.
 */
const COST = 12;

/**
 * NOTE ON LENGTH: bcrypt only considers the first 72 BYTES of its input and
 * ignores anything past that. Our maximum is 100 characters (mirrored from the
 * client), so a very long passphrase — or a shorter one full of multi-byte
 * characters — has its tail silently dropped. That is accepted here rather than
 * worked around: 72 bytes is already far more entropy than any real password
 * carries, and the usual fix (SHA-256 pre-hashing) changes the stored format
 * and would break the drop-in path to native bcrypt described above.
 */
export function hashPassword(plainText) {
  return bcrypt.hash(plainText, COST);
}

export function verifyPassword(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}

/**
 * A real bcrypt hash of a value nobody knows, used ONLY to burn the same amount
 * of CPU on a login for an email that does not exist.
 *
 * WHY THIS MATTERS — USER ENUMERATION VIA TIMING
 *   The obvious login is: look the email up; if there is no user, return 401
 *   immediately. That returns in about 1ms for an unknown email and about 300ms
 *   for a known one, because only the second path runs bcrypt. An attacker who
 *   can time responses can therefore ask "is alice@corp.com a member here?" and
 *   read the answer off the clock, even though both responses say 401. For a
 *   professional-networking product that leaks the membership list.
 *
 *   routes/auth.js compares against this dummy hash on the not-found path, so
 *   both branches perform one bcrypt comparison and take comparable time.
 *   (Timing defences are never perfect, but closing a 300x gap costs four lines.)
 */
export const DUMMY_HASH = bcrypt.hashSync('a-password-that-is-never-valid', COST);
