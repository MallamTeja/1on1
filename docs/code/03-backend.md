# 03 — Backend

A line-by-line reference for the `backend/` package: what exists today, why each
line is there, and what has to be built before it matches the architecture in
[`docs/03-system-design.md`](../03-system-design.md).

---

## 1. Purpose and current maturity

The backend is the Node.js + Express HTTP server for **1on1**. In the target
architecture it owns the REST API, JWT authentication, the MongoDB data layer,
the Socket.IO realtime gateway, WebRTC signaling relay, and the Gemini AI/agent
layer. It is meant to be the single source of truth for every business rule — the
UI and the AI agent are both supposed to call the *same* service functions.

**None of that exists yet.** What is in the repo today is a scaffold whose only
job is to prove the toolchain works end to end:

| Concern | Status |
| --- | --- |
| HTTP server | Present — Express, one process, one port |
| Routes | **One**: `GET /api/health` |
| Database | None. No MongoDB driver, no Mongoose, no connection string usage |
| Authentication | None. No JWT, no password hashing, no sessions, no cookies |
| Models / schemas | None |
| Controllers / services | None — the single handler is inline in `server.js` |
| Middleware | Two, both third-party/built-in (`cors`, `express.json`) |
| Error handling | None (Express's default handler only) |
| Validation | None |
| Logging | One `console.log` at boot |
| Realtime (Socket.IO / WebRTC) | None |
| AI (Gemini) | None |
| Tests | None |

Total hand-written backend code: **23 executable lines**, all in one file.
Treat every code sample below as "the whole backend", not an excerpt.

---

## 2. File tree

```text
backend/
├── package.json        # package manifest: name, type:module, scripts, deps
└── src/
    └── server.js       # the entire server — entry point, config, middleware, route, listen
```

There is no `node_modules/` inside `backend/`. This is a **pnpm workspace**
(`pnpm-workspace.yaml` at the repo root), so dependencies are installed once
into a shared content-addressed store at the root and symlinked in. There is
also no `.env` inside `backend/` — configuration lives in a single `.env` at the
repo root (see §4).

Directories that the system design implies but that **do not exist yet**:
`src/routes/`, `src/controllers/`, `src/services/`, `src/models/`,
`src/middleware/`, `src/config/`, `src/sockets/`, `src/ai/`, `tests/`.

---

## 3. `backend/package.json`, field by field

```json
{
  "name": "1on1-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
```

### `name: "1on1-backend"`

The workspace identifier. It is never published to npm, but pnpm uses it to
target this package from the root: the root script `dev:backend` is
`pnpm --filter 1on1-backend run dev`. Change this name and that filter breaks.

### `version: "1.0.0"`

Required by the manifest format. It is meaningless for a private workspace
package that nobody installs from a registry — nothing reads it. Do not read
"1.0.0" as a statement of maturity.

### `type: "module"` — the single most consequential line

This tells Node to parse every `.js` file in this package as an **ES module**
rather than CommonJS. The concrete consequences:

* `import express from 'express'` **works**. Without this field it is a
  `SyntaxError: Cannot use import statement outside a module`.
* `require()` **does not exist**. Calling it throws
  `ReferenceError: require is not defined in ES module scope`. If you copy a
  Stack Overflow snippet that uses `require`, it will not run here. (You can
  recreate it with `createRequire(import.meta.url)` from `node:module`, but
  prefer `import`.)
* `module.exports` / `exports` do not exist either — use `export` /
  `export default`.
* **`__dirname` and `__filename` are absent.** They were Node-injected CommonJS
  variables, and ESM is a language standard with no such globals. This is
  exactly why `server.js` spends two lines reconstructing them (see §4).
* Imports are hoisted and evaluated before any top-level statement, and
  top-level `await` becomes legal.

Note the root `package.json` and `frontend/package.json` also set
`"type": "module"`, so the whole repo is consistently ESM.

### `scripts.start` vs `scripts.dev`

| Script | Command | Used for |
| --- | --- | --- |
| `start` | `node src/server.js` | Production / deployment. Runs the file once, plain Node, no watcher. If the process dies, it stays dead — the platform (Render, systemd, Docker) is responsible for restarts. Hosting platforms default to running `npm start`, which is why this name matters. |
| `dev` | `nodemon src/server.js` | Local development. nodemon watches the files under `backend/`, and on every save it kills the Node process and spawns a fresh one. |

Two things to understand about nodemon: it is a **full restart**, not hot
reload — all in-memory state is lost each time; and because it re-runs the whole
file, the boot `console.log` reprints on every save (that is your confirmation
the restart succeeded).

You normally do not run either script directly. From the repo root:

* `pnpm dev:backend` → `pnpm --filter 1on1-backend run dev` → `nodemon src/server.js`
* `pnpm dev` → `concurrently` runs backend *and* frontend together.

### Why `nodemon` is a `devDependency`, not a `dependency`

The split is about what has to be installed **in production**:

* `dependencies` — packages the running application `import`s. `express`, `cors`
  and `dotenv` all appear in `server.js`; without them the server cannot start.
* `devDependencies` — tooling used only while developing or building. nodemon is
  never imported by any source file; it is an external process that *supervises*
  Node. Production runs `node src/server.js` directly and never invokes it.

This matters because `pnpm install --prod` (and most container builds) skips
`devDependencies` entirely, producing a smaller image, a faster deploy, and a
smaller dependency surface to be audited for vulnerabilities. Shipping a file
watcher to a production server would be pure waste — and a needless supply-chain
risk. Rule of thumb: **if a line of `src/` imports it, it is a dependency;
otherwise it is a devDependency.**

---

## 4. Annotated walkthrough of `src/server.js`

### Chunk 1 — imports

```js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
```

Five imports, resolved and executed before any other statement in the file.

* **`express`** — the web framework. The default export is a *factory function*:
  `express()` returns a new application. It is not a class; never write
  `new express()`.
* **`cors`** — middleware that writes Cross-Origin Resource Sharing headers.
* **`dotenv`** — reads a `.env` text file and copies its `KEY=value` pairs into
  `process.env`.
* **`path`** — Node built-in for path manipulation that is correct on both
  Windows (`C:\...`, backslashes) and POSIX. Use it instead of string
  concatenation.
* **`fileURLToPath`** — a *named* export of the Node built-in `url` module (note
  the braces). Converts a `file://` URL into a real filesystem path.

`path` and `url` are Node built-ins, so they are not in `package.json`. Modern
style prefixes them (`node:path`, `node:url`) to make that explicit; the bare
form used here still works.

### Chunk 2 — recreating `__filename` and `__dirname`

```js
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

This two-line dance exists purely because of `"type": "module"`.

**`import.meta`** is an object the module system populates per module.
**`import.meta.url`** is a *string* holding this module's absolute `file://` URL:

```text
file:///C:/Users/tejam/OneDrive/myproj/1on1/backend/src/server.js
```

That is a URL, not a path, and `fs`/`path` cannot consume it directly:

1. it carries the `file://` scheme prefix;
2. spaces and non-ASCII characters are **percent-encoded** — a folder named
   `My Docs` appears as `My%20Docs`;
3. on Windows there is a leading slash before the drive letter (`/C:/...`) and
   the separators are forward slashes.

`fileURLToPath()` fixes all three at once, producing
`C:\Users\tejam\...\backend\src\server.js`. Hand-rolling this with
`.replace('file://', '')` is a well-known bug: it breaks on any path containing
a space, and on every Windows drive letter.

`path.dirname()` then strips the last segment, leaving the containing
**directory**: `C:\Users\tejam\...\backend\src`. The directory is what we
actually need, because the next line builds a path relative to *where this file
lives* — which is stable regardless of which folder the user was in when they
started the server. A bare relative path such as `'./.env'` would instead
resolve against `process.cwd()`, the *caller's* directory, and would silently
break when the server is launched from elsewhere.

### Chunk 3 — configuration

```js
dotenv.config({ path: path.join(__dirname, '../../.env') });
const app = express();
const PORT = process.env.PORT || 5000;
```

**`dotenv.config({ path })`** reads the file, parses `KEY=value` lines, and
assigns them onto the global `process.env` object. Without the explicit `path`
option it would look for `.env` in the current working directory, which is
wrong here. Walk the relative path from `__dirname`:

```text
backend/src   + ".."    ->  backend
backend       + ".."    ->  <repo root>
<repo root>   + ".env"  ->  <repo root>/.env
```

So there is **one `.env` for the entire monorepo**, sitting next to the root
`package.json` and `pnpm-workspace.yaml` — not one per package. This is
deliberate and mirrors the frontend: `frontend/vite.config.js` sets
`envDir: '../'`, pointing Vite at that same repo-root file. Backend and frontend
therefore read one shared source of configuration truth, which is why `PORT` only
has to be written down once.

Two behaviours worth knowing: `dotenv.config()` works by **mutation** — it
returns a result object that this code ignores, and its real effect is the side
effect on `process.env`. And it does **not throw** if the file is missing; it
just leaves `process.env` alone. That is why the server still boots on a fresh
clone with no `.env` (which is the normal state here, since `.env` is
gitignored). Because it mutates global state, it must run *before* anything
reads `process.env` — hence its position above the `PORT` line.

**`express()`** creates the application object. It is a function with the
signature `(req, res)` that also carries methods (`use`, `get`, `listen`, …) —
it *is* a request handler that Node's `http` server can call. At this point
nothing is on the network; this is in-memory setup only.

**`process.env.PORT || 5000`** picks the listening port. If `PORT` came from the
`.env` file, the real shell environment, or a host like Render that injects it,
that wins; otherwise the hard-coded `5000` keeps the server bootable for a
contributor with no `.env`.

> **Beginner trap:** environment variables are **always strings**. A `.env` file
> carries no type information, so `PORT=5000` yields the string `"5000"`, never
> the number `5000`. It is harmless here because `app.listen()` accepts a numeric
> string, but the moment you do arithmetic you must convert:
> `Number(process.env.MAX_USERS)`, or `"10" + 1` quietly becomes `"101"`.
> The same applies to booleans — the string `"false"` is **truthy**, so the only
> safe test is `process.env.DEBUG === 'true'`.

### Chunk 4 — global middleware

```js
app.use(cors());
app.use(express.json());
```

Middleware are functions shaped `(req, res, next)` that Express runs **in the
exact order they were registered**, before any route handler. Each may read or
mutate `req`/`res` and then call `next()` to pass the request down the chain, or
end the response itself to short-circuit it. Ordering is behaviour, not style:
move these two below the route and the route would see neither CORS headers nor
a parsed body.

**`cors()`** — Browsers enforce the **same-origin policy**: JavaScript served
from `http://localhost:3000` may *send* a request to `http://localhost:5000`, but
the browser will refuse to let that script *read* the response, because a
different port means a different origin. CORS is the server's opt-in override:
by returning `Access-Control-Allow-Origin`, the server tells the browser "this
page is allowed to read my response."

The middleware also handles **preflights**. For any request that is not "simple"
— a custom header such as `Authorization`, a method like `PUT`/`DELETE`, or a
JSON content type — the browser first sends an `OPTIONS` request asking
permission and only sends the real request if the answer allows it. The `cors`
package answers those `OPTIONS` requests automatically.

Called bare, `cors()` uses wide-open defaults and emits
`Access-Control-Allow-Origin: *` — *any* website on the internet may call this
API from a user's browser. That is fine for a dev scaffold and **must be locked
down before production**:

```js
app.use(cors({ origin: process.env.FRONTEND_ORIGIN, credentials: true }));
```

This becomes mandatory, not optional, once auth lands: the design puts JWT
refresh tokens in HTTP-only cookies, and the CORS spec forbids combining
credentials with a wildcard origin.

**`express.json()`** — the JSON body parser, built into Express since 4.16 (it
is `body-parser` vendored in, which is why there is no separate `body-parser`
dependency). Raw HTTP bodies arrive as a byte stream and nothing parses them
automatically. This middleware inspects the `Content-Type` header and, **only**
when it is `application/json`, buffers the stream, runs `JSON.parse()`, and
assigns the result to `req.body`. Omit this line and `req.body` is `undefined`
in every handler — the canonical "why is my POST body empty?" bug.

Because it is content-type gated, a bodiless `GET /api/health` passes straight
through at effectively zero cost. Malformed JSON makes it throw, which Express's
default error handler turns into a `400`; a real app would add its own error
middleware to shape that response. HTML form posts
(`application/x-www-form-urlencoded`) need a separate `express.urlencoded()` —
this middleware ignores them.

### Chunk 5 — the route

```js
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running perfectly!' });
});
```

`app.get(path, handler)` registers a handler matched on **method + path
together**. A `POST` to `/api/health` does not match and falls through to
Express's built-in 404.

The `(req, res)` signature is the core Express contract:

* **`req`** — the incoming request. Express extends Node's `IncomingMessage`
  with `req.params`, `req.query`, `req.body`, `req.headers`, `req.method`, and
  more. It is unused here, but the parameter must be declared to reach `res`.
* **`res`** — the outgoing response. You build it up, and **nothing** is sent to
  the client until you call a terminating method (`res.json()`, `res.send()`,
  `res.end()`).

A third parameter, `next`, exists but is omitted because this handler always
completes the response itself and never delegates.

`res.json(obj)` does three things in one call:

1. serialises `obj` with `JSON.stringify()`;
2. sets `Content-Type: application/json; charset=utf-8`;
3. sends the body and **ends** the response.

The status defaults to `200 OK`; chain `res.status(503).json(...)` to change it.
Because it ends the response, a second `res.json()` in the same handler throws
`Cannot set headers after they are sent to the client`.

The endpoint itself is the standard **health check / liveness probe** pattern: a
trivial, cheap, unauthenticated URL whose only job is to answer "is this process
alive and serving HTTP?". Load balancers, Docker/Kubernetes probes, uptime
monitors and PaaS hosts poll exactly this kind of route on a timer and restart or
depool the instance when it stops answering. It is also the fastest manual check
that the Vite proxy is wired correctly. The payload shape is our own choice:
`status: 'ok'` is the machine-readable field a monitor asserts on, `message` is
for a human. A mature version would also report uptime, build version, and
database connectivity — and would then be able to return `503` when the DB is
down, which the current always-`200` version cannot.

### Chunk 6 — listening

```js
app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
```

This is the only line that touches the network. It creates a Node `http.Server`
wrapping `app`, binds it to TCP port `PORT` on every local interface, and starts
accepting connections.

`app.listen()` is **asynchronous and non-blocking**. It returns the server object
immediately and does not pause execution — any statement written after it would
run right away, most likely *before* the socket is even bound. That is precisely
why the confirmation message is inside a callback: Node invokes that arrow
function exactly once, on the server's `listening` event, which is the first
moment the port is genuinely open and a request could arrive.

After this, the process does not exit. The bound socket is an active handle in
libuv's event loop, so Node keeps the loop alive indefinitely, dispatching each
incoming request through the middleware chain above.

If the port is already occupied, the server emits an `error` event with code
`EADDRINUSE`. Nothing here listens for it, so the process crashes with an
unhandled error — the familiar "something is already running on 5000" symptom.
Handling that (and `SIGTERM`) is part of the graceful-shutdown work listed in §7.

The message uses a template literal (backticks) so `${PORT}` is interpolated.
Printing a full clickable URL rather than a bare number is a small kindness, and
nodemon reprints it after every restart.

---

## 5. Request lifecycle: `GET /api/health`

Both dev servers are running (`pnpm dev`): Vite on `:3000`, Express on `:5000`.
The browser has `http://localhost:3000` open and the app calls `fetch('/api/health')`.

1. **Browser** — `fetch('/api/health')` uses a *relative* URL, so the browser
   resolves it against the page's own origin: `http://localhost:3000/api/health`.
   Because the target origin equals the page origin, the same-origin policy is
   satisfied and **no CORS check and no preflight happen at all**.
2. **Vite dev server (`:3000`)** — receives the request. Its `server.proxy`
   config in `frontend/vite.config.js` matches the `/api` prefix and, instead of
   trying to serve a file, opens a *new server-side HTTP request* to
   `http://localhost:5000/api/health`. `changeOrigin: true` rewrites the `Host`
   header to `localhost:5000`. This hop is plain server-to-server traffic — no
   browser, therefore no origin rules apply.
3. **Express (`:5000`)** — Node's HTTP server accepts the connection and hands
   the request to the `app` function registered by `app.listen`.
4. **`cors()` middleware** — runs first, because it was registered first. It sets
   `Access-Control-Allow-Origin: *` on the response and calls `next()`. In this
   particular flow the header is decorative (the browser already considers the
   call same-origin thanks to the proxy), but it is what makes a direct
   `http://localhost:5000` call from another origin work.
5. **`express.json()` middleware** — runs second. It checks `Content-Type`; a
   `GET` has no body and no JSON content type, so it does nothing and calls
   `next()` essentially for free. `req.body` stays `undefined`.
6. **Router matching** — Express walks its registered routes and finds the
   `GET '/api/health'` entry. Method and path both match, so the handler runs.
   (No match would mean Express's default 404 HTML response.)
7. **Handler** — `res.json({ status: 'ok', message: '...' })` stringifies the
   object, sets `Content-Type: application/json; charset=utf-8` and `Content-Length`,
   sets status `200`, writes the body, and ends the response.
8. **Back through the proxy** — Express writes the response onto the socket Vite
   opened. Vite streams the status, headers and body back out on the connection
   the browser is holding.
9. **Browser** — the `fetch` promise resolves. `await res.json()` parses the body
   into `{ status: 'ok', message: 'Server is running perfectly!' }`. To the page,
   this looked like an ordinary same-origin request the whole time.

The point of the proxy is exactly that: in development it removes the CORS
problem instead of solving it. In production the frontend is a static bundle
served from a real domain, there is no Vite process, and the browser talks to the
API's real origin — at which point step 4's CORS configuration stops being
decorative and becomes the thing that must be correct.

---

## 6. How to run it

From the **repo root** (`1on1/`). This repo enforces pnpm — the root
`preinstall` script runs `only-allow pnpm`, so `npm install` and `yarn` will be
rejected on purpose.

```bash
# 1. Install every workspace's dependencies (root, backend, frontend) at once.
pnpm install

# 2. Start ONLY the backend, with nodemon watching for changes.
pnpm dev:backend
```

Expected output:

```text
[nodemon] starting `node src/server.js`
Backend server is running on http://localhost:5000
```

Verify from a second terminal:

```bash
curl http://localhost:5000/api/health
# {"status":"ok","message":"Server is running perfectly!"}
```

Other useful commands:

```bash
pnpm dev              # backend + frontend together, via concurrently
pnpm dev:frontend     # Vite only, on http://localhost:3000

# Through the Vite proxy — proves the frontend->backend wiring (needs both running):
curl http://localhost:3000/api/health

# Production-style run, no watcher:
pnpm --filter 1on1-backend run start
```

**Notes.** No `.env` is required — `PORT` falls back to `5000` (and `.env` is
gitignored, so a fresh clone has none). To change the port, create `.env` at the
repo root with `PORT=5001`; both Vite (via `envDir: '../'`) and the backend read
that same file, though the proxy `target` in `vite.config.js` is currently
hard-coded to `:5000` and would need updating too. If startup fails with
`EADDRINUSE`, another process holds the port: on Windows,
`netstat -ano | findstr :5000` then `taskkill /PID <pid> /F`.

---

## 7. What is missing / next steps

Measured against [`docs/03-system-design.md`](../03-system-design.md), which
specifies MongoDB Atlas + Mongoose, JWT auth with HTTP-only cookies, Google
OAuth, Socket.IO rooms, WebRTC signaling, and a Gemini AI/agent layer, the gaps
are structural rather than cosmetic.

### Structural gaps

| Missing | Why it matters | Where the design calls for it |
| --- | --- | --- |
| **Router layer** | Every route is registered inline in `server.js`. That file becomes unmaintainable at ~5 routes. Needs `express.Router()` per feature, mounted as `app.use('/api/users', userRoutes)`. | §34 "Backend Layering": Routes → Controllers → Services → Models |
| **Controllers** | Nothing separates HTTP concerns (parsing `req`, shaping `res`) from business logic, so logic cannot be reused. | §34 |
| **Services** | The AI agent and the UI are both required to call the *same* `cancelSession()`. With logic inline in handlers that is impossible. | §35 "one source of truth for business rules" — explicitly forbids a duplicated `cancelSessionFromAI()` |
| **Models** | No Mongoose schemas, no DB connection, no `MONGODB_URI` read. Nothing is persisted; the server is stateless. | §2, §31 (MongoDB Atlas as the primary data layer) |
| **Auth middleware** | No JWT verification, no `req.user`, no password hashing, no refresh-token rotation, no route protection. Every endpoint is public. | §4 Authentication Flow, §33 Security |
| **Centralized error handler** | Only Express's default handler exists, which leaks stack traces in dev and returns HTML. Needs the 4-arg `(err, req, res, next)` middleware registered last, plus an `AppError` class and an async-handler wrapper (an ESM/Express 4 handler that rejects will otherwise hang the request). | Implied by §33 |
| **Request validation** | Nothing checks `req.body`. Unvalidated input reaching Mongo is both a correctness and a security problem. Needs Zod/Joi/`express-validator` at the route boundary. | §33 "Input validation" |
| **Logging** | One `console.log`. No request logging, no levels, no request IDs, no structured output — undebuggable once deployed. Needs `morgan` and/or `pino`. | §33 "Audit logs for important agent actions" |
| **Graceful shutdown** | No `SIGTERM`/`SIGINT` handler, no `server.close()`, no DB disconnect. On deploy the process is killed mid-request. Also no `EADDRINUSE` handling and no `unhandledRejection` guard. | Implied by §32 (Render, then GCP) |
| **Tests** | No test runner, no test script, not one test. | — |

### Feature gaps

* **Socket.IO gateway** — no realtime server, no rooms (`session:abc123`), no
  presence, none of the chat/typing/seen/reaction/whiteboard events (§16–§18).
* **WebRTC signaling** — no offer/answer/ICE relay over Socket.IO (§14).
* **Gemini AI layer** — no AI routes, no agent orchestrator, no tool contracts,
  no confirmation model for destructive tools, no prompt-injection defense, no
  moderation pipeline (§19–§24).
* **Security hardening** — no rate limiting, no `helmet`, no CSRF consideration,
  no cookie parsing, and the wide-open `cors()` still needs an origin allowlist
  (§33).
* **Certification verification** — no SHA-256 hashing or public verification
  endpoint (§25).
* **Notifications** — no persistence and no realtime emit (§26).

### A reasonable build order

1. Restructure into `routes/ → controllers/ → services/`, keeping `/api/health`
   as the first thing to move.
2. Add centralized error handling + an async wrapper, then request validation.
3. Connect MongoDB via Mongoose; add `config/db.js` and the `User` model.
4. Build auth: signup, login, password hashing, JWT access + refresh, auth
   middleware; lock down CORS with `credentials: true` at the same time.
5. Add logging and graceful shutdown before the first deploy.
6. Layer on Socket.IO, then WebRTC signaling, then the AI/agent layer — the
   agent reusing the services from step 1, never reimplementing them.

---

## 8. Dependency summary

| Package | Version range | Runtime / Dev | Purpose |
| --- | --- | --- | --- |
| `express` | `^4.18.2` | runtime | HTTP server framework — routing, middleware pipeline, `req`/`res` helpers. Also supplies the built-in `express.json()` body parser. |
| `cors` | `^2.8.5` | runtime | Sets Cross-Origin Resource Sharing response headers and answers `OPTIONS` preflights so a browser on another origin may read responses. |
| `dotenv` | `^16.3.1` | runtime | Loads the repo-root `.env` file into `process.env` so configuration and secrets stay out of source control. |
| `nodemon` | `^3.0.1` | **dev** | File watcher that restarts `node src/server.js` on every save. Never imported by application code, so it is excluded from production installs. |

`path` and `url` are Node built-ins and correctly absent from `package.json`.

The `^` (caret) prefix allows automatic minor and patch upgrades but not major
ones — `^4.18.2` accepts `4.19.0`, never `5.0.0`. The exact versions actually
installed are pinned in the root `pnpm-lock.yaml`, which is the file that makes
installs reproducible.

> This table is intentionally shallow. For the full dependency deep-dive —
> transitive trees, why each package was chosen over alternatives, version
> pinning policy, security posture and upgrade paths — see
> [`06-dependencies.md`](./06-dependencies.md).
