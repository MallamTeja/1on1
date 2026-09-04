# 02 — Root Configuration

Reference for every configuration file that lives at the repository root of `1on1`.

The root of this repo is not an application. It is a **workspace root**: a thin coordination layer whose only jobs are (a) declaring where the real packages live, (b) pinning the package manager, and (c) providing scripts that start both real packages at once. Everything in this document serves one of those three jobs.

Files covered:

| File | Size | Tracked in git |
| --- | --- | --- |
| `package.json` | — | yes |
| `pnpm-workspace.yaml` | — | yes |
| `.npmrc` | 37 bytes | yes |
| `.gitignore` | 18 bytes | yes |
| `README.md` | 5 bytes | yes |
| `pnpm-lock.yaml` | — | yes |
| `.env` | — | **no — does not exist** (see §5) |

---

## 1. Root `package.json`, field by field

```json
{
  "name": "1on1",
  "version": "1.0.0",
  "description": "its a fullstack application named 1on1 which developing by Teja Mallam",
  "main": "index.js",
  "scripts": {
    "preinstall": "pnpm dlx only-allow pnpm",
    "dev:backend": "pnpm --filter 1on1-backend run dev",
    "dev:frontend": "pnpm --filter 1on1-frontend run dev",
    "dev": "concurrently \"pnpm run dev:backend\" \"pnpm run dev:frontend\""
  },
  "keywords": ["1on1","Teja Mallam"],
  "author": "Teja Mallam",
  "license": "ISC",
  "devEngines": {
    "packageManager": {
      "name": "pnpm",
      "version": "^11.5.2",
      "onFail": "download"
    }
  },
  "type": "module",
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
```

### `name: "1on1"`

The package identifier. It is **not** the same thing as a workspace filter target — the two workspace packages are named `1on1-backend` and `1on1-frontend` in their own `package.json` files, and those are the names `--filter` matches (see §2). The root name is essentially cosmetic here: nothing installs or imports the root package.

### `version: "1.0.0"`

Required by the `package.json` schema. Since this package is never published to a registry, the number carries no meaning and nothing reads it. It has not moved since the repo was created.

### `description`

Free text. Surfaces on a registry page and in `pnpm list` output. Never published, so effectively a comment.

### `main: "index.js"` — vestigial

**There is no `index.js` at the repository root.** The root contains `backend/`, `frontend/`, `docs/`, `.github/`, and the config files in this document — no `index.js`.

`main` declares the entry point returned when something does `import '1on1'` or `require('1on1')`. This value is boilerplate that `npm init` writes by default, and nobody deleted it.

It is **harmless here** for one specific reason: the root package is never imported. It is only ever used as a *script runner* (`pnpm run dev`) and as the *workspace root*. `main` is consulted only during module resolution, which never happens for this package. It would start mattering the moment someone published this package or added it as a dependency of another package — at which point it would point at a file that does not exist.

### `keywords: ["1on1","Teja Mallam"]`

Registry search metadata. Unused for an unpublished package.

### `author: "Teja Mallam"`

Metadata only. Matches the git commit author on every commit in the history.

### `license: "ISC"`

ISC is a permissive open-source license from the Internet Systems Consortium. It is **functionally equivalent to MIT** (and to BSD-2-Clause): do what you like with the code, keep the copyright notice, no warranty. The difference is purely editorial — ISC removed two clauses that the Berne Convention made redundant, so it is a shorter MIT with the same effect. It is npm's historical default, which is why it appears here without a deliberate choice having been made.

> **Gap:** there is no `LICENSE` file at the repo root. The `license` field asserts a license whose text the repository does not ship. If this repo ever goes public, add a `LICENSE` file containing the ISC text — or change the field to `"UNLICENSED"` with `"private": true` if it is meant to stay proprietary.

> **Gap:** the root `package.json` does not set `"private": true`. `frontend/package.json` does. Marking a workspace root private is the standard guard against an accidental publish of the whole repo.

### `type: "module"`

Switches every `.js` file in this package's scope to **ES modules**: `import`/`export` work, `require()` does not, and the CommonJS globals `__dirname`, `__filename`, and `module.exports` are not defined.

Both workspace packages set `"type": "module"` too. The consequence is visible in `backend/src/server.js`, which has to rebuild `__dirname` by hand because ESM does not provide it:

```js
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

That reconstructed `__dirname` is what the `.env` path in §5 is resolved against.

### `devEngines.packageManager`

```json
"devEngines": {
  "packageManager": { "name": "pnpm", "version": "^11.5.2", "onFail": "download" }
}
```

`devEngines` is the newer, development-time counterpart to the classic `engines` field. `engines` constrains *consumers* who install your package; `devEngines` constrains *contributors* who work on it — which is what matters for a repo that is never published.

- `name: "pnpm"` — the required package manager.
- `version: "^11.5.2"` — any pnpm 11.x at or above 11.5.2. `pnpm-lock.yaml` shows this resolving to **11.13.0** in the root importer's `packageManagerDependencies`.
- `onFail: "download"` — when the running package manager does not satisfy the range, fetch a matching one instead of erroring out. The alternatives are `warn` and `error`.

This is the *soft* half of the package-manager lock-in. The *hard* half is the `preinstall` script in §2.

### `devDependencies`

```json
"devDependencies": { "concurrently": "^8.2.2" }
```

One dependency, used by exactly one script (`dev`). The root package has no runtime dependencies at all — correct for a coordination-only root. All real dependencies (`express`, `cors`, `dotenv`, `react`, `vite`, `eslint`, `nodemon`) live in `backend/package.json` and `frontend/package.json`.

### Scripts that are *not* here

There is no `start`, `build`, `test`, or `lint` script at the root. `pnpm build` or `pnpm lint` from the repo root fails with *"Missing script"*. This matters for CI — see [`07-ci-and-security.md`](./07-ci-and-security.md).

---

## 2. The scripts, explained as a runnable chain

### `preinstall`

```json
"preinstall": "pnpm dlx only-allow pnpm"
```

**What it does.** `preinstall` is an npm lifecycle hook: it runs automatically *before* dependencies are installed, whenever anyone runs an install command in this package. It fires before the dependency tree is touched, so it can abort an install that should not happen.

**The call chain:**

```
pnpm install                (or npm install / yarn — that is the point)
  └─ preinstall hook fires
       └─ pnpm dlx only-allow pnpm
            ├─ pnpm dlx: fetch the `only-allow` package into a temp store and run
            │            its binary without adding it to any package.json
            └─ only-allow: read the npm_config_user_agent env var that every
                           package manager sets, compare it to "pnpm"
                 ├─ match     → exit 0, install proceeds
                 └─ no match  → print an error, exit non-zero, install aborts
```

**Why.** Mixing package managers in one repo produces competing lockfiles and divergent dependency trees. This repo has already been through that: commit `a6c21fa` added `backend/package-lock.json` and `frontend/package-lock.json` alongside `pnpm-lock.yaml`. Today `git ls-files` shows only `pnpm-lock.yaml` — the npm lockfiles are gone. The `preinstall` guard is what stops them coming back.

**Caveats.** `pnpm dlx` needs network access on a cold store, so the guard adds a small cost to a clean install; and it only fires for install commands run *in this package*, not for someone running `npm install` inside `frontend/` directly.

### `dev:backend`

```json
"dev:backend": "pnpm --filter 1on1-backend run dev"
```

**Full call chain:**

```
pnpm run dev:backend
  └─ pnpm --filter 1on1-backend run dev
       └─ (pnpm resolves the filter → the backend/ workspace package)
            └─ backend/package.json  "dev": "nodemon src/server.js"
                 └─ nodemon                       (watches backend/src for changes)
                      └─ node src/server.js       (respawned on every save)
                           ├─ dotenv.config({ path: <repo root>/.env })
                           ├─ app.use(cors()); app.use(express.json())
                           ├─ GET /api/health → { status: 'ok', ... }
                           └─ app.listen(process.env.PORT || 5000)
```

**`--filter` matches the package `name`, not the folder.** This is the single most common confusion in a pnpm workspace. The filter string `1on1-backend` is matched against the `"name"` field inside `backend/package.json`:

```json
{ "name": "1on1-backend", ... }
```

The directory is called `backend`, but `pnpm --filter backend run dev` would **not** find it by name. To filter by location instead, pnpm requires an explicit path form: `pnpm --filter ./backend run dev`. Rename the `name` field in `backend/package.json` and the root `dev:backend` script breaks — the directory name is irrelevant to it.

The explicit `run` before `dev` is worth keeping: `pnpm --filter X <word>` would try pnpm's own subcommands first if `<word>` collided with one (`add`, `install`, `test`, `publish`…). `run` removes the ambiguity.

### `dev:frontend`

```json
"dev:frontend": "pnpm --filter 1on1-frontend run dev"
```

**Full call chain:**

```
pnpm run dev:frontend
  └─ pnpm --filter 1on1-frontend run dev     (matches "name" in frontend/package.json)
       └─ frontend/package.json  "dev": "vite"
            └─ vite dev server, configured by frontend/vite.config.js:
                 ├─ envDir: '../'            → loads .env from the REPO ROOT
                 ├─ plugins: [react()]       → JSX + React Fast Refresh
                 ├─ server.port: 3000
                 └─ server.proxy '/api' → http://localhost:5000 (changeOrigin)
```

The `/api` proxy is why the two halves work together with no CORS configuration or absolute URL in the frontend code: the browser only ever talks to `localhost:3000`, and Vite forwards `/api/*` to the Express server on `5000`.

### `dev`

```json
"dev": "concurrently \"pnpm run dev:backend\" \"pnpm run dev:frontend\""
```

**The escaped quotes.** `package.json` is JSON, and the script value is a JSON string delimited by `"`. To put a literal double-quote *inside* that string it must be escaped as `\"`. After JSON parsing, the shell actually receives:

```sh
concurrently "pnpm run dev:backend" "pnpm run dev:frontend"
```

The quotes are load-bearing, not decoration. `concurrently` treats **each argument as one complete command**. With the quotes it receives two arguments — two commands. Without them the shell would word-split into six arguments (`pnpm`, `run`, `dev:backend`, `pnpm`, `run`, `dev:frontend`) and `concurrently` would try to run six separate programs, five of which do not exist.

**Full call chain:**

```
pnpm dev
  └─ node_modules/.bin/concurrently          (root devDependency, ^8.2.2)
       ├─ child process 1 ──► pnpm run dev:backend
       │                        └─ pnpm --filter 1on1-backend run dev
       │                             └─ nodemon src/server.js
       │                                  └─ node  → Express on :5000
       └─ child process 2 ──► pnpm run dev:frontend
                                └─ pnpm --filter 1on1-frontend run dev
                                     └─ vite  → dev server on :3000 → proxies /api → :5000
```

`concurrently` spawns both children, interleaves their stdout/stderr with a per-process prefix, and forwards `Ctrl+C` to both.

**Behaviour worth knowing:** concurrently v8 does **not** kill sibling processes when one exits, unless told to. As written, if the backend crashes on startup the Vite server keeps running and the frontend silently fails on every `/api` call. A more forgiving version of the same script:

```json
"dev": "concurrently -k -n backend,frontend -c blue,green \"pnpm run dev:backend\" \"pnpm run dev:frontend\""
```

`-k` kills the survivor when either dies; `-n` labels the output streams; `-c` colours them. (Suggestion only — not applied.)

---

## 3. `pnpm-workspace.yaml`, line by line

```yaml
packages:
  - 'frontend'
  - 'backend'
allowBuilds:
  esbuild: true
```

**What a workspace is.** A workspace is several packages, each with its own `package.json`, managed as one unit from a single root. In exchange you get: one lockfile for the whole repo, one shared content-addressable store instead of duplicated `node_modules` trees, automatic symlinking between packages that depend on each other, and the `--filter` targeting used by every script in §2. **The existence of this file is what makes pnpm treat this directory as a workspace root** — remove it and `pnpm --filter 1on1-backend …` stops resolving.

### `packages:`

```yaml
packages:
  - 'frontend'
  - 'backend'
```

The glob list of directories that contain workspace packages. Globs are supported (`'packages/*'`, `'apps/**'` are the common idioms) but this file uses two literal directory names. Consequences:

- Only `frontend/` and `backend/` are workspace members. The root package itself is always a member implicitly.
- Adding a third package (say `shared/`) requires editing this list — it will not be picked up automatically.
- `docs/` is deliberately not a package and is invisible to pnpm.

### `allowBuilds:`

```yaml
allowBuilds:
  esbuild: true
```

`allowBuilds` is pnpm 11's build-script approval list: a map of package matcher → boolean, controlling which dependencies are permitted to execute their `preinstall` / `install` / `postinstall` lifecycle scripts during `pnpm install`.

- `esbuild: true` — esbuild may run its install script. It needs to: esbuild ships a platform-specific native binary that its install step selects and links. esbuild reaches this repo as a transitive dependency of `vite` (`frontend/package.json`, `vite: ^5.0.8`).
- **Anything not listed is unapproved.** With pnpm's `strictDepBuilds` (default `true` in v11), an unapproved package with a build script makes the install *fail* with an error rather than silently skipping. That is the point: you are forced to review each new package that wants to run code at install time.
- The escape hatches are `dangerouslyAllowAllBuilds: true` (approve everything — do not) and `ignoreScripts: true` (run nothing, which would break esbuild here).

**History.** Commit `87a85c9` ("vulnerals solved", 2026-07-31) is the commit that made this line real — it changed the value from the placeholder string `set this to true or false` to `true`. Before that commit the key was present but meaningless.

**Version note.** `allowBuilds` is the pnpm **11** setting. It replaced pnpm 10's `onlyBuiltDependencies` / `neverBuiltDependencies`. This repo pins pnpm `^11.5.2` (resolved 11.13.0), so `allowBuilds` is the setting actually in force — which makes the `.npmrc` line in §4 a duplicate of it. See [pnpm build settings](https://pnpm.io/settings/build).

---

## 4. `.npmrc`

```ini
only-built-dependencies=["esbuild"]
```

**What an `.npmrc` is.** An ini-style configuration file read by npm and pnpm. It can exist at several levels, consulted nearest-first:

| Level | Path | Typical contents |
| --- | --- | --- |
| Project | `./.npmrc` (this file) | client behaviour, registry for this repo |
| User | `~/.npmrc` | auth tokens, personal defaults |
| Global | prefix-relative `etc/npmrc` | machine-wide policy |
| Built-in | shipped with the client | fallback defaults |

This project-level file is committed to git (`git ls-files` lists `.npmrc`), which is fine because it contains no credentials. **Never** put an `_authToken` line in a committed `.npmrc` — that is the classic accidental-secret leak in Node repos.

**The line, as a supply-chain control.** `only-built-dependencies` is a default-deny allowlist for install-time lifecycle scripts — the `.npmrc` (kebab-case) form of pnpm 10's `onlyBuiltDependencies`.

The threat it addresses is the most exploited npm attack path: an install script runs **arbitrary code with your user's privileges** the moment a dependency lands on disk — before you have imported it, run it, or read a line of it. A compromised transitive dependency five levels down is enough. Default-deny means such a package can still be *downloaded*, but it cannot *execute*. Only `esbuild` is trusted to run code here.

**Honest caveat — this line is probably inert today.** pnpm 11 reads only **auth and registry** settings from `.npmrc`; every other setting must live in `pnpm-workspace.yaml` or the global `config.yaml`. Since this repo pins pnpm 11, the file's one line is very likely ignored, and the control that actually applies is `allowBuilds` in `pnpm-workspace.yaml` (§3). The two say the same thing, so nothing is broken — but if you delete one, delete this one, and know that the `pnpm-workspace.yaml` entry is the one doing the work. Keeping it costs nothing and preserves the intent if the toolchain is ever pinned back to pnpm 10.

---

## 5. `.gitignore`

The whole file — 18 bytes, CRLF line endings, no trailing newline:

```gitignore
node_modules
.env
```

### Pattern semantics

Neither pattern contains a slash, so **both match at any depth**, not just at the root. Verified with `git check-ignore -v`:

```
.gitignore:1:node_modules    node_modules
.gitignore:2:.env            .env
.gitignore:2:.env            backend/.env
.gitignore:2:.env            frontend/.env
```

So `frontend/node_modules` and `backend/.env` are covered by these two lines without needing their own entries.

### Why `node_modules` is ignored

- **It is regenerable.** `pnpm-lock.yaml` is committed and records the exact resolved version and integrity hash of every package in the tree. `pnpm install --frozen-lockfile` rebuilds an identical `node_modules` from it. Committing the output of a reproducible process is redundant.
- **It is enormous.** Tens of thousands of files for a React + Vite + Express project.
- **It is machine-specific.** esbuild ships a per-platform native binary; a `node_modules` built on Windows is wrong on Linux CI.
- **pnpm's `node_modules` is mostly symlinks** into the global content-addressable store. Committing symlinks that point outside the repo produces a tree that is broken everywhere except the machine that created it.

### Why `.env` is ignored

`.env` holds secrets — database URLs, API keys, session signing keys. Two hard properties make this non-negotiable:

1. **Git history is permanent.** A secret committed once and deleted in the next commit is still in the history, still in every clone, and still in every fork. Removing it means rewriting history and rotating the secret anyway.
2. **Public repos are scraped continuously.** Credentials pushed to a public repository are typically found and used within minutes.

### The consequence: a fresh clone has no `.env`

There is **no `.env` at the repository root right now** — it is ignored, so it was never committed, so `git clone` does not produce one. Both applications expect one *at the repo root*:

| Consumer | Mechanism | Resolves to |
| --- | --- | --- |
| `backend/src/server.js` | `dotenv.config({ path: path.join(__dirname, '../../.env') })` | `__dirname` is `backend/src`, so `../../` → **repo root** |
| `frontend/vite.config.js` | `envDir: '../'` | relative to the `frontend/` package dir → **repo root** |

One `.env` at the root, shared by both. Note the asymmetry in how it is consumed: `dotenv` gives the backend *every* variable in the file, whereas Vite only exposes variables prefixed **`VITE_`** to browser code — a deliberate guard so a server secret sitting in the same file cannot leak into the client bundle.

Today a fresh clone still *runs*, by luck: `PORT` is undefined, `process.env.PORT || 5000` falls back to `5000`, and `5000` happens to be exactly what the Vite proxy targets. Add any variable the code actually depends on and the missing file becomes a hard failure.

### Suggested `.env.example`

Commit this as `.env.example` at the repo root. It is **not** ignored by the current `.gitignore` — verified with `git check-ignore`, which matches nothing for `.env.example`, because the pattern is the literal name `.env`, not `.env*`.

```dotenv
# .env.example — copy to `.env` at the REPO ROOT (next to package.json), then fill in.
#   cp .env.example .env
#
# Read by:
#   backend/src/server.js    dotenv.config({ path: '<repo root>/.env' })
#   frontend/vite.config.js  envDir: '../'
#
# `.env` is gitignored. This file is committed. Never put real values here.

# ---- Backend -------------------------------------------------------------
# Port the Express server listens on (backend/src/server.js falls back to 5000).
# Must match the proxy target in frontend/vite.config.js (http://localhost:5000).
PORT=5000

# ---- Frontend ------------------------------------------------------------
# Vite exposes ONLY variables prefixed with VITE_ to browser code.
# Never prefix a secret with VITE_ — it ends up in the shipped bundle.
#
# Commented out on purpose: in development the frontend reaches the API through
# Vite's /api proxy, so no absolute URL is needed. Set this for a deployed build.
# VITE_API_URL=http://localhost:5000
```

**The convention:** commit `.env.example` (the *shape* — every key the app reads, with comments and safe defaults), ignore `.env` (the *values*). The example file is the only machine-readable record of what configuration the app needs; without it, a new contributor has to grep the source for `process.env.` and `import.meta.env.` to find out.

### Gaps in the current `.gitignore`

Verified with `git check-ignore`: **`frontend/dist` is not ignored.** `frontend/package.json` defines `"build": "vite build"`, whose default output directory is `dist/`. The first person to run a build will see the entire compiled bundle show up as untracked files. Also missing: log files, OS junk (`.DS_Store`, `Thumbs.db`), editor directories, and coverage output. A fuller version:

```gitignore
node_modules
.env
.env.local
.env.*.local

# build output
dist
build
frontend/dist

# logs
*.log
npm-debug.log*
pnpm-debug.log*

# editors / OS
.vscode
.idea
.DS_Store
Thumbs.db

# test output
coverage
```

(Suggestion only — not applied.)

---

## 6. `README.md`

The entire file is **5 bytes**, with no trailing newline:

```
#1on1
```

### It does not render as a heading

In GitHub-flavored Markdown (and CommonMark generally), an ATX heading requires the `#` run to be followed by **a space, a tab, or the end of the line**. `#1on1` has `1` immediately after the `#`, so the sequence is not a heading marker at all — GitHub renders the line as an ordinary paragraph containing the literal text `#1on1`, at body size and body weight.

The fix is one character:

```markdown
# 1on1
```

### Suggested README skeleton

A suggestion only — **`README.md` is not modified by this document.** Everything below is drawn from files in this repo (`package.json`, `backend/src/server.js`, `frontend/vite.config.js`, `frontend/package.json`, `docs/`).

````markdown
# 1on1

A fullstack application built with React and Express, managed as a pnpm workspace.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Vite 5, ESLint 8 |
| Backend | Node.js (ESM), Express 4, CORS, dotenv |
| Tooling | pnpm 11 workspace, nodemon, concurrently |
| CI | GitHub Actions — CodeQL static analysis |

See [`docs/02-technology-stack.md`](docs/02-technology-stack.md) for the full plan.

## Prerequisites

- Node.js 18 or newer
- pnpm 11 (`corepack enable` will provide it; the root `preinstall` hook
  rejects `npm install` and `yarn`)

## Setup

```bash
git clone <repo-url>
cd 1on1
cp .env.example .env      # then fill in values
pnpm install
pnpm dev
```

`pnpm dev` starts both servers:

- Frontend — http://localhost:3000
- Backend  — http://localhost:5000 (health check: `/api/health`)

Vite proxies `/api/*` from :3000 to :5000, so no CORS setup is needed in dev.

## Environment

A single `.env` lives at the **repository root** and is read by both apps —
the backend via `dotenv`, the frontend via Vite's `envDir: '../'`.
Only variables prefixed `VITE_` are exposed to browser code.

| Variable | Used by | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | backend | `5000` | Express listen port |
| `VITE_API_URL` | frontend | — | Absolute API URL (optional in dev) |

## Scripts

Run from the repository root:

| Script | Command | What it does |
| --- | --- | --- |
| `pnpm dev` | `concurrently …` | Runs backend and frontend together |
| `pnpm dev:backend` | `pnpm --filter 1on1-backend run dev` | nodemon on `backend/src/server.js` |
| `pnpm dev:frontend` | `pnpm --filter 1on1-frontend run dev` | Vite dev server |

Per package:

| Script | Package | What it does |
| --- | --- | --- |
| `pnpm --filter 1on1-backend start` | backend | `node src/server.js` (no watch) |
| `pnpm --filter 1on1-frontend build` | frontend | Production build to `frontend/dist` |
| `pnpm --filter 1on1-frontend preview` | frontend | Serves the built bundle |
| `pnpm --filter 1on1-frontend lint` | frontend | ESLint (needs a config — none yet) |

`--filter` matches the `name` field in each `package.json`, not the folder name.

## Project structure

```
1on1/
├── backend/
│   ├── package.json          # name: 1on1-backend
│   └── src/server.js         # Express app, GET /api/health
├── frontend/
│   ├── package.json          # name: 1on1-frontend
│   ├── vite.config.js        # port 3000, /api proxy, envDir '../'
│   ├── index.html
│   ├── app.jsx  main.jsx
│   └── src/pages/            # landingpage, login, register
├── docs/                     # product, stack, design, and code docs
├── .github/
│   ├── workflows/codeql.yml  # static analysis
│   └── dependabot.yml        # dependency updates
├── package.json              # workspace root: scripts only
├── pnpm-workspace.yaml       # workspace members + build approvals
├── pnpm-lock.yaml            # the single lockfile for all packages
└── .npmrc  .gitignore
```

## Documentation

| Doc | Contents |
| --- | --- |
| [`docs/01-product-requirements.md`](docs/01-product-requirements.md) | What the product is and does |
| [`docs/02-technology-stack.md`](docs/02-technology-stack.md) | Stack choices and engineering plan |
| [`docs/03-system-design.md`](docs/03-system-design.md) | System architecture |
| [`docs/code/02-root-config.md`](docs/code/02-root-config.md) | Every root config file, explained |
| [`docs/code/07-ci-and-security.md`](docs/code/07-ci-and-security.md) | CI workflows and security posture |

## License

ISC
````

---

## 7. Config file map

| File | What reads it | When it is read | What breaks if it is wrong |
| --- | --- | --- | --- |
| `package.json` (root) | pnpm | On every `pnpm run …` and `pnpm install` | Broken JSON → every pnpm command fails. Wrong `--filter` name in a script → *"No projects matched the filters"*. Missing script → *"Missing script"*. |
| `package.json` → `preinstall` | pnpm / npm / yarn | Before dependency installation | Removing it lets `npm install` create a competing `package-lock.json` and a divergent tree. |
| `package.json` → `devEngines` | pnpm | At command startup | Wrong range → pnpm downloads an unintended version (`onFail: download`), or refuses to run if switched to `error`. |
| `package.json` → `type: module` | Node.js | At module load, per file | Removing it makes every `import` statement in root-scope `.js` a syntax error. |
| `pnpm-workspace.yaml` → `packages` | pnpm | At workspace resolution — before install and before any `--filter` | A directory omitted here is not a workspace member: `--filter` misses it, its deps are not installed, `pnpm dev` fails. |
| `pnpm-workspace.yaml` → `allowBuilds` | pnpm | During `pnpm install`, per dependency with a lifecycle script | Removing `esbuild: true` → install fails on the unapproved build (strict mode), or esbuild's native binary is never linked and `vite` cannot start. |
| `.npmrc` | pnpm / npm | At client startup, merged project → user → global | Likely inert under pnpm 11 (auth/registry settings only). A stray `_authToken` here would be a committed credential. |
| `.gitignore` | git | On `git status`, `git add`, `git commit` | Dropping `.env` → secrets committed to permanent history. Dropping `node_modules` → tens of thousands of machine-specific files staged. |
| `pnpm-lock.yaml` | pnpm | During `pnpm install` | Deleted → versions re-resolve and drift. Out of sync with a `package.json` → `--frozen-lockfile` (CI default) fails the install. |
| `.env` (untracked, **absent**) | `dotenv` in `backend/src/server.js`; Vite via `envDir` in `frontend/vite.config.js` | Backend: at process start. Frontend: at Vite dev-server start and at build | Missing → `PORT` undefined (falls back to 5000) and no `VITE_*` variables. Wrong location → silently ignored; `dotenv` does not error on a missing file. |
| `backend/package.json` → `name` | pnpm `--filter` | Every `pnpm dev` / `pnpm dev:backend` | Renaming it breaks the root `dev:backend` and `dev` scripts, which hard-code `1on1-backend`. |
| `frontend/package.json` → `name` | pnpm `--filter` | Every `pnpm dev` / `pnpm dev:frontend` | Same, for `1on1-frontend`. |
| `frontend/vite.config.js` | Vite | At dev-server start and at build | Wrong `envDir` → root `.env` not loaded. Wrong proxy target → every `/api` call fails in development. |
| `.github/workflows/codeql.yml` | GitHub Actions | On push/PR to `main`, and weekly on the cron | Invalid YAML → workflow never runs and results stop reaching the Security tab. |
| `.github/dependabot.yml` | Dependabot | When the file changes, and on the configured schedule | **Currently invalid** — empty `package-ecosystem`. See [`07-ci-and-security.md`](./07-ci-and-security.md). |

---

## Related documents

- [`07-ci-and-security.md`](./07-ci-and-security.md) — GitHub Actions, CodeQL, Dependabot, security posture
- [`../02-technology-stack.md`](../02-technology-stack.md) — stack choices and engineering plan
- [`../03-system-design.md`](../03-system-design.md) — system architecture
