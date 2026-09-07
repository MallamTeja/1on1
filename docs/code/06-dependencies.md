# 06 — Dependencies

The definitive reference for every third-party package in this repository: what manages
them, what each one is, why it is here, where it is actually used, and what commonly
goes wrong with it.

Everything below is grounded in files in this repo:
`package.json`, `backend/package.json`, `frontend/package.json`, `pnpm-workspace.yaml`,
`.npmrc`, `pnpm-lock.yaml`, `frontend/vite.config.js`, `backend/src/server.js`,
`.gitignore`, `.github/dependabot.yml`, `docs/02-technology-stack.md`.

Where a claim could not be verified from a file in this repo, it is explicitly marked
**not verified**.

---

## 1. How dependencies are managed here

### 1.1 It is a pnpm workspace (a monorepo)

A **monorepo** is a single Git repository that holds more than one independently
installable package. A **workspace** is the package manager's feature that makes that
work: one lockfile, one shared store, one `install` command, but several packages that
each have their own `package.json`, their own dependencies and their own scripts.

`pnpm-workspace.yaml` at the repo root is what declares the workspace:

```yaml
packages:
  - 'frontend'
  - 'backend'
allowBuilds:
  esbuild: true
```

Two workspace packages, `frontend` and `backend`. The root itself is *not* listed under
`packages:` — the root is always the workspace root implicitly, and it is not a
publishable package.

### 1.2 Three `package.json` files, three different jobs

| File | Package name | Role | Deps declared |
|---|---|---|---|
| `package.json` | `1on1` | **Orchestration only.** Holds the scripts that start both apps at once, the package-manager policy (`preinstall`, `devEngines`), and nothing else. | `concurrently` (dev) |
| `backend/package.json` | `1on1-backend` | **Server runtime.** Node/Express API. Has `start` and `dev` scripts. | `express`, `cors`, `dotenv`; dev: `nodemon` |
| `frontend/package.json` | `1on1-frontend` | **Browser app.** React + Vite SPA. Has `dev`, `build`, `lint`, `preview`. Marked `"private": true` so it can never be accidentally published to npm. | `react`, `react-dom`; dev: Vite, ESLint, types |

The **package names** matter more than the folder names — `pnpm --filter` targets the
name, not the directory. See [§6](#6-install--audit--update-cheatsheet).

Root scripts (`package.json` lines 6–11):

```json
"scripts": {
  "preinstall": "pnpm dlx only-allow pnpm",
  "dev:backend": "pnpm --filter 1on1-backend run dev",
  "dev:frontend": "pnpm --filter 1on1-frontend run dev",
  "dev": "concurrently \"pnpm run dev:backend\" \"pnpm run dev:frontend\""
}
```

Note the root has **no** `build` and no `test` script yet.

### 1.3 Why pnpm and not npm or yarn: the strict `node_modules`

This is the single biggest practical reason this project uses pnpm.

**npm / yarn (classic) use flat hoisting.** They take the whole transitive dependency
tree and flatten it into one big top-level `node_modules/` directory. If `express`
depends on `body-parser`, then `node_modules/body-parser` physically exists at the top
level. Node's resolution algorithm walks up directories looking for `node_modules`, so
your application code can `import 'body-parser'` and it *works* — even though you never
declared it. That is a **phantom dependency**. It is a real bug source: the day
`express` drops or renames that sub-dependency, your unrelated code breaks, and nothing
in your `package.json` explains why.

**pnpm uses a content-addressable store plus symlinks.** Every version of every package
is unpacked exactly once into a global store on disk, and `node_modules` is built out of
links into that store:

```
node_modules/
├── .pnpm/                        <- the real, flat store of every package version
│   ├── express@4.22.2/node_modules/express/      (hard-linked from the global store)
│   │   └── node_modules/         <- express's OWN deps, symlinked in here
│   ├── body-parser@.../
│   └── ...
├── express -> .pnpm/express@4.22.2/node_modules/express   <- symlink
└── (nothing else you did not declare)
```

The top level of `node_modules` contains **only the packages that that package's own
`package.json` declares**. `body-parser` is reachable from inside `express`, but it is
not visible to your code. Importing something you did not declare fails immediately with
`ERR_MODULE_NOT_FOUND` instead of silently working. That is the whole point: pnpm makes
the dependency graph honest.

Two side benefits fall out of the store design:

- **Disk space.** The same `react@18.3.1` shared by ten projects is stored once and
  hard-linked, not copied ten times.
- **Install speed.** After the first install, subsequent installs are mostly link
  creation, not download-and-extract.

> Verified state of this checkout: `node_modules/`, `frontend/node_modules/` and
> `backend/node_modules/` do **not** currently exist. Nothing has been installed here
> yet — run `pnpm install` from the repo root before any script will work.
> `node_modules` is also the first line of `.gitignore`, as it should be.

### 1.4 `preinstall: pnpm dlx only-allow pnpm` — the package-manager lock

```json
"preinstall": "pnpm dlx only-allow pnpm"
```

npm, yarn and pnpm all run a `preinstall` script before installing. `only-allow` is a
tiny package that inspects which package manager invoked it (via the
`npm_config_user_agent` environment variable) and **exits non-zero** if it is not the one
named. So:

- `pnpm install` → passes, install proceeds.
- `npm install` → `preinstall` fails, install aborts with a message telling you to use pnpm.
- `yarn install` → same.

Why bother? Because a stray `npm install` would generate a `package-lock.json` alongside
`pnpm-lock.yaml`, install a *flat* `node_modules` (re-introducing phantom dependencies),
and resolve versions independently of the pnpm lockfile. You would then have two
lockfiles disagreeing about reality and CI installing something different from your
laptop. This one line keeps `pnpm-lock.yaml` the **single source of truth**.

**`pnpm dlx`** is pnpm's equivalent of `npx`: *download, run, discard*. It fetches
`only-allow` into a temporary location, executes it, and does not add it to
`package.json` or `node_modules`. Use `dlx` for one-shot CLI tools you never want as a
dependency (scaffolders, codemods, checks like this one).

### 1.5 Lifecycle-script blocking and `esbuild`

Two files in this repo are doing the same job:

`.npmrc`
```ini
only-built-dependencies=["esbuild"]
```

`pnpm-workspace.yaml`
```yaml
allowBuilds:
  esbuild: true
```

**The problem they solve.** An npm package can declare `postinstall` / `preinstall` /
`install` lifecycle scripts that execute arbitrary code on your machine the moment it is
installed — before you have run a single line of your own code, and typically without you
ever reading that package's source. This is the most heavily exploited supply-chain
attack vector in the npm ecosystem: compromise a widely-used transitive dependency, add a
`postinstall` that exfiltrates environment variables or SSH keys, publish a patch version,
and every `^`-ranged installer picks it up automatically.

**pnpm v10 and later block build/lifecycle scripts by default.** Nothing runs a
`postinstall` unless you explicitly allow it, per package, by name. pnpm prints a warning
listing the packages whose scripts it skipped.

**Why `esbuild` is the exception.** `esbuild` is a Go binary distributed as
platform-specific npm packages. Its install script picks and places the correct native
binary for your OS/CPU. Blocked, `esbuild` installs but has no runnable binary, and Vite
fails at startup. So it is allow-listed — a genuine, well-understood need, allowed by
name, one package.

`esbuild` is **not a direct dependency** of anything in this repo. It arrives
transitively through Vite: `pnpm-lock.yaml` resolves `esbuild@0.21.5` as a dependency of
`vite@5.4.21`. That is exactly why it must be named in an allow-list.

> **Not verified / version caveat.** These two settings are overlapping mechanisms that
> pnpm has spelled differently across major versions. The documented `.npmrc` syntax for
> a pnpm *list* setting is normally `only-built-dependencies[]=esbuild` (repeated per
> entry); the JSON-array form used here (`only-built-dependencies=["esbuild"]`) was not
> verified to parse. Likewise pnpm 10 spelled the workspace-file setting
> `onlyBuiltDependencies: [esbuild]` (a list), while this repo uses the map form
> `allowBuilds: { esbuild: true }`. The **intent** of both is unambiguous and identical:
> allow `esbuild` to run its install script, block everything else. If a `pnpm install`
> ever warns that esbuild's build was skipped, the `pnpm-workspace.yaml` entry is the one
> to trust on pnpm 10+, and `pnpm approve-builds` is the interactive way to fix it.

### 1.6 `devEngines.packageManager` — pinning pnpm itself

```json
"devEngines": {
  "packageManager": {
    "name": "pnpm",
    "version": "^11.5.2",
    "onFail": "download"
  }
}
```

| Field | Meaning |
|---|---|
| `name: "pnpm"` | The package manager this repo expects for development. |
| `version: "^11.5.2"` | A semver range, not a fixed pin — any pnpm 11.x at or above 11.5.2. |
| `onFail: "download"` | If the pnpm currently on `PATH` does not satisfy the range, **fetch one that does** and use it, rather than erroring out. Other `onFail` values are `error` / `warn` / `ignore`. |

`devEngines` is the *development-time* counterpart to the older `engines` field.
`engines` describes what is needed to *run* the published package; `devEngines` describes
what is needed to *work on* it, and unlike `engines` it can be actively enforced.

**This is verified to have actually happened here.** `pnpm-lock.yaml` is two YAML
documents. The first exists solely to lock the downloaded package manager:

```yaml
importers:
  .:
    packageManagerDependencies:
      '@pnpm/exe':
        specifier: ^11.5.2
        version: 11.13.0
      pnpm:
        specifier: ^11.5.2
        version: 11.13.0
```

So the `^11.5.2` range resolved to **pnpm 11.13.0**, and that resolution is itself locked
— every contributor gets the same pnpm, not "whatever pnpm I happened to install globally
two years ago". The `---` separator, then a second `lockfileVersion: '9.0'` document, is
where the project's real dependency graph lives.

Combined with `preinstall`, the policy is: *you must use pnpm, and you must use this pnpm.*

### 1.7 `"type": "module"` in all three `package.json` files

All three declare `"type": "module"`. This flips Node's default interpretation of `.js`
files in that package from CommonJS to **ES modules**.

| | `"type": "commonjs"` (Node default) | `"type": "module"` (this repo) |
|---|---|---|
| Import syntax | `const express = require('express')` | `import express from 'express'` |
| Export syntax | `module.exports = app` | `export default app` |
| `__dirname` / `__filename` | Provided automatically | **Do not exist** |
| `require()` | Available | Not available (use `createRequire` if truly needed) |
| Top-level `await` | No | Yes |
| Force the other mode for one file | `.mjs` | `.cjs` |

The concrete consequence is visible in `backend/src/server.js` lines 4–8:

```js
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

That five-line dance exists *only* because `"type": "module"` removed the free
`__dirname`. In ESM you get `import.meta.url` instead — a `file://` URL string — which
`fileURLToPath` converts back to a real filesystem path. If you ever see
`ReferenceError: __dirname is not defined in ES module scope`, this is why.

The same setting is why `frontend/vite.config.js` can use `import` / `export default`
without being renamed to `.mjs`, and why a future ESLint config file in `frontend/` would
have to be ESM — or explicitly named `.cjs`. See [§3.15](#eslint-has-no-configuration-file-in-this-repository).

---

## 2. Semver primer

npm versions are `MAJOR.MINOR.PATCH` and the contract is:

- **MAJOR** — breaking changes. Your code may need edits.
- **MINOR** — new features, backwards compatible.
- **PATCH** — bug fixes, backwards compatible.

A dependency in `package.json` is not a version; it is a **range**. Here is every range
operator that matters, each illustrated with a real declaration from this repo:

| Range | Means | Real example here | Accepts | Rejects |
|---|---|---|---|---|
| `^4.18.2` (caret) | Allow MINOR and PATCH updates; lock MAJOR | `express: "^4.18.2"` (`backend/package.json`) | `>=4.18.2 <5.0.0` — e.g. 4.19.0, 4.22.2 | 5.0.0 |
| `~16.3.1` (tilde) | Allow PATCH only; lock MINOR | *(none in this repo)* | `>=16.3.1 <16.4.0` | 16.4.0 |
| `16.3.1` (exact) | Only that one version | *(none in this repo)* | 16.3.1 | 16.3.2 |
| `>=18.0.0 <19` | Explicit range | appears in engine fields of dependencies | as written | as written |
| `*` / `latest` | Anything | *(none — avoid)* | everything | nothing |
| `^0.4.5` | **Special case:** for `0.x`, caret locks the MINOR too | `eslint-plugin-react-refresh: "^0.4.5"` | `>=0.4.5 <0.5.0` | 0.5.0 |

That last row is the one people get wrong. Under semver, `0.x` versions are declared
unstable, so npm treats the *minor* as the breaking-change slot: `^0.4.5` will **not**
take `0.5.0`. Only `eslint-plugin-react-refresh` is affected in this repo.

**Every dependency in this repo uses `^`.** No exact pins, no tildes. That is the normal
default for an application, and it is safe *only because a lockfile exists*.

### Why the lockfile exists

`^4.18.2` does not identify a build. Install today and install in six months and you can
get different bytes. `pnpm-lock.yaml` records, for every package in the entire transitive
graph:

- the exact resolved version,
- the registry tarball's **integrity hash** (`sha512-…`), so a tampered or re-published
  tarball is rejected,
- the full peer-dependency-aware resolution (note how the lockfile writes `react-dom` as
  `18.3.1(react@18.3.1)` — the peer it was resolved against is part of its identity).

Look at what the ranges in this repo actually resolved to — the gap is the point:

| Package | Declared | Locked |
|---|---|---|
| `express` | `^4.18.2` | **4.22.2** |
| `cors` | `^2.8.5` | **2.8.6** |
| `dotenv` | `^16.3.1` | **16.6.1** |
| `nodemon` | `^3.0.1` | **3.1.14** |
| `react` / `react-dom` | `^18.2.0` | **18.3.1** |
| `vite` | `^5.0.8` | **5.4.21** |
| `eslint` | `^8.55.0` | **8.57.1** |
| `@vitejs/plugin-react` | `^4.2.1` | **4.7.0** |

Not one package is running the version its range names.

**The lockfile must be committed.** `pnpm-lock.yaml` is tracked in Git here (verified with
`git ls-files`) — correct. Without it:

- your machine, your teammate's machine and CI silently run different code,
- "works on my machine" bugs become unreproducible,
- a malicious minor release of any transitive dependency is picked up automatically on the
  next install, with nothing to diff in code review.

With it, `pnpm install --frozen-lockfile` (the default in CI) guarantees the exact same
graph or fails loudly. A lockfile change showing up in a pull request is a **feature** —
it is the diff that makes a dependency change reviewable.

---

## 3. Dependency catalogue

Fifteen direct dependencies across three packages. Locked versions read from
`pnpm-lock.yaml`.

| Package | Workspace | Type | Declared | Locked |
|---|---|---|---|---|
| `concurrently` | root (`1on1`) | dev | `^8.2.2` | 8.2.2 |
| `express` | `1on1-backend` | runtime | `^4.18.2` | 4.22.2 |
| `cors` | `1on1-backend` | runtime | `^2.8.5` | 2.8.6 |
| `dotenv` | `1on1-backend` | runtime | `^16.3.1` | 16.6.1 |
| `nodemon` | `1on1-backend` | dev | `^3.0.1` | 3.1.14 |
| `react` | `1on1-frontend` | runtime | `^18.2.0` | 18.3.1 |
| `react-dom` | `1on1-frontend` | runtime | `^18.2.0` | 18.3.1 |
| `vite` | `1on1-frontend` | dev | `^5.0.8` | 5.4.21 |
| `@vitejs/plugin-react` | `1on1-frontend` | dev | `^4.2.1` | 4.7.0 |
| `@types/react` | `1on1-frontend` | dev | `^18.2.43` | 18.3.31 |
| `@types/react-dom` | `1on1-frontend` | dev | `^18.2.17` | 18.3.7 |
| `eslint` | `1on1-frontend` | dev | `^8.55.0` | 8.57.1 |
| `eslint-plugin-react` | `1on1-frontend` | dev | `^7.33.2` | 7.37.5 |
| `eslint-plugin-react-hooks` | `1on1-frontend` | dev | `^4.6.0` | 4.6.2 |
| `eslint-plugin-react-refresh` | `1on1-frontend` | dev | `^0.4.5` | 0.4.26 |

> **runtime vs dev.** `dependencies` are needed when the code *runs* — they ship to the
> server or into the browser bundle. `devDependencies` are needed only to *develop or
> build* — they are skipped by `pnpm install --prod` and never reach production. The
> frontend split looks odd at first (React is a `dependency`, Vite is a `devDependency`)
> but it is right: React's code ends up inside the built bundle; Vite is the machine that
> produced the bundle and is not deployed.

---

### concurrently

- **What it is.** A small CLI that runs several long-lived commands in one terminal,
  interleaving their output with a per-command prefix and colour, and managing their
  lifecycle as a group.
- **Why this project has it.** This is a two-process app: an Express API and a Vite dev
  server. Without `concurrently` you need two terminals and you must remember to start
  both. With it, `pnpm dev` at the root starts everything.
- **Where it is used.** `package.json` line 10:
  ```json
  "dev": "concurrently \"pnpm run dev:backend\" \"pnpm run dev:frontend\""
  ```
  which fans out to lines 8–9, each of which is a `pnpm --filter <name> run dev`.
- **Version.** `^8.2.2`, locked at 8.2.2. Root, **dev**.
- **About the `\"` escaping.** Inside a JSON string, `"` must be written `\"`. The *inner*
  quotes are not decoration — they are load-bearing. `concurrently` takes each quoted
  string as **one whole command**. Without them the shell would split on spaces and
  `concurrently` would try to run `pnpm`, `run`, `dev:backend`, `pnpm`, `run`,
  `dev:frontend` as six separate programs. Double quotes specifically (not single) are
  used because Windows `cmd.exe` does not treat `'` as a quote character at all — this
  script has to work in PowerShell, `cmd.exe`, bash and zsh alike.
- **What commonly goes wrong.** (a) Losing or mismatching those quotes — the symptom is a
  flood of "command not found". (b) Interleaved output making it hard to tell which
  process logged what; fix with `concurrently -n api,web -c blue,green`. (c) One process
  crashing while the other keeps running, so `pnpm dev` looks alive but half the app is
  dead; `--kill-others-on-fail` makes the failure obvious. (d) `Ctrl-C` occasionally
  orphaning a child that keeps port 3000 or 5000 bound.

---

### express

- **What it is.** The de-facto minimal, unopinionated HTTP framework for Node. It gives
  you routing (`app.get`, `app.post`, `app.use`), a request/response abstraction over
  Node's raw `http` module, and — the core idea — a **middleware pipeline**.
- **The middleware model.** An Express app is an ordered array of functions with the
  signature `(req, res, next)`. Each request walks the array top to bottom. A middleware
  either ends the request (`res.json(...)`) or calls `next()` to pass control onward.
  Order is therefore semantics, not style. In `backend/src/server.js`:
  ```js
  app.use(cors());          // line 14 — runs first, on every request
  app.use(express.json());  // line 15 — then parses a JSON body into req.body
  app.get('/api/health', …) // line 17 — only then does routing get a look
  ```
  Move `express.json()` below the route and `req.body` would be `undefined` inside it.
  Note `express.json()` is built into Express 4.16+ — the separate `body-parser`
  dependency people remember is no longer needed, and correctly does not appear in
  `backend/package.json`.
- **Why this project has it.** It is the REST layer. `docs/02-technology-stack.md` §7
  lists the API surface Express is expected to grow into: auth, users, profiles, follow,
  posts, comments, search, sessions, availability, reviews, notifications, certifications,
  achievements and AI tools. Today exactly one route exists.
- **Where it is used.** `backend/src/server.js` — import line 1, app created line 11,
  middleware lines 14–15, the `/api/health` route lines 17–19, `app.listen` lines 21–23 on
  `process.env.PORT || 5000`.
- **Version.** `^4.18.2`, locked at **4.22.2**. Backend, **runtime**.
- **Why 4.x deliberately.** Express 5 is released, and it is a genuine breaking change:
  - **async error handling** — Express 5 catches rejected promises from route handlers and
    forwards them to the error middleware; in Express 4 an un-awaited rejection is an
    unhandled rejection and the request hangs, which is why 4.x codebases wrap handlers in
    `try/catch` or an `asyncHandler` helper.
  - **`req.query` is now a getter** and, along with other request properties, is no longer
    a plain mutable object — code that assigned to `req.query` breaks.
  - **`path-to-regexp` v8 route syntax** — wildcard and optional-parameter syntax changed.
    A bare `'*'` route and `'/:param?'` no longer parse the old way; they must be written
    `'/*splat'` and `'{/:param}'`. A bad route pattern throws at *startup*, not at request
    time.
  - Several long-deprecated helpers (`res.sendfile`, `app.del`, `res.json(status, obj)`)
    are removed.

  Staying on `^4.18.2` is the right call for a project at this stage: the caret keeps
  security patches flowing (hence 4.22.2) while the major boundary blocks the migration
  until someone chooses to do it deliberately.
- **What commonly goes wrong.** Middleware ordering, as above. Also: forgetting that a
  4-argument function `(err, req, res, next)` is an *error* middleware and must be
  registered **last**; and forgetting that in Express 4 an `async` handler that throws will
  hang the client rather than 500.

---

### cors

- **What it is.** An Express middleware that writes the `Access-Control-Allow-*` response
  headers and answers CORS preflight requests.
- **The browser rule it exists for.** Browsers enforce the **same-origin policy**: a page
  loaded from origin A may not read the response of a `fetch`/`XHR` to origin B unless B
  opts in. An *origin* is the triple `scheme + host + port`, so `http://localhost:3000`
  (the Vite dev server) and `http://localhost:5000` (Express) are **different origins** —
  same host, different port is enough.

  For anything beyond a "simple" request (a custom header such as `Authorization`, or a
  content type other than form/text/plain), the browser first sends a **preflight**: an
  `OPTIONS` request asking "may I send a `POST` with a `Content-Type: application/json`
  header?" The server must answer `204` with `Access-Control-Allow-Origin`,
  `-Allow-Methods` and `-Allow-Headers`, or the browser never sends the real request.

  Crucially, CORS is enforced by the **browser only** — `curl` and Postman ignore it
  entirely, which is why "it works in Postman but not in the app" is the classic CORS
  symptom.
- **Why this project has it.** Frontend and backend run on different ports in development,
  and are expected to be deployed as separate services.
- **Where it is used.** `backend/src/server.js` — import line 2, applied line 14 as
  `app.use(cors())`.
- **Version.** `^2.8.5`, locked at **2.8.6**. Backend, **runtime**.
- **Bare `cors()` means allow everything.** With no options the middleware sends
  `Access-Control-Allow-Origin: *` — any website on the internet may call this API from a
  user's browser. That is acceptable for a health endpoint on localhost. It is **not**
  acceptable once `docs/02-technology-stack.md` §3's cookie-based refresh tokens exist,
  because `*` is *incompatible* with credentials: a browser refuses to send cookies to a
  wildcard origin. That configuration will have to become explicit:
  ```js
  app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
  ```
- **It is currently redundant in dev.** `frontend/vite.config.js` lines 9–13 proxy `/api`
  to `http://localhost:5000`. A proxied request leaves the browser addressed to
  `localhost:3000` — the same origin as the page — so no CORS check ever happens in
  development. The `cors()` middleware matters in production, and in dev only if the
  frontend ever calls `http://localhost:5000` directly instead of through `/api`.
- **What commonly goes wrong.** Registering `cors()` *after* the routes (preflight
  `OPTIONS` never gets the headers); expecting `origin: '*'` to work with
  `credentials: true`; and mistaking a 500 for a CORS error — a crashed handler produces a
  response with no CORS headers, so the browser reports it as a CORS failure and hides the
  real error.

---

### dotenv

- **What it is.** Reads a `.env` file and copies its `KEY=value` pairs into `process.env`.
  That is the whole library.
- **Why this project has it.** Configuration and secrets (port, database URI, JWT secret,
  Gemini API key) must live outside the source tree. `.env` gives you per-machine
  configuration that is never committed.
- **Where it is used.** `backend/src/server.js` — import line 3, called line 10:
  ```js
  dotenv.config({ path: path.join(__dirname, '../../.env') });
  ```
  `__dirname` here is `backend/src`, so `../../.env` is **`.env` at the repository root** —
  one shared env file for the whole monorepo, not one per package. That choice is mirrored
  on the frontend: `frontend/vite.config.js` line 5 sets `envDir: '../'`, pointing Vite at
  the same root file. Line 12 then consumes it:
  `const PORT = process.env.PORT || 5000;`
- **Version.** `^16.3.1`, locked at **16.6.1**. Backend, **runtime** (it runs at boot, so it
  genuinely belongs in `dependencies`, not `devDependencies`).
- **`.env` is gitignored here.** `.gitignore` contains exactly two entries: `node_modules`
  and `.env`. Correct — but note there is **no `.env.example` committed**, so a new
  contributor has no list of which variables they need to define. Adding one is a cheap
  win.
- **dotenv does not override.** By default `dotenv.config()` will **not** overwrite a
  variable that is already set in `process.env`. Real environment beats file. This is
  deliberate and usually what you want — in production you set real env vars and there is
  no `.env` file at all; on CI, the CI-provided variables win. It also means editing
  `.env` has no effect if the same variable is exported in your shell. Pass
  `{ override: true }` to invert this, but think first.
- **What commonly goes wrong.** (a) Calling `dotenv.config()` *after* importing a module
  that reads `process.env` at import time — ESM hoists all `import` statements above other
  code, so a module imported at the top of `server.js` runs *before* line 10 and sees an
  empty `process.env`. Today `server.js` imports nothing of its own, so it is safe; the
  moment a `config.js` or `db.js` is added this becomes a live footgun (the fix is
  `import 'dotenv/config'` as the very first import, or a dedicated config module).
  (b) Committing `.env` by accident. (c) Everything in `process.env` is a **string** —
  `process.env.PORT` is `"5000"`, not `5000`, and `process.env.DEBUG === 'false'` is
  truthy.

---

### nodemon

- **What it is.** A development supervisor for Node. It runs your process, watches the
  filesystem, and on any change to a watched file kills the process and starts it again.
- **Why this project has it.** Node does not reload code. Without nodemon, every edit to
  `server.js` means manually stopping and restarting the server.
- **Where it is used.** `backend/package.json`:
  ```json
  "start": "node src/server.js",     // production: plain node, no watcher
  "dev":   "nodemon src/server.js"   // development
  ```
  Reached from the root via `pnpm --filter 1on1-backend run dev` (`package.json` line 8).
- **Version.** `^3.0.1`, locked at **3.1.14**. Backend, **dev** — correctly, since
  production uses `start`.
- **What commonly goes wrong.** (a) **Restart loops** — if the app writes a file inside a
  watched directory (a log, a build artifact), nodemon restarts, which writes again,
  forever. Fix with a `nodemon.json` `ignore` list. There is no `nodemon.json` in this
  repo, so defaults apply. (b) **`EADDRINUSE`** — the old process has not released port
  5000 before the new one binds it. (c) On Windows and on network- or cloud-synced
  filesystems, native file-watching events can be unreliable; `nodemon --legacy-watch`
  (polling) is the workaround. **This repository lives under a OneDrive path**
  (`C:\Users\tejam\OneDrive\...`), which is exactly the setup where that flag sometimes
  becomes necessary — worth knowing if saves stop triggering restarts.
- **Modern alternative.** Node 18.11+ has a built-in `node --watch src/server.js`, which
  covers the basic case with zero dependencies. Nodemon still wins on configurability
  (extension filters, ignore lists, custom exec, delay).

---

### react

- **What it is.** The component model and the reconciler — `createElement`, JSX's runtime,
  the `Component` class, hooks (`useState`, `useEffect`, …), context, `StrictMode`,
  `Suspense`. It is deliberately **renderer-agnostic**: the `react` package knows how to
  compute *what the UI should be*, and knows nothing at all about the DOM. That is why the
  same `react` package backs React Native, `react-three-fiber`, Ink (terminal UIs) and
  custom renderers.
- **Why this project has it.** It is the frontend UI framework, per
  `docs/02-technology-stack.md` §1.
- **Where it is used.** `frontend/main.jsx` line 1 (`import React from 'react'`,
  `React.StrictMode` line 6); `frontend/app.jsx` line 1; `frontend/src/pages/login.jsx`
  line 1 — `import React, { useState } from 'react'` — with hooks at lines 5–6:
  ```js
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  ```
  Also imported by `frontend/src/pages/landingpage.jsx` and `frontend/src/pages/register.jsx`.
- **Version.** `^18.2.0`, locked at **18.3.1**. Frontend, **runtime** (it is part of the
  shipped bundle).
- **What commonly goes wrong.** (a) `StrictMode` in React 18 development **mounts,
  unmounts and remounts** every component and double-invokes effects and reducers, to
  surface non-idempotent code. `frontend/main.jsx` line 6 enables it, so any future
  `useEffect` that fires a request will fire it twice in dev — this is intended behaviour,
  not a bug, and does not happen in production builds. (b) Stale closures in effects and
  callbacks. (c) Mutating state instead of replacing it.

---

### react-dom

- **What it is.** The **browser renderer** for React — the half that actually touches the
  DOM. It takes the element tree React computed and creates, updates and removes real DOM
  nodes, plus it owns the synthetic event system and the client/server hydration entry
  points.
- **`react-dom/client`** is the React 18 entry point exposing `createRoot`, which replaced
  React 17's `ReactDOM.render`. `createRoot` is what enables concurrent rendering
  (interruptible rendering, automatic batching, transitions).
- **Where it is used.** `frontend/main.jsx` — import line 2, then lines 5–9:
  ```js
  import ReactDOM from 'react-dom/client'
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode><App /></React.StrictMode>,
  )
  ```
  The `#root` element it mounts into is `frontend/index.html` line 9; the module itself is
  loaded by `<script type="module" src="/main.jsx">` on line 10.
- **Version.** `^18.2.0`, locked at **18.3.1**. Frontend, **runtime**.
- **Why `react` and `react-dom` must be version-matched.** They are two halves of one
  program. `react` holds the shared internal dispatcher — the mutable object that hooks
  read from during render — and `react-dom` reaches into it through
  `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED`. That interface is private and
  changes between versions with no compatibility guarantee. Mismatch them and you get the
  infamous *"Invalid hook call. Hooks can only be called inside of the body of a function
  component"* error, which is misleading — its most common real cause is either a version
  mismatch or **two copies of `react` in the tree**, not a misplaced hook.

  `react-dom` enforces the pairing via a peer dependency; the lockfile records the
  satisfied peer explicitly as `react-dom: 18.3.1(react@18.3.1)`. Practical rule: always
  bump both together, in the same commit.
- **What commonly goes wrong.** Two React copies (usually via a linked local package or a
  mis-hoisted install — pnpm's strict layout makes this *less* likely, and the `.pnpm`
  layout means a duplicate is visible on disk); importing from `react-dom` instead of
  `react-dom/client` and getting the React 17 deprecation warning.

---

### vite

- **What it is.** The frontend build tool and dev server. Two different engines under one
  CLI:
  - **Dev (`vite`)** — serves your source over native browser **ES modules**. It does
    *not* bundle. When the browser requests `/main.jsx`, Vite transforms that one file
    (JSX → JS) on the fly and returns it; the browser then requests its imports, and so on.
    Startup time is therefore roughly constant no matter how large the app gets, because
    nothing is built ahead of time. Third-party dependencies *are* pre-bundled once, with
    **esbuild** (written in Go, far faster than JS bundlers), because a package like React
    would otherwise cost hundreds of separate HTTP requests.
  - **Build (`vite build`)** — bundles for production with **Rollup**, giving tree-shaking,
    code splitting, asset hashing and minification. Rollup rather than esbuild here because
    production output quality (chunking, CSS handling, plugin ecosystem) matters more than
    build speed.

  That split — esbuild for speed where correctness is easy, Rollup for correctness where it
  is hard — is the whole design.
- **Where it is used.** `frontend/vite.config.js` (the entire file), and
  `frontend/package.json` scripts `dev` / `build` / `preview`. The dev server config, lines
  7–15, sets **port 3000** and proxies `/api` → `http://localhost:5000` with
  `changeOrigin: true`. `envDir: '../'` on line 5 points env loading at the repo root.
- **Version.** `^5.0.8`, locked at **5.4.21**. Frontend, **dev**. It pulls in
  `esbuild@0.21.5` transitively — the package the `allowBuilds` setting in
  [§1.5](#15-lifecycle-script-blocking-and-esbuild) exists for.
- **What commonly goes wrong.** (a) Environment variables: Vite exposes **only** vars
  prefixed `VITE_`, and via `import.meta.env`, not `process.env` — `process` does not exist
  in the browser. (b) The proxy only rewrites requests that go through the dev server; a
  hardcoded `http://localhost:5000` in frontend code bypasses it and lands you back in
  CORS. (c) `vite preview` serves the *built* output and is not a production server.
  (d) Vite 6 and 7 exist; `^5.0.8` deliberately stays on the 5.x line, and moving up is a
  deliberate migration — the specifics were **not verified** against this project.

---

### @vitejs/plugin-react

- **What it is.** The official React plugin for Vite. Two jobs:
  1. **JSX transform.** Compiles JSX to JavaScript using Babel with the automatic runtime,
     so `.jsx` files work and `import React` is not strictly required for JSX alone.
  2. **React Fast Refresh** — hot module replacement that *preserves component state*.
- **HMR and why state preservation matters.** Plain live-reload reloads the page: your app
  returns to its initial state, so every edit to a login form costs you re-typing the form.
  Fast Refresh instead swaps the changed module's component implementations in place and
  re-renders, keeping `useState` values intact. Editing the SVG illustration inside
  `frontend/src/pages/login.jsx` updates the browser without resetting the `isLogin` /
  `showPassword` state on lines 5–6.
- **Where it is used.** `frontend/vite.config.js` — import line 2, registered line 6:
  ```js
  import react from '@vitejs/plugin-react';
  export default defineConfig({ envDir: '../', plugins: [react()], … });
  ```
- **Version.** `^4.2.1`, locked at **4.7.0**, resolved against `vite@5.4.21` (the lockfile
  writes it `4.7.0(vite@5.4.21)` — Vite is a peer dependency). Frontend, **dev**.
- **What commonly goes wrong.** (a) Fast Refresh silently degrading to a full reload
  because a file exports something that is not a component — this is precisely what
  `eslint-plugin-react-refresh` is there to catch. (b) Anonymous default exports
  (`export default () => …`) and HOC-wrapped components can break refresh boundaries.
  (c) Confusing this plugin with `@vitejs/plugin-react-swc`, the SWC-based alternative —
  same purpose, different compiler; do not install both.

---

### @types/react

- **What it is.** TypeScript declaration files (`.d.ts`) for React, published by the
  community DefinitelyTyped project under the `@types/` scope. It contains no runtime code
  whatsoever — only type information describing React's API.
- **Where it is used.** *(No file imports it — types packages are picked up implicitly by
  the TypeScript compiler and by editor language servers.)*
- **Version.** `^18.2.43`, locked at **18.3.31**. Frontend, **dev**.
- **The honest situation in this repo — verified.** This project is **plain JavaScript
  today**:
  - every component file is `.jsx`, not `.tsx` (`frontend/main.jsx`, `frontend/app.jsx`,
    `frontend/src/pages/landingpage.jsx`, `login.jsx`, `register.jsx`);
  - there is **no `tsconfig.json` anywhere in the repository** (verified by a repo-wide
    search excluding `node_modules`);
  - `typescript` itself is **not a dependency** in any of the three `package.json` files.

  So nothing in this repo type-checks. What these packages *do* deliver today is **editor
  IntelliSense**: VS Code runs the TypeScript language service over JavaScript files too,
  and having `@types/react` on disk is what gives you autocomplete on `useState`, hover
  documentation on props, and red squiggles on obviously wrong React API usage — inside the
  editor only. Nothing in `pnpm build` or `pnpm lint` reads them.

  This is planned-ahead rather than a mistake: `docs/02-technology-stack.md` §1 and §2 name
  TypeScript for both frontend and backend — *"TypeScript should be preferred for both
  frontend and backend to reduce context switching and improve type safety."* The types are
  already installed for a migration that has not happened yet.

  To make them real you would need: `typescript` as a devDependency, a `tsconfig.json`, and
  files renamed `.jsx` → `.tsx` (plus updating the `lint` script's `--ext js,jsx`).

  **Update 2026-09-05 — all three of those landed.** `typescript@^5.9.2` is now a frontend
  devDependency, `tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` exist, the
  new pages are `.tsx`, and the `lint` script is now `--ext js,jsx,ts,tsx`. The `@types/*`
  packages are no longer decorative. `build` is `tsc -b && vite build` and there is a
  separate `typecheck` script. The **backend** was not ported and is still plain ESM
  JavaScript.
- **What commonly goes wrong.** (a) The `@types/react` **major must track the `react`
  major** — `@types/react@19` against `react@18` produces a storm of nonsense errors. Here
  both are 18.x. Correct. (b) Because types are a devDependency of one workspace, two
  packages in a monorepo can end up on different `@types/react` versions and produce "two
  different `JSX.Element` types are not assignable" errors — not an issue here, only
  `frontend` has React.

---

### @types/react-dom

- **What it is.** The same thing for `react-dom` — types for `createRoot`, `hydrateRoot`,
  `createPortal`, `flushSync`.
- **Version.** `^18.2.17`, locked at **18.3.7**. Frontend, **dev**. The lockfile records it
  as `18.3.7(@types/react@18.3.31)` — it has a peer dependency on `@types/react`, because
  its signatures reference `React.ReactNode` and friends.
- **Everything in the `@types/react` entry above applies identically**: no `tsconfig.json`,
  no `typescript`, `.jsx` not `.tsx`, so this is IntelliSense-only today.
- **What commonly goes wrong.** Version-skewing it against `@types/react` — the peer
  relationship in the lockfile is there precisely to stop that.

---

### eslint

- **What it is.** The JavaScript/JSX static analysis tool — it parses your source into an
  AST and runs configurable rules over it, reporting problems (unused variables, undefined
  identifiers, suspicious patterns) and, with `--fix`, repairing many of them.
- **Why this project has it.** Catch bugs before they run, and keep a consistent style
  across a codebase with more than one author.
- **Where it is used.** `frontend/package.json`:
  ```json
  "lint": "eslint . --ext js,jsx,ts,tsx --report-unused-disable-directives --max-warnings 0"
  ```
  - `.` — lint the whole `frontend` directory.
  - `--ext js,jsx,ts,tsx` — which extensions to pick up when linting a directory. `ts,tsx`
    were added on 2026-09-05 with the TypeScript port; before that it read `--ext js,jsx`.
  - `--report-unused-disable-directives` — flag `// eslint-disable-next-line` comments that
    no longer suppress anything, so stale suppressions get cleaned up.
  - `--max-warnings 0` — **exit non-zero on any warning**, not just errors. Warnings are
    errors in CI. Strict, and good.
- **Version.** `^8.55.0`, locked at **8.57.1**. Frontend, **dev**.
- **What commonly goes wrong.** The eslintrc/flat-config split (below) — most tutorials
  target one while you are using the other. Also: ESLint resolves plugins relative to the
  config file, and under pnpm's strict `node_modules` a plugin not declared in *that
  workspace's* `package.json` will not resolve — correct behaviour, but surprising.

---

### eslint-plugin-react

Rules for React itself — JSX and component correctness. Representative rules:
`react/jsx-key` (a missing `key` in a list is a real rendering bug),
`react/no-unescaped-entities`, `react/jsx-no-target-blank` (a `target="_blank"` without
`rel="noreferrer"` is a security issue), `react/prop-types`,
`react/no-direct-mutation-state`, and `react/jsx-uses-vars` — without which ESLint reports
every imported component as an unused variable.

Declared `^7.33.2`, locked **7.37.5**, resolved as `7.37.5(eslint@8.57.1)`. Frontend, **dev**.

**Commonly goes wrong:** forgetting `settings: { react: { version } }`, which makes the
plugin emit a warning on every single run.

---

### eslint-plugin-react-hooks

Maintained by the React team, and the highest-value plugin of the three. Two rules:

- **`rules-of-hooks`** — hooks may only be called at the top level of a function component
  or another hook: never inside a condition, loop, nested function or `try` block. This is
  not stylistic. React identifies hooks *by call order*, so a conditional hook shifts every
  subsequent hook's identity and produces state that belongs to the wrong variable. This
  rule is the only thing standing between you and that entire class of bug.
- **`exhaustive-deps`** — warns when a `useEffect` / `useMemo` / `useCallback` dependency
  array omits a value the callback reads. The omitted value gets captured in a **stale
  closure**: the effect keeps seeing the first render's value forever.

Declared `^4.6.0`, locked **4.6.2**, resolved as `4.6.2(eslint@8.57.1)`. Frontend, **dev**.

**Commonly goes wrong:** silencing `exhaustive-deps` with a disable comment instead of
fixing the dependency — which is exactly the bug the rule found.

---

### eslint-plugin-react-refresh

Essentially one rule, `react-refresh/only-export-components`: **a module that exports a
component should export only components.** Fast Refresh (see `@vitejs/plugin-react` above)
can only hot-swap a module in place if it can prove the module contains nothing but
components. Export a component *and* a constant or helper function from the same file and
the refresh boundary is invalidated — Vite falls back to a **full page reload**, silently.
You do not get an error; you just lose your state on every save and slowly conclude that
"HMR is flaky". This rule turns that silent degradation into a lint warning.

Declared `^0.4.5`, locked **0.4.26**, resolved as `0.4.26(eslint@8.57.1)`. Frontend, **dev**.

Remember from [§2](#2-semver-primer) that on a `0.x` package the caret pins the minor:
`^0.4.5` accepts 0.4.26 but would refuse 0.5.0.

---

### ESLint has no configuration file in this repository

**Verified.** A repo-wide search (excluding `node_modules` and `.git`) for `.eslintrc`,
`.eslintrc.js`, `.eslintrc.cjs`, `.eslintrc.json`, `.eslintrc.yml`, `eslint.config.js`,
`eslint.config.mjs` and `eslint.config.cjs` returns **nothing**. There is also no
`eslintConfig` key in any of the three `package.json` files.

Consequences, stated plainly:

- **`pnpm lint` will fail today.** ESLint 8 with no config file errors out with *"ESLint
  couldn't find a configuration file"* and a non-zero exit code. It is not that linting
  passes vacuously — the command does not run at all.
- All four ESLint packages are installed and none of them is doing anything.
- This is almost certainly an artefact of the Vite React template, which ships
  `.eslintrc.cjs` alongside these exact devDependencies; the config file did not make it
  into the repo.

**Suggested fix — shown only, not created.** Two options, because ESLint 8.57 sits on the
boundary between the two config systems.

*Option A — `.eslintrc.cjs`, matches the existing `lint` script exactly.* ESLint 8's
default config system is eslintrc, and the `--ext` flag in the current script only
exists in eslintrc mode. This is the lower-friction fix. The `.cjs` extension is required:
`frontend/package.json` sets `"type": "module"`, so a plain `.js` config using
`module.exports` would be parsed as ESM and throw.

```js
// frontend/.eslintrc.cjs
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.2' } },
  plugins: ['react-refresh'],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
  },
};
```

*Option B — flat config `eslint.config.js`.* This is the format ESLint is standardising on.
**Caveat:** in ESLint 8.x flat config is opt-in — you must set `ESLINT_USE_FLAT_CONFIG=true`,
or upgrade to ESLint 9 where it is the default — and flat config **removed `--ext`**, so
the `lint` script would have to drop that flag (file matching moves into the config's
`files` globs). *(That ESLint-8-requires-the-env-var detail comes from general knowledge of
ESLint's release history and is **not verified** against this repo.)*
`eslint-plugin-react-hooks@4.6.2` also predates first-class flat-config support, hence the
manual `plugins`/`rules` wiring below.

```js
// frontend/eslint.config.js
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: '18.2' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
];
```

Option B needs two more devDependencies that are **not currently installed**: `@eslint/js`
and `globals`.

There is also **no ESLint setup for the backend at all** — no config, and the ESLint
packages live only in `frontend/package.json`. `backend/package.json` has no `lint` script.

---

### nodemon vs concurrently — they are not the same tool

They are frequently confused because both are "dev scripts that keep things running".

| | `nodemon` | `concurrently` |
|---|---|---|
| Job | Watch the filesystem, **restart one process** on change | Run **several processes at once** in one terminal |
| Processes | One (yours, repeatedly) | N, in parallel, each long-lived |
| Trigger | A file changed | You ran the script |
| Output | Your process's output, plus restart notices | All processes' output, interleaved with per-command prefixes |
| Lives in | `backend/package.json` (dev) | root `package.json` (dev) |
| Invoked as | `nodemon src/server.js` | `concurrently "pnpm run dev:backend" "pnpm run dev:frontend"` |
| Would `pnpm dev` work without it? | Yes — you would just restart the API by hand after every edit | No — you would need two terminals |

They compose: `concurrently` starts `nodemon` (backend) and `vite` (frontend); nodemon then
restarts *its* child on every backend file change, while Vite hot-reloads the frontend, all
inside one terminal.

---

## 4. Dependency graph

Direct dependencies only. Locked versions from `pnpm-lock.yaml` in parentheses.

```
1on1  (repo root — workspace root, orchestration only)
│
│  package manager, pinned by devEngines and locked
│  └── pnpm ^11.5.2 ──> 11.13.0   (+ @pnpm/exe 11.13.0)
│
├── devDependencies
│   └── concurrently ^8.2.2 ──> 8.2.2
│
├── pnpm-workspace.yaml ──┬── packages: [ frontend, backend ]
│                         └── allowBuilds: { esbuild: true }
│
├──────────────────────────────────────────────────┐
▼                                                  ▼
backend/                                           frontend/
"1on1-backend"  (type: module)                     "1on1-frontend"  (private, type: module)
│                                                  │
├── dependencies      (ship to the server)         ├── dependencies   (ship in the browser bundle)
│   ├── express  ^4.18.2 ──> 4.22.2                │   ├── react     ^18.2.0 ──> 18.3.1
│   ├── cors     ^2.8.5  ──> 2.8.6                 │   └── react-dom ^18.2.0 ──> 18.3.1
│   └── dotenv   ^16.3.1 ──> 16.6.1                │              └──peer──> react@18.3.1
│                                                  │
└── devDependencies                                └── devDependencies   (build + lint only)
    └── nodemon  ^3.0.1  ──> 3.1.14                    ├── vite                        ^5.0.8   ──> 5.4.21
                                                       │     └─(transitive)─> esbuild 0.21.5
                                                       │            ^ the one allowBuilds entry
                                                       ├── @vitejs/plugin-react        ^4.2.1   ──> 4.7.0
                                                       │            └──peer──> vite@5.4.21
                                                       ├── @types/react                ^18.2.43 ──> 18.3.31
                                                       ├── @types/react-dom            ^18.2.17 ──> 18.3.7
                                                       │            └──peer──> @types/react@18.3.31
                                                       ├── eslint                      ^8.55.0  ──> 8.57.1
                                                       ├── eslint-plugin-react         ^7.33.2  ──> 7.37.5
                                                       ├── eslint-plugin-react-hooks   ^4.6.0   ──> 4.6.2
                                                       └── eslint-plugin-react-refresh ^0.4.5   ──> 0.4.26
                                                                    (all three ──peer──> eslint@8.57.1)
                                                       ⚠ no eslint config file exists — see above
```

Runtime wiring between the two halves, at development time:

```
  browser
     │  http://localhost:3000
     ▼
  vite dev server            (frontend/vite.config.js — port 3000)
     │  proxies  /api/*  ──> http://localhost:5000   (changeOrigin: true)
     ▼
  express                    (backend/src/server.js — process.env.PORT || 5000)
     └── GET /api/health  ──>  { status: 'ok', message: 'Server is running perfectly!' }

  both started together by:  pnpm dev  ──>  concurrently
```

---

## 5. Declared-but-not-yet-installed

`docs/02-technology-stack.md` describes the intended stack. Most of it does not exist in
any `package.json` yet. This table is the gap between plan and code, verified against all
three manifests.

| Technology | Planned role (source) | Package that would provide it | In a `package.json`? |
|---|---|---|---|
| **TypeScript** | §1, §2 — preferred for both frontend and backend | `typescript` (+ `tsconfig.json`, `@types/node`, `tsx` or `ts-node` for the backend) | **Frontend: yes, as of 2026-09-05** — `typescript@^5.9.2`, three `tsconfig*.json` files, `.tsx` pages. **Backend: no** — still plain ESM `.js`, no `typescript`, no `tsconfig.json`. |
| **AWS-hosted cloud database** | §1, §16 — primary database | *(managed AWS service, reached via a driver — service not yet chosen)* | **No** |
| **DB client / ODM-ORM** | §1, §16–§19 — schemas, indexes | *(depends on which AWS database service is chosen — see the TODO below)* | **No** |
| **Socket.IO** | §1, §8–§10 — messaging, presence, notifications, meeting collaboration, WebRTC signaling | `socket.io` (server), `socket.io-client` (browser) | **No** |
| **WebRTC** | §1, §11–§12 — audio, video, screen sharing | *(browser-native API — no npm package for peer-to-peer; a future SFU would add `mediasoup` / LiveKit / Janus)* | **N/A — native.** No SFU package installed |
| **Gemini API** | §1, §23–§28 — server-side AI service, agent tools, moderation, meeting notes | `@google/generative-ai` (or the newer `@google/genai`) | **No** |
| **anime.js** | §1 — frontend animation | `animejs` | **No** |
| **D3.js** | §1 — frontend data visualisation | `d3` (or scoped `d3-*` modules) | **No** |
| **Redis** | §1, §10, §30 — cache, Socket.IO adapter, presence, rate limiting, queues | `redis` or `ioredis`, plus `@socket.io/redis-adapter` | **No** |
| **JWT auth** | §3–§4 — access/refresh tokens, HTTP-only cookies | `jsonwebtoken`, `cookie-parser` | **No** |
| **bcrypt** | §5 — password hashing; store only the hash | `bcrypt` or `bcryptjs` | **No** |
| **BullMQ / background jobs** | §31 — reminders, AI processing, email, moderation queues | `bullmq` (requires Redis) | **No** |
| **RAG / vector search** | §29 — planned for later | *(undecided; a dedicated vector DB client, or vector search in the chosen AWS database)* | **No** |
| **Testing** | §35 — auth, JWT, state transitions, cancellation maths | *(no runner chosen; `vitest` or `node:test`)* | **No.** No `test` script in any `package.json` |
| **SHA-256 certificate hashing** | §32 — blockchain anchoring | *(Node built-in `node:crypto`)* | **N/A — built-in** |
| **MediaRecorder** (recording) | §15 — browser-side recording | *(browser-native API)* | **N/A — native** |
| **Docker** | §34 — **explicitly excluded** from the current plan | *(n/a)* | **No, intentionally** |
| **GCP hosting / Render** | §33 — deployment target; prototype on Render | *(platform, not a package)* | **N/A** |

> **TODO:** confirm the exact AWS database service (RDS / Aurora / DynamoDB /
> DocumentDB). Until that is decided the driver package for the database row
> above cannot be named, and the RAG row cannot be resolved either.

**Summary:** of the entire planned stack, only **React, Express and Node** — plus, since
2026-09-05, **TypeScript** and **react-router-dom** on the frontend — are actually
installed. Everything data-related, realtime, AI-related and auth-related is still
plan-only. That matches `docs/02-technology-stack.md` §37's own engineering rule — *"Do not
implement infrastructure before the product needs it"* — so it is a deliberate state, not
drift. The one genuine inconsistency worth flagging is **TypeScript**: the doc calls it
part of the current stack for both tiers (§1, §2), while the code is entirely plain
JavaScript.

---

## 6. Install / audit / update cheatsheet

All commands run from the **repository root** unless stated otherwise.

### The `--filter` flag

`--filter` selects which workspace package a command applies to, and it matches the
**`name` field in that package's `package.json`, not the directory name**:

| Directory | Package name (what `--filter` needs) |
|---|---|
| `backend/` | `1on1-backend` |
| `frontend/` | `1on1-frontend` |
| *(root)* | `1on1` — but use `-w` / `--workspace-root` instead |

So `pnpm --filter backend add x` **fails** ("No projects matched the filters"). It must be
`pnpm --filter 1on1-backend add x`. This is exactly what the root scripts do
(`package.json` lines 8–9).

### Installing

```bash
pnpm install                       # install EVERY workspace package, respecting the lockfile
pnpm install --frozen-lockfile     # CI: fail if package.json and pnpm-lock.yaml disagree
pnpm install --prod                # runtime dependencies only, skip devDependencies
pnpm --filter 1on1-backend install # resolve/link just one workspace
```

`pnpm install` at the root is the only install you normally need — it handles all three
packages in one pass and writes one lockfile.

### Adding dependencies

```bash
# a RUNTIME dependency to the backend only
pnpm --filter 1on1-backend add jsonwebtoken

# a DEV dependency to the frontend only  (-D)
pnpm --filter 1on1-frontend add -D vitest

# a RUNTIME dependency to the frontend
pnpm --filter 1on1-frontend add socket.io-client

# a DEV dependency at the workspace ROOT  (-w / --workspace-root)
pnpm add -Dw husky

# an exact version, no caret
pnpm --filter 1on1-backend add -E express@4.22.2
```

`-w` is required for root installs — without it pnpm refuses, on the assumption that
installing into the workspace root is usually a mistake.

You can also `cd backend && pnpm add jsonwebtoken`; pnpm infers the workspace from the
directory. `--filter` from the root is preferred because it is copy-pasteable and
scriptable.

### Removing

```bash
pnpm --filter 1on1-frontend remove eslint-plugin-react-refresh
pnpm remove -w concurrently
```

### Checking what is out of date

```bash
pnpm outdated                          # root package only
pnpm -r outdated                       # -r = recursive: EVERY workspace package
pnpm --filter 1on1-frontend outdated
```

`-r` is the one you want in a monorepo. Output columns are Current / Wanted (the highest
version the range allows) / Latest (the newest published). A gap between Current and Wanted
means `pnpm update` will move it; a gap between Wanted and Latest means a **major** bump
that needs a deliberate range change.

### Updating

```bash
pnpm -r update                     # newest version WITHIN each declared range
pnpm -r update --latest            # ignore ranges, jump to newest — REWRITES package.json, may break
pnpm --filter 1on1-frontend update vite
pnpm -r update --interactive       # -i : pick from a checklist
pnpm -r update --interactive --latest
```

Use `--interactive` for anything crossing a major boundary. Update `react` and `react-dom`
in the same command — see the `react-dom` entry above.

### Auditing

```bash
pnpm audit                     # report known CVEs across the whole graph
pnpm audit --prod              # runtime dependencies only — what actually ships
pnpm audit --audit-level high  # only high/critical; useful as a CI gate
pnpm audit --fix               # write `overrides` into package.json to force fixed versions
```

### Inspecting the tree

```bash
pnpm -r list --depth 0   # direct dependencies of every workspace package
pnpm why express         # who pulls express in, and via what path
pnpm licenses list       # licence report for the whole graph
```

`pnpm why` is the tool for "where on earth did this package come from".

### Running things

```bash
pnpm dev                                # root: concurrently starts BOTH apps
pnpm dev:backend                        # root script -> --filter 1on1-backend run dev
pnpm dev:frontend                       # root script -> --filter 1on1-frontend run dev
pnpm --filter 1on1-frontend run build   # production bundle via Rollup
pnpm --filter 1on1-frontend run lint    # fails today: no eslint config (see above)
pnpm --filter 1on1-backend run start    # plain node, no nodemon
pnpm -r run build                       # run `build` in every package that has one
```

### Housekeeping

```bash
pnpm store path      # where the global content-addressable store lives
pnpm store prune     # delete store entries no project references any more
pnpm approve-builds  # interactively allow a blocked postinstall script (§1.5)
```

---

## 7. Security notes

### 7.1 Dependabot

`.github/dependabot.yml` exists in this repository. Detailed coverage of GitHub's security
tooling belongs in the dedicated document for it; two things are worth recording here
because they are dependency facts.

**The file is still the unedited GitHub template**, and as committed it will not do
anything:

```yaml
version: 2
updates:
  - package-ecosystem: "" # See documentation for possible values
    directory: "/" # Location of package manifests
    schedule:
      interval: "daily"
```

`package-ecosystem` is an empty string. It must name a real ecosystem — for a pnpm project
that value is **`"npm"`** (Dependabot's npm ecosystem covers npm, Yarn and pnpm, and
understands `pnpm-lock.yaml`). And in a monorepo, `directory: "/"` alone only sees the root
manifest; the two workspace packages need their own entries (or a `directories:` list),
otherwise nothing in `backend/` or `frontend/` is ever monitored — which is where every
runtime dependency in this project lives.

`.github/workflows/codeql.yml` (CodeQL Advanced, on push/PR to `main` plus a weekly
schedule) is also present and analyses first-party code. It is complementary to Dependabot,
not a substitute — CodeQL looks at *your* code, Dependabot looks at your *dependencies*.

### 7.2 `pnpm audit`

`pnpm audit` sends the resolved dependency graph to the npm advisory database and reports
every package with a known published vulnerability, with severity, the affected range and
the fixed version.

Use it as a gate, not a ritual:

```bash
pnpm audit --prod --audit-level high
```

`--prod` matters. A `devDependency` vulnerability in a build tool is a genuinely different
risk from one in `express` — the first never reaches production and is only exploitable by
someone who already runs code on your build machine. Triage accordingly rather than chasing
a zero total.

When a fix is only available in a transitive package, `pnpm.overrides` in the root
`package.json` forces a specific version across the whole graph:

```json
"pnpm": {
  "overrides": {
    "some-vulnerable-transitive-package": ">=1.2.3"
  }
}
```

There are no overrides in this repo today.

### 7.3 The lockfile as a security control

`pnpm-lock.yaml` is not only a reproducibility tool; it is a security boundary.

- **Integrity hashes.** Every entry carries a `sha512-…` integrity value. If a registry
  tarball's bytes ever differ from what was locked — a republished version, a compromised
  mirror, a corrupted CDN — the install **fails** rather than silently accepting the new
  content.
- **No silent drift.** Without a lockfile, `^4.18.2` means the next `install` can quietly
  pull a version published five minutes ago by an attacker who compromised a maintainer
  account. With one, that version does not enter the project until someone deliberately
  runs an update — and when they do, **the change shows up as a lockfile diff in a pull
  request**: reviewable, blameable, revertable.
- **`--frozen-lockfile` in CI** (the default when CI is detected) makes the build fail if
  `package.json` and the lockfile disagree, so a dependency can never reach the running
  system without also being committed.
- **The `preinstall` guard** ([§1.4](#14-preinstall-pnpm-dlx-only-allow-pnpm--the-package-manager-lock))
  is part of this: `npm install` would resolve independently of `pnpm-lock.yaml`, bypassing
  every guarantee above. Blocking it keeps one lockfile authoritative.

### 7.4 Why lifecycle scripts are blocked

This restates [§1.5](#15-lifecycle-script-blocking-and-esbuild) as a security property,
because it is the most important one in this setup.

Installing a package is **not** a passive act. Any package in the graph — including one you
have never heard of, five levels deep — can declare a `postinstall` script that runs
arbitrary code with your user's privileges the moment `pnpm install` touches it. It runs
before your tests, before your code, before you have read a line of it. The historical
incidents (`event-stream`, `ua-parser-js`, `node-ipc`, the recurring typosquat waves) all
share this shape: the payload executed at *install* time.

pnpm v10+ therefore blocks lifecycle scripts by default and requires an explicit,
per-package allow-list. This repository allows exactly **one** package, `esbuild`, for a
legitimate and verifiable reason: esbuild ships a Go binary and its install script places
the correct native binary for the host platform. Every other package in the graph —
including anything a future `pnpm add` drags in — is inert at install time until someone
consciously adds it to the list.

The practical rule when pnpm warns that a build was skipped: **do not reflexively approve
it.** Ask why that package needs to execute code at install time. Native modules (`bcrypt`,
`sharp`, `better-sqlite3`) and binary-distributing tools (esbuild, Playwright) have a real
answer. A logging library or a date utility does not, and a request from one is a red flag.

### 7.5 Current gaps worth noting

Grounded, verified observations rather than recommendations dressed up as findings:

| Gap | Evidence |
|---|---|
| `.github/dependabot.yml` has an empty `package-ecosystem` and covers only `/` | the file itself |
| No `.env.example` committed, though `.env` is gitignored and required by `backend/src/server.js:10` | `.gitignore`, repo listing |
| `app.use(cors())` allows all origins, and is incompatible with the cookie-based refresh tokens planned in `docs/02-technology-stack.md` §3 | `backend/src/server.js:14` |
| No lint gate is actually enforceable — `pnpm lint` cannot run without an ESLint config | ESLint section above |
| No test runner and no `test` script in any of the three packages, though `docs/02-technology-stack.md` §35 specifies a testing strategy | all three `package.json` files |
| Nothing is installed in this checkout — no `node_modules` at root or in either workspace | directory listing |

---

## Appendix — every file this document is based on

| File | Used for |
|---|---|
| `package.json` | root scripts, `devEngines`, `concurrently`, `preinstall`, `type` |
| `backend/package.json` | `1on1-backend` name, scripts, express/cors/dotenv/nodemon |
| `frontend/package.json` | `1on1-frontend` name, scripts, React/Vite/ESLint deps |
| `pnpm-workspace.yaml` | workspace members, `allowBuilds` |
| `.npmrc` | `only-built-dependencies` |
| `pnpm-lock.yaml` | every resolved version, peer resolutions, `packageManagerDependencies` |
| `backend/src/server.js` | express/cors/dotenv usage and line numbers, ESM `__dirname` |
| `frontend/vite.config.js` | Vite config, plugin registration, `/api` proxy, `envDir` |
| `frontend/main.jsx`, `frontend/app.jsx`, `frontend/src/pages/login.jsx` | React / react-dom / hooks usage and line numbers |
| `frontend/index.html` | `#root` mount point, module script tag |
| `.gitignore` | `node_modules`, `.env` |
| `.github/dependabot.yml`, `.github/workflows/codeql.yml` | security tooling section |
| `docs/02-technology-stack.md` | the planned-stack gap table in §5 |
