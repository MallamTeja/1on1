/**
 * backend/src/lib/httpError.js — the one way this codebase signals "reject this
 * request with status N".
 *
 * THE PROBLEM IT SOLVES
 *   Without this, every handler ends up doing
 *       if (bad) return res.status(409).json({ message: '...' });
 *   which means the response shape is re-invented in every file, and a check
 *   buried three calls deep inside a service has no way to reject at all —
 *   it has no `res`. Throwing a typed error instead lets ANY layer say "this
 *   request is a 409" and leaves one place (middleware/errorHandler.js)
 *   responsible for turning that into an HTTP response.
 *
 * THE CONTRACT WITH THE FRONTEND
 *   frontend/src/lib/api.ts reads `payload.message` off an error body and puts
 *   it on its `ApiError`, then Login.tsx branches on `.status === 401` and
 *   Register.tsx on `.status === 409`. So `status` and `message` are a real
 *   API contract, not debug output — see errorHandler.js for the other half.
 */
export class HttpError extends Error {
  /**
   * @param {number} status  HTTP status the client should see.
   * @param {string} message Safe to show a user. Never interpolate a secret,
   *                         a stack trace, or a raw upstream error in here.
   */
  constructor(status, message, options = {}) {
    super(message, options);
    this.name = 'HttpError';
    this.status = status;
    /**
     * Marks this as an error we raised ON PURPOSE. errorHandler.js uses the
     * flag to decide between "show the client this message" and "this is an
     * unexpected crash, show a generic 500". Without the distinction, the day
     * a database driver throws `Error: connection to 10.0.1.4 failed (user
     * admin)` you would hand that string straight to the browser.
     */
    this.expose = true;
    if (options && options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export const badRequest = (message) => new HttpError(400, message);
export const unauthorized = (message = 'Invalid email or password.') =>
  new HttpError(401, message);
export const conflict = (message) => new HttpError(409, message);

/**
 * Express 4 does NOT catch rejected promises. An `async` handler that throws
 * produces an unhandled rejection and a request that hangs until the client
 * times out — no 500, no log, just silence. Wrapping every async handler in
 * this forwards the rejection to next(), which is what routes it to the error
 * middleware.
 *
 * (Express 5 does this natively. This wrapper is the price of being on 4, and
 * it is one line per route rather than a try/catch in every handler.)
 */
export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
