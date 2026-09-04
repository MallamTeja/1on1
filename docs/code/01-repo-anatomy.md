# 01 — Repo Anatomy: every file, what it is, why it exists

> This is the map. Read this first, then jump into the per-area docs.
> Every path below is real and was verified against the working tree.

---

## 1. The one-paragraph truth about this repo

`1on1` is a **pnpm monorepo** containing two workspace packages — a React frontend
and an Express backend — plus a `docs/` folder describing a product far larger than
the code that exists today.

The code is a **scaffold**: it proves the wiring works (frontend boots, backend
boots, they can talk through a dev proxy) and renders exactly one screen. The docs
describe a full professional-networking platform with sessions, WebRTC, AI and
payments. **Nothing in `docs/01`–`docs/03` is implemented yet.** That is not a
criticism — it is the correct state for a project this early. But you should know
which is which, so [`08-gaps-and-findings.md`](08-gaps-and-findings.md) writes the
gap down explicitly.

---

## 2. Full file tree

```text
1on1/
├── .github/
│   ├── dependabot.yml            # automated dependency-update PRs (currently misconfigured)
│   └── workflows/
│       └── codeql.yml            # GitHub semantic security scanner: push / PR / weekly
│
├── backend/                      # ← workspace package "1on1-backend"
│   ├── package.json              # express, cors, dotenv + nodemon
│   └── src/
│       └── server.js             # THE ENTIRE BACKEND. 23 lines. One route.
│
├── frontend/                     # ← workspace package "1on1-frontend"
│   ├── index.html                # Vite's real entry point; owns <div id="root">
│   ├── main.jsx                  # React bootstrap: createRoot(...).render(<App/>)
│   ├── app.jsx                   # pass-through wrapper, renders <Login/>
│   ├── package.json              # react, react-dom + vite/eslint toolchain
│   ├── vite.config.js            # port 3000, /api proxy -> :5000, envDir '../'
│   └── src/
│       └── pages/
│           ├── login.jsx         # the only real UI: combined sign-in/register card
│           ├── login.css         # global stylesheet (NOT scoped)
│           ├── landingpage.jsx   # !! EMPTY — 0 bytes
│           └── register.jsx      # !! EMPTY — 0 bytes
│
├── docs/
│   ├── 01-product-requirements.md   # 735 lines — product vision
│   ├── 02-technology-stack.md       # 827 lines — intended stack
│   ├── 03-system-design.md          # 1012 lines — intended architecture
│   ├── *.pdf                        # PDF renders of the three above (untracked)
│   ├── code/                        # ← YOU ARE HERE. Docs about the actual code.
│   └── learn/                       # ← prompt / context / loop / graph engineering
│
├── .gitignore                    # node_modules, .env
├── .npmrc                        # only-built-dependencies=["esbuild"]
├── package.json                  # ROOT: orchestration only, no app code
├── pnpm-lock.yaml                # 130KB — reproducible-install source of truth
├── pnpm-workspace.yaml           # declares frontend + backend as workspaces
└── README.md                     # 5 bytes: "#1on1"
```

**Real totals:** 4 source files with logic (`server.js`, `main.jsx`, `app.jsx`,
`login.jsx`), 1 stylesheet, 2 empty placeholder files, 5 config files, 2 CI files.

---

## 3. The three `package.json` files and their three different jobs

This confuses everyone the first time. There are three, and they do not overlap.

| File | Package name | Job | Has app code? |
|---|---|---|---|
| `package.json` | `1on1` | **Orchestrator.** Runs both workspaces with one command. Blocks non-pnpm installs. | No |
| `backend/package.json` | `1on1-backend` | Server runtime + its deps | Yes → `src/server.js` |
| `frontend/package.json` | `1on1-frontend` | Browser app + build toolchain | Yes → `index.html`, `*.jsx` |

The root package's `--filter` flags target the **`name` field**, not the folder:

```jsonc
"dev:backend":  "pnpm --filter 1on1-backend  run dev"   // name, not "backend"
"dev:frontend": "pnpm --filter 1on1-frontend run dev"   // name, not "frontend"
```

Rename a `name` field and the root scripts silently stop matching anything. Full
breakdown in [`02-root-config.md`](02-root-config.md).

---

## 4. How the two halves find each other

This is the single most important wiring fact in the repo, and it lives in three
files at once.

```text
  BROWSER                    VITE DEV SERVER              EXPRESS
  localhost:3000  ─────────►  :3000                        :5000
                              │
   fetch('/api/health')       │  vite.config.js proxy      │
                              │  '/api' -> localhost:5000  │
                              └───────────────────────────►│
                                                           │ app.get('/api/health')
                              ◄────────────────────────────┘ res.json({status:'ok'})
```

Three facts must agree for this to work:

| Fact | Declared in | Value |
|---|---|---|
| Frontend port | `frontend/vite.config.js` | `server.port: 3000` |
| Backend port | `backend/src/server.js` | `process.env.PORT` or `5000` |
| Proxy target | `frontend/vite.config.js` | `http://localhost:5000` |

If you set `PORT=8080` in `.env`, the backend moves but **the proxy target does not
follow it** — it is a hardcoded string. That is a real footgun; see
[`08-gaps-and-findings.md`](08-gaps-and-findings.md).

### The `.env` triangle

Both halves deliberately read **one shared `.env` at the repo root**:

```text
                    <repo root>/.env          ← gitignored; you must create it
                     ▲                ▲
                     │                │
   backend/src/server.js        frontend/vite.config.js
   dotenv.config({              envDir: '../'
     path: '../../.env'         (relative to frontend/)
   })                           (only VITE_* vars reach the browser)
```

`backend/src` → `..` → `backend` → `..` → repo root. Two different relative strings
resolving to the same file. That is intentional, not a coincidence.

---

## 5. Startup sequence, end to end

What actually happens when you type `pnpm dev`:

```text
$ pnpm dev
  │
  ├─ (root package.json) "dev": concurrently "pnpm run dev:backend" "pnpm run dev:frontend"
  │
  ├──► CHILD 1 ─── pnpm --filter 1on1-backend run dev
  │                  └─ nodemon src/server.js        (fs watch -> restart on change)
  │                       └─ node src/server.js
  │                            ├─ dotenv reads <root>/.env
  │                            ├─ app.use(cors())
  │                            ├─ app.use(express.json())
  │                            ├─ app.get('/api/health', ...)
  │                            └─ app.listen(5000)   ✔ "Backend server is running…"
  │
  └──► CHILD 2 ─── pnpm --filter 1on1-frontend run dev
                     └─ vite
                          ├─ reads vite.config.js
                          ├─ loads <root>/.env  (envDir: '../')
                          ├─ serves frontend/index.html on :3000
                          └─ on browser request:
                               index.html
                                 └─ <script type="module" src="/main.jsx">
                                      └─ main.jsx  -> createRoot(#root)
                                           └─ <React.StrictMode>
                                                └─ app.jsx    App()
                                                     └─ login.jsx   Login()
                                                          └─ import './login.css'
```

**Two processes, one terminal, interleaved prefixed output.** That is all
`concurrently` does — it is a process multiplexer, not a build tool.

---

## 6. File-by-file, one line each

### Application code

| File | Lines | Role |
|---|---|---|
| [backend/src/server.js](../../backend/src/server.js) | 23 | Express app, CORS + JSON middleware, `GET /api/health`, listen on 5000 |
| [frontend/index.html](../../frontend/index.html) | 12 | HTML shell, `#root` mount node, module script tag |
| [frontend/main.jsx](../../frontend/main.jsx) | 9 | React 18 `createRoot` bootstrap inside `<StrictMode>` |
| [frontend/app.jsx](../../frontend/app.jsx) | 12 | Wrapper component; currently renders only `<Login />` |
| [frontend/src/pages/login.jsx](../../frontend/src/pages/login.jsx) | 169 | The whole UI: dual-mode auth card + inline SVG illustration |
| [frontend/src/pages/login.css](../../frontend/src/pages/login.css) | 232 | Global stylesheet — layout, inputs, buttons, responsive split |
| [frontend/src/pages/landingpage.jsx](../../frontend/src/pages/landingpage.jsx) | **0** | Empty placeholder |
| [frontend/src/pages/register.jsx](../../frontend/src/pages/register.jsx) | **0** | Empty placeholder — register is handled by `login.jsx`'s `isLogin === false` branch |

### Configuration

| File | Read by | When |
|---|---|---|
| `package.json` (root) | pnpm | every `pnpm <script>` / `pnpm install` |
| `pnpm-workspace.yaml` | pnpm | `pnpm install`, any `--filter` |
| `.npmrc` | pnpm | `pnpm install` (lifecycle-script gating) |
| `.gitignore` | git | every `git status` / `git add` |
| `backend/package.json` | pnpm, node | install + `pnpm dev:backend` |
| `frontend/package.json` | pnpm, vite | install + `pnpm dev:frontend` |
| `frontend/vite.config.js` | vite | dev-server start and `vite build` |

### CI / automation

| File | Trigger | What it does |
|---|---|---|
| `.github/workflows/codeql.yml` | push to `main`, PR to `main`, Mondays 08:35 UTC | CodeQL semantic security scan of JS/TS |
| `.github/dependabot.yml` | daily | *Intended* to open dependency-update PRs — **currently misconfigured** |

---

## 7. Where to go next

| You want to understand… | Read |
|---|---|
| root scripts, workspaces, `.env`, README | [`02-root-config.md`](02-root-config.md) |
| the Express server, line by line | [`03-backend.md`](03-backend.md) |
| React render chain, `login.jsx`, Vite, SVG | [`04-frontend.md`](04-frontend.md) |
| every CSS rule and the design tokens | [`05-styles.md`](05-styles.md) |
| every dependency, semver, pnpm mechanics | [`06-dependencies.md`](06-dependencies.md) |
| CodeQL, Dependabot, security posture | [`07-ci-and-security.md`](07-ci-and-security.md) |
| bugs, gaps, doc-vs-code mismatches | [`08-gaps-and-findings.md`](08-gaps-and-findings.md) |
| how to drive an AI agent well | [`../learn/00-index.md`](../learn/00-index.md) |
