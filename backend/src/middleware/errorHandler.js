/**
 * backend/src/middleware/errorHandler.js — the last two handlers in the chain.
 *
 * Express runs middleware in registration order, so these must be mounted AFTER
 * every route in server.js. `notFound` catches any request no route claimed;
 * `errorHandler` catches anything that threw or called next(err).
 */
import { HttpError } from '../lib/httpError.js';
import { config } from '../config/env.js';

/**
 * Reached only when no route matched. Express has a built-in 404, but it
 * returns an HTML page — and frontend/src/lib/api.ts tries to JSON.parse an
 * error body to read `.message` from it. An HTML 404 makes that parse fail and
 * the user sees the generic "Request failed with 404" instead of anything
 * useful. Returning JSON keeps the contract consistent for every status.
 */
export function notFound(req, res) {
  res.status(404).json({ message: `Cannot ${req.method} ${req.path}` });
}

/**
 * THE ERROR-HANDLING MIDDLEWARE.
 *
 * Express identifies this as an error handler purely by its ARITY — four
 * declared parameters. Drop `next` because it looks unused and Express silently
 * treats it as an ordinary middleware that never runs; this is the single most
 * common way a project ends up with no error handling while appearing to have
 * some. `next` is genuinely unused below, and must still be declared.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Errors we raised deliberately carry a status and a message meant for a
  // human. Anything else is a crash and gets neither.
  const isDeliberate = err instanceof HttpError && err.expose;

  // express.json() throws a SyntaxError with `.status = 400` on a malformed
  // body. Honour that status but never its message — it embeds a fragment of
  // the raw request body, which for a login attempt would be the password.
  const isBadJson = err instanceof SyntaxError && err.status === 400 && 'body' in err;

  const status = isDeliberate ? err.status : isBadJson ? 400 : 500;
  const message = isDeliberate
    ? err.message
    : isBadJson
      ? 'Request body is not valid JSON.'
      : 'Something went wrong. Please try again.';

  /**
   * THE RULE: the client gets a status and a safe sentence, and the server logs
   * everything. Handing a stack trace to the browser hands out absolute file
   * paths, dependency versions, internal hostnames and, when the throw came
   * from a database driver, sometimes the connection string. A generic 500 is
   * not unhelpfulness — the detail belongs in the logs, where it is already.
   */
  if (isBadJson) {
    /**
     * Logged as ONE LINE, deliberately without the error object.
     *
     * body-parser attaches the raw request body to the SyntaxError it throws,
     * as `err.body`. Passing `err` to console.error therefore prints the whole
     * unparsed payload — and on a malformed POST /api/auth/login that payload
     * is the user's PASSWORD IN CLEARTEXT, written to stdout and shipped to
     * whatever collects logs. That is a credential leak into a system with much
     * broader access than the database, and it survives long after the request.
     *
     * There is nothing to debug here anyway: a client sent invalid JSON, and
     * the method and path say everything worth knowing.
     */
    console.warn(`[warn] ${req.method} ${req.path} — malformed JSON body rejected`);
  } else if (!isDeliberate) {
    // A genuine crash from our own code. Full detail, because nothing here
    // carries a raw request body the way the parser error does.
    console.error(`[error] ${req.method} ${req.path}`, err);
  }

  // The stack goes in the response ONLY for a genuine 500, and only outside
  // production. Gating on `status === 500` rather than on "did we raise this
  // deliberately" is the correction to an earlier version of this file: a
  // malformed-JSON body is a SyntaxError we did not raise, so the looser check
  // treated it as a crash and attached a stack to a 400. A 4xx means the client
  // sent something wrong — there is nothing in our stack that helps them, and
  // it exposes absolute file paths and dependency versions for free.
  const includeStack = status === 500 && !config.isProduction;

  res.status(status).json({
    message,
    ...(includeStack ? { stack: err.stack } : {}),
  });
}
