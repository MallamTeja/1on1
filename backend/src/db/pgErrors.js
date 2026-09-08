/**
 * =============================================================================
 * backend/src/db/pgErrors.js — PostgreSQL SQLSTATE translator to HttpError
 * =============================================================================
 *
 * WHY THIS MODULE EXISTS
 *   Raw PostgreSQL errors contain SQLSTATE codes, table names, constraint names,
 *   and sometimes sensitive values in `err.detail` (e.g., duplicate email values).
 *   Leaking raw database error objects to API clients breaches security and exposes
 *   internal database implementation details.
 *
 *   This translator maps recognized database constraint violations to safe,
 *   structured `HttpError` instances while retaining the underlying database
 *   error in `err.cause` for server-side logging and debugging.
 * =============================================================================
 */
import { HttpError } from '../lib/httpError.js';

/**
 * Translate a database driver error into an HttpError, or return null if unmapped.
 *
 * @param {Error|unknown} err Error caught from a query or transaction.
 * @returns {HttpError|null} Clean HTTP error or null if not a mapped PostgreSQL error.
 */
export function translatePgError(err) {
  // If not an error object or lacks a PostgreSQL SQLSTATE code, ignore.
  if (!err || typeof err !== 'object' || typeof err.code !== 'string') {
    return null;
  }

  const sqlState = err.code;
  const constraint = err.constraint || '';

  // 1. UNIQUE VIOLATION (SQLSTATE 23505)
  if (sqlState === '23505') {
    // Duplicate email constraint -> 409 conflict with exact user-facing message.
    if (constraint === 'uq_app_user_email_lower') {
      const error = new HttpError(409, 'An account already uses this email.', {
        expose: true,
        cause: err,
      });
      error.cause = err;
      return error;
    }

    // Duplicate username -> return null so the repository can catch and auto-generate a suffix.
    if (constraint === 'uq_app_user_username') {
      return null;
    }

    // Any other unique violation -> 409 without leaking driver detail or matching /already exists/.
    const error = new HttpError(409, 'A record with this unique identifier conflicts with an existing entry.', {
      expose: true,
      cause: err,
    });
    error.cause = err;
    return error;
  }

  // 2. EXCLUSION VIOLATION (SQLSTATE 23P01)
  // Triggered by PostgreSQL GiST exclusion constraints preventing double booking.
  if (sqlState === '23P01') {
    const error = new HttpError(409, 'This time slot is unavailable due to an overlapping booking.', {
      expose: true,
      cause: err,
    });
    error.cause = err;
    return error;
  }

  // 3. CHECK VIOLATION (SQLSTATE 23514)
  // Triggered by table CHECK constraints (e.g. positive prices, valid duration enum).
  if (sqlState === '23514') {
    const error = new HttpError(400, 'Data validation constraint failed.', {
      expose: true,
      cause: err,
    });
    error.cause = err;
    return error;
  }

  // 4. STRING DATA RIGHT TRUNCATION (SQLSTATE 22001)
  // String exceeded VARCHAR(n) length limit.
  if (sqlState === '22001') {
    const error = new HttpError(400, 'Value too long for field.', {
      expose: true,
      cause: err,
    });
    error.cause = err;
    return error;
  }

  // Any unmapped SQLSTATE returns null so it bubbles up as an unhandled 500 error.
  return null;
}
