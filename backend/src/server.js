/**
 * =============================================================================
 * backend/src/server.js — the entire backend of the "1on1" app (for now)
 * =============================================================================
 *
 * WHAT THIS FILE IS
 *   This is the entry point of the Node.js/Express HTTP server. It is the very
 *   first backend file Node executes, and right now it is the ONLY backend file
 *   with logic in it. It builds an Express application, plugs two pieces of
 *   middleware into it, registers a single health-check route, and then opens a
 *   TCP socket so the outside world can talk to it.
 *
 * WHEN IT RUNS / WHAT STARTS IT
 *   From the repo root you run:
 *       pnpm dev:backend
 *   which is defined in the ROOT package.json as:
 *       pnpm --filter 1on1-backend run dev
 *   which runs the "dev" script in backend/package.json:
 *       nodemon src/server.js
 *   nodemon is a file watcher: it spawns `node src/server.js`, and every time a
 *   .js file under backend/ changes on disk it kills that process and starts a
 *   fresh one. So this file is re-executed from line 1 on every save. There is
 *   no hot-reloading of state — the whole process restarts.
 *
 *   In production you would instead run `pnpm start` -> `node src/server.js`,
 *   with no watcher.
 *
 * WHAT IT EXPOSES
 *       GET  /api/health                 200 {"status":"ok", ...}
 *       POST /api/auth/register          201 AuthResponse   409 email taken
 *       POST /api/auth/login             200 AuthResponse   401 bad credentials
 *       POST /api/auth/refresh           200 AuthResponse   401 no/stale cookie
 *       POST /api/auth/logout            204
 *       GET  /api/auth/me                200 UserResponse   401 without a token
 *       GET  /api/auth/google            302 -> accounts.google.com
 *       GET  /api/auth/google/callback   302 -> the frontend, session cookie set
 *   The Vite dev server (frontend, port 3000) proxies any request beginning
 *   with /api to http://localhost:5000, so the browser can call "/api/health"
 *   on its own origin and still reach this server. See frontend/vite.config.js.
 *
 * WHAT IT DOES *NOT* DO YET
 *   No real database — user records live in an in-memory Map that is wiped on
 *   every restart, because the AWS database service is still an open decision
 *   in docs/02-technology-stack.md. Everything persistence-related is funnelled
 *   through src/repositories/userRepository.js so that swapping it out is one
 *   file; read the header of that file before doing anything with it.
 *   Also missing: structured logging, rate limiting, graceful shutdown.
 *   Full write-up: docs/code/03-backend.md
 *
 * WHAT IT GAINED (auth pass)
 *   Email+password auth and Google sign-in now live in src/routes/*, mounted
 *   below. This file stays a BOOTSTRAP — it wires things together and owns no
 *   business logic of its own. The rule to keep: if you are about to write an
 *   `if` in here, it belongs in a router or a middleware instead.
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// IMPORTS
// -----------------------------------------------------------------------------
// These are ESM (ECMAScript Module) `import` statements, which work here only
// because backend/package.json contains `"type": "module"`. Without that flag
// Node would treat this file as CommonJS and these lines would be a syntax
// error. All imports are resolved and executed BEFORE any code below runs.

// !! THIS IMPORT MUST STAY FIRST — DO NOT REORDER OR REMOVE IT !!
// It has no bindings because it is imported purely for its side effect: it
// reads the repo-root .env into process.env. ES module imports are HOISTED and
// evaluated in source order before this file's own body runs, so any module
// below that reads process.env at load time (./config/env.js does) would see an
// empty environment if this ran later. The full explanation is in the file.
import './config/loadEnv.js';

// `express` is the web framework. The default export is a factory function:
// calling express() returns a new application object. It is *not* a class — you
// never write `new express()`.
import express from 'express';

// `cors` is Express middleware that writes the Cross-Origin Resource Sharing
// response headers for you. Without those headers a browser will refuse to hand
// a response from :5000 to JavaScript running on :3000.
import cors from 'cors';

// `cookie-parser` reads the incoming `Cookie:` header, splits and URL-decodes
// it, and hands the result to handlers as `req.cookies`. Without it that header
// is one raw string and `req.cookies` is undefined. The refresh token lives in
// an HTTP-only cookie, so POST /api/auth/refresh depends entirely on this.
import cookieParser from 'cookie-parser';

// Our own modules. `config` is the validated, frozen view of process.env — this
// file never reads process.env directly, so there is exactly one place where a
// missing or malformed variable is caught (see ./config/env.js).
import { config, describeConfig } from './config/env.js';
import { authRouter } from './routes/auth.js';
import { googleAuthRouter } from './routes/googleAuth.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

// -----------------------------------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------------------------------

// Environment variables are ALREADY LOADED by the time this line is reached:
// ./config/loadEnv.js did it at the top of the import list, and ./config/env.js
// has already validated them into the frozen `config` object imported above.
// (The __filename/__dirname reconstruction and the dotenv.config() call that
// used to live here moved into loadEnv.js — comments and all — because ES
// module imports are hoisted above the module body, so doing it here ran too
// late for any module that reads process.env when it loads.)
//
// Nothing below this point reads process.env directly. One validated source of
// truth, and a boot-time failure instead of an undefined at 3am.

// Create the application instance. Calling express() returns a special object
// that is *also* a function with the signature (req, res) — that is, it IS a
// request handler that Node's built-in http server can call directly. All the
// app.use()/app.get() calls below merely register handlers onto it. Nothing is
// listening on the network yet; this is pure in-memory setup.
const app = express();

// Decide which TCP port to listen on.
//   * `process.env.PORT` is whatever came from the .env file (or from the real
//     shell environment, or from a host such as Render that injects PORT itself).
//   * `|| 5000` is the fallback: if PORT is undefined, or an empty string, the
//     left side is falsy and we use the hard-coded default. This means the
//     server still boots for a brand-new contributor who has no .env at all.
//
// IMPORTANT BEGINNER TRAP: values in process.env are ALWAYS strings — a .env
// file carries no type information. `PORT=5000` gives you the string "5000",
// never the number 5000. Here that is harmless because app.listen() accepts a
// numeric string, but the moment you read something like process.env.MAX_USERS
// and do arithmetic on it you must Number() it first, or "10" + 1 quietly
// becomes "101". Likewise `process.env.DEBUG === 'true'` is the correct way to
// read a boolean — the string "false" is itself truthy.
//
// That trap is exactly why this now comes from `config` rather than being read
// here: ./config/env.js does the Number() conversion once, rejects a PORT that
// is not a positive integer at BOOT rather than letting app.listen() fail with
// something cryptic, and applies the same `|| 5000` default in one place.
const PORT = config.port;

// -----------------------------------------------------------------------------
// GLOBAL MIDDLEWARE
// -----------------------------------------------------------------------------
// Middleware are functions of the shape (req, res, next) that Express runs, in
// the exact order they were registered with app.use(), before any route handler.
// Each one may inspect or mutate `req`/`res` and then call next() to hand the
// request down the chain (or end the response itself to short-circuit it).
// Order is behaviour, not style: registering these two AFTER the route below
// would mean the route never sees CORS headers or a parsed body.

// 1) CORS. Browsers enforce the "same-origin policy": JavaScript loaded from
//    http://localhost:3000 is not allowed to read a response from
//    http://localhost:5000, because the port differs, so the origin differs.
//    CORS is the server's opt-in override: by returning an
//    `Access-Control-Allow-Origin` header this server tells the browser "it is
//    fine, let that page read my response."
//
//    This middleware also answers CORS *preflights*. For any request that is not
//    a "simple" one — a custom header such as Authorization, a method like
//    PUT/DELETE, or a JSON content-type — the browser first sends an OPTIONS
//    request asking permission, and only sends the real request if the answer
//    allows it. The cors package replies to those OPTIONS requests for you.
//
//    This USED to be a bare `cors()`, which sends `Access-Control-Allow-Origin: *`
//    and lets any website on the internet call this API from a user's browser.
//    That had to change the moment auth landed, for a reason that is a hard
//    browser rule rather than a preference:
//
//        A WILDCARD ORIGIN AND CREDENTIALS ARE MUTUALLY EXCLUSIVE.
//
//    Every call in frontend/src/lib/api.ts uses `credentials: "include"` so the
//    refresh cookie rides along. A browser flatly refuses to hand back a
//    credentialed response whose Allow-Origin is `*` — it fails the request and
//    logs a CORS error. So `*` would not merely be insecure here, it would be
//    broken. The allowlist below is what makes cookie auth work at all.
//
//    Passing a FUNCTION rather than an array is what makes the reflection
//    correct: with credentials enabled the server must echo back one specific
//    origin (never `*`), and this decides per request whether the caller's
//    Origin is on the list.
//
//    (In local dev the browser often never even triggers CORS, because Vite's
//    proxy makes the call look same-origin. This matters for any client that
//    hits :5000 directly, and for deployment where the two are real domains.)
app.use(
  cors({
    origin(origin, callback) {
      // `origin` is undefined for requests that have no Origin header at all —
      // curl, Postman, server-to-server calls, and health checks. Those are not
      // browser requests, so the same-origin policy was never protecting them
      // and rejecting them would only break tooling. CORS is a browser
      // mechanism; it is not, and cannot be, general API authorisation.
      if (!origin) return callback(null, true);

      if (config.corsAllowedOrigins.includes(origin)) return callback(null, true);

      // Deny by NOT allowing, rather than by passing an error: the browser will
      // block the response either way, and this keeps a rejected origin out of
      // the error-handler path where it would log noise on every preflight.
      return callback(null, false);
    },
    // Tells the browser it may send cookies and read the response. This is the
    // server half of the client's `credentials: "include"`; both are required.
    credentials: true,
  })
);

// 2) JSON body parser, built into Express since 4.16. Raw HTTP request bodies
//    arrive as a stream of bytes; nothing parses them automatically. This
//    middleware checks the incoming `Content-Type` header, and ONLY when it is
//    `application/json` does it buffer the stream, JSON.parse() it, and assign
//    the result to `req.body`. Without this line `req.body` is `undefined` in
//    every handler — the classic "why is my POST body empty?" bug.
//
//    Because it is type-gated, a GET like /api/health (which carries no body)
//    passes straight through — the cost is effectively zero.
//    Malformed JSON makes it throw, which Express turns into a 400 via its
//    default error handler; a real app would add its own error middleware to
//    shape that response. Form posts (`application/x-www-form-urlencoded`) need
//    a separate `express.urlencoded()` — this one ignores them.
app.use(express.json());

// 3) Cookie parser. Turns the raw `Cookie: a=1; b=2` request header into the
//    object `req.cookies = { a: '1', b: '2' }`. Registered here, before any
//    route, because POST /api/auth/refresh and the Google callback both read
//    cookies and would otherwise see `req.cookies` as undefined.
//
//    Note this only READS cookies. Writing them is res.cookie(), which Express
//    provides on its own and needs no middleware — see src/lib/session.js,
//    where all the cookie flags are set in one place.
//
//    No secret is passed to cookieParser() because nothing here uses SIGNED
//    cookies. Signing detects tampering with a value the client can see; our
//    refresh token is 256 bits of unguessable randomness that is checked
//    against the store on every use, so a tampered value simply does not match
//    anything. Signing it would add a moving part and prove nothing extra.
app.use(cookieParser());

// -----------------------------------------------------------------------------
// ROUTES
// -----------------------------------------------------------------------------

// Register a handler for GET requests whose path is exactly "/api/health".
// `app.get(path, handler)` matches on METHOD + PATH together: a POST to the same
// URL would not match this and would fall through to Express's built-in 404.
//
// The handler signature `(req, res)` is the core Express contract:
//   * `req` — the incoming request. Express extends Node's IncomingMessage with
//             req.params, req.query, req.body, req.headers, req.method, etc.
//   * `res` — the outgoing response, which you build up and then send. Nothing
//             reaches the client until you call a terminating method such as
//             res.json(), res.send() or res.end().
// A third parameter `next` exists but is omitted here because this handler
// always finishes the response itself and never delegates.
//
// This is the classic HEALTH CHECK / LIVENESS PROBE pattern: a trivial, cheap,
// unauthenticated endpoint whose only job is to answer "is this process alive
// and serving HTTP?". Load balancers, Docker/Kubernetes probes, uptime monitors
// and hosts like Render poll exactly this kind of URL on a timer and restart or
// depool the instance when it stops answering. It is also the fastest way for a
// human to confirm the frontend proxy is wired up correctly.
app.get('/api/health', (req, res) => {
  // res.json() does three things in one call:
  //   1. serialises the JavaScript object argument with JSON.stringify(),
  //   2. sets `Content-Type: application/json; charset=utf-8`,
  //   3. sends the body and ENDS the response.
  // The status code defaults to 200 (OK); you would chain res.status(404).json()
  // to change it. Because this ends the response, nothing after it in this
  // function could reach the client — a second res.json() here would throw
  // "Cannot set headers after they are sent to the client".
  //
  // The payload shape is arbitrary and chosen by us: `status: 'ok'` is the
  // machine-readable field a monitor would assert on, and `message` is for the
  // human eyeballing it in a browser tab. A more mature version would also
  // report uptime, build version and database connectivity.
  res.json({ status: 'ok', message: 'Server is running perfectly!' });
});

// -----------------------------------------------------------------------------
// FEATURE ROUTERS
// -----------------------------------------------------------------------------
// `app.use(prefix, router)` MOUNTS a router: every path inside the router is
// interpreted relative to the prefix, so authRouter's '/login' is served at
// '/api/auth/login'. That is why nothing inside src/routes/ repeats the '/api'
// prefix — it is written once, here, and the routers stay relocatable.
//
// Keeping the prefix in this file and the handlers in theirs is the whole point
// of the split: this file answers "what URLs exist?", and each router answers
// "what happens at them?". server.js stays readable as the map of the API even
// once there are twenty routers.

// Email + password. The AUTH CORE — this works with no Google config at all.
app.use('/api/auth', authRouter);

// Google sign-in: OPTIONAL and ADDITIVE, never a replacement for the above.
//
// Mounted at the same '/api/auth' prefix but on a deeper path, so the router's
// '/' becomes GET /api/auth/google and its '/callback' becomes
// GET /api/auth/google/callback.
//
// ORDER MATTERS AND IS SAFE HERE: authRouter is registered first, but it
// declares no '/google' path, so Express falls through to this one. If a
// '/google' were ever added to authRouter it would win and this router would go
// dark — a genuinely confusing bug, so keep the two path sets disjoint.
//
// The path is fixed by the frontend: googleAuthorizeUrl() in
// frontend/src/lib/api.ts returns `${API_BASE}/api/auth/google`. This matches
// it exactly, so no frontend change is needed to light the button up.
app.use('/api/auth/google', googleAuthRouter);

// -----------------------------------------------------------------------------
// FALLBACKS — must be registered LAST
// -----------------------------------------------------------------------------
// Express matches in registration order, so these have to come after every real
// route. Move them above the routers and `notFound` swallows the entire API.

// Any request no route above claimed. Answers JSON rather than Express's
// built-in HTML 404, because the frontend's api.ts parses error bodies as JSON.
app.use(notFound);

// The error handler. Recognised by Express ONLY because it declares four
// parameters — see the comment on it in middleware/errorHandler.js. Every
// throw and every next(err) from anywhere above ends up here, which is what
// makes "no stack traces leak to clients" enforceable in one place instead of
// being a rule everyone has to remember.
app.use(errorHandler);

// -----------------------------------------------------------------------------
// START LISTENING
// -----------------------------------------------------------------------------

// This is the line that actually touches the network: it creates a Node
// http.Server wrapping `app`, binds it to TCP port PORT on every local network
// interface, and starts accepting connections.
//
// app.listen() is ASYNCHRONOUS and NON-BLOCKING. It returns the server object
// immediately and does not pause execution — any statement placed after this
// call would run right away, most likely *before* the socket is even bound.
// That is why the confirmation message lives inside a callback rather than on
// the next line: the arrow function below is invoked by Node exactly once, on
// the server's 'listening' event, i.e. the first moment the port is genuinely
// open and a request could arrive.
//
// From here the process does not exit. The bound socket is an active handle in
// libuv's event loop, so Node keeps the loop alive indefinitely, waiting on
// events. Every incoming request is then dispatched through the middleware
// chain registered above.
//
// If the port is already taken the server emits an 'error' event with code
// EADDRINUSE; since nothing here listens for that event the process crashes
// with an unhandled error — the usual "something is already on 5000" symptom.
app.listen(PORT, () => {
  // A template literal (backticks) so ${PORT} is interpolated into the string.
  // Printing a clickable, fully-formed URL rather than a bare port number is a
  // small kindness: it is the signal in the terminal that boot succeeded, and
  // nodemon reprints it after every restart.
  console.log(`Backend server is running on http://localhost:${PORT}`);
  // One line naming the configuration this process actually booted with, so a
  // misconfiguration is visible immediately rather than at the first failed
  // login. describeConfig() reports only whether each secret is PRESENT and
  // never its value — logs get shipped, pasted into issues and screenshotted.
  console.log(`[config] ${describeConfig()}`);
});
