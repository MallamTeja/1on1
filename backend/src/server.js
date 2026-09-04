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
 *   One HTTP endpoint:
 *       GET http://localhost:5000/api/health  ->  200 {"status":"ok", ...}
 *   The Vite dev server (frontend, port 3000) proxies any request beginning
 *   with /api to http://localhost:5000, so the browser can call "/api/health"
 *   on its own origin and still reach this server. See frontend/vite.config.js.
 *
 * WHAT IT DOES *NOT* DO YET
 *   No database, no authentication, no routers/controllers/models, no error
 *   handling, no logging, no graceful shutdown. This is a scaffold — the
 *   smallest server that proves the toolchain works end to end.
 *   Full write-up: docs/code/03-backend.md
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// IMPORTS
// -----------------------------------------------------------------------------
// These are ESM (ECMAScript Module) `import` statements, which work here only
// because backend/package.json contains `"type": "module"`. Without that flag
// Node would treat this file as CommonJS and these lines would be a syntax
// error. All imports are resolved and executed BEFORE any code below runs.

// `express` is the web framework. The default export is a factory function:
// calling express() returns a new application object. It is *not* a class — you
// never write `new express()`.
import express from 'express';

// `cors` is Express middleware that writes the Cross-Origin Resource Sharing
// response headers for you. Without those headers a browser will refuse to hand
// a response from :5000 to JavaScript running on :3000.
import cors from 'cors';

// `dotenv` reads a plain-text .env file off disk and copies its KEY=value pairs
// into `process.env`. It is how secrets (DB URIs, API keys, JWT secrets) reach
// the code without ever being committed to git — note that `.env` is listed in
// this repo's .gitignore.
import dotenv from 'dotenv';

// `path` is a Node built-in for manipulating filesystem paths in a way that is
// correct on both Windows (backslashes, "C:\") and POSIX (forward slashes).
// Never build paths with string concatenation; use path.join/path.resolve.
import path from 'path';

// `fileURLToPath` is a named export of the Node built-in `url` module. It
// converts a file:// URL string into a real OS filesystem path. See the block
// below for why that conversion is necessary at all.
import { fileURLToPath } from 'url';

// -----------------------------------------------------------------------------
// RECREATING __filename AND __dirname (the ESM tax)
// -----------------------------------------------------------------------------
// In CommonJS (the old `require()` world) Node injected two magic variables into
// every module: `__filename` (absolute path of this file) and `__dirname`
// (absolute path of the folder containing it). ES modules are a *language*
// standard, not a Node-specific one, so those Node-only globals DO NOT EXIST
// here. Referencing __dirname directly would throw
// "ReferenceError: __dirname is not defined in ES module scope".
//
// The standard replacement is `import.meta` — an object the module system fills
// in per-module. `import.meta.url` is a STRING holding the absolute file:// URL
// of the current module, e.g. on Windows:
//     "file:///C:/Users/tejam/OneDrive/myproj/1on1/backend/src/server.js"
//
// That is a URL, not a path, and you cannot feed it to `fs` or `path` as-is:
//   * it carries the "file://" scheme prefix,
//   * spaces and non-ASCII characters are percent-encoded ("My%20Docs"),
//   * on Windows it has a leading slash before the drive letter ("/C:/...")
//     and uses forward slashes.
// `fileURLToPath()` handles all three, decoding the escapes and producing a
// genuine platform path: "C:\Users\tejam\...\backend\src\server.js".
// (This repo lives under a OneDrive path, exactly the kind of location where an
// encoded character or space shows up — so the conversion is not academic.)
const __filename = fileURLToPath(import.meta.url);

// `path.dirname()` strips the last segment off a path, turning the file path
// above into the directory that contains it:
//     "C:\Users\tejam\...\backend\src"
// We want the DIRECTORY, not the file, because the relative path built below is
// relative to "where this file lives" — which is stable no matter what folder
// the user happened to be in when they typed `pnpm dev:backend`.
// (A bare relative path like './.env' would instead resolve against
// process.cwd(), the *caller's* directory, and would break the moment the
// server is started from somewhere else.)
const __dirname = path.dirname(__filename);

// -----------------------------------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------------------------------

// Load environment variables. `dotenv.config()` defaults to looking for a .env
// in the current working directory; we override that with an explicit `path`.
//
// Walking the path from __dirname (= backend/src):
//     backend/src  --  ".."   -->  backend
//     backend      --  ".."   -->  <repo root>
//     <repo root>  --  ".env" -->  <repo root>/.env
// So there is ONE .env file for the whole monorepo, sitting next to the root
// package.json and pnpm-workspace.yaml — not one .env per package.
//
// This deliberately matches the frontend: frontend/vite.config.js sets
// `envDir: '../'`, which tells Vite to read that same repo-root .env. Backend
// and frontend therefore share a single source of configuration truth, which is
// why a value like PORT only has to be written down once.
//
// Note this MUTATES the global `process.env` object as a side effect and returns
// a result object we simply ignore. It must run BEFORE any code that reads
// process.env — hence its position above the PORT line. If the file does not
// exist dotenv does not throw; process.env is just left unchanged.
dotenv.config({ path: path.join(__dirname, '../../.env') });

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
const PORT = process.env.PORT || 5000;

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
//    Called bare like this, `cors()` uses its wide-open defaults and sends
//    `Access-Control-Allow-Origin: *` — any website on the internet may call
//    this API from a user's browser. Convenient in development, UNACCEPTABLE in
//    production: before shipping, replace it with an explicit allowlist, e.g.
//        app.use(cors({ origin: process.env.FRONTEND_ORIGIN, credentials: true }))
//    Note also that `*` and cookie-based auth are mutually exclusive — once JWT
//    refresh tokens live in HTTP-only cookies, `credentials: true` plus a real
//    origin becomes mandatory.
//
//    (In local dev the browser often never even triggers CORS, because Vite's
//    proxy makes the call look same-origin. This matters for any client that
//    hits :5000 directly, and for deployment where the two are real domains.)
app.use(cors());

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
});
