# 04 — Frontend

Code-level documentation for `frontend/`. Every claim here was verified against the
working tree; line references point at the current, commented source.

---

## 1. What the frontend is today

A **single-page React 18 application built with Vite**, rendering **exactly one screen**:
a combined login / register card.

| Aspect | Status |
| --- | --- |
| Framework | React 18.2 (`createRoot`, concurrent root) |
| Build tool | Vite 5 (dev server on `:3000`, `vite build` for production) |
| Screens rendered | **1** — a login/register card |
| Router | **None.** No `react-router`, no URL-driven navigation |
| API calls | **None.** Zero `fetch` / `axios` calls in the whole tree |
| Global state | **None.** No Context, Redux, Zustand or react-query |
| Auth | **None.** No token storage, no session, no protected routes |
| Form handling | **None.** Inputs are uncontrolled; submit is cancelled and discarded |
| Styling | One global stylesheet, `login.css`, imported from JS |
| TypeScript | Not used (`.jsx` only), although `@types/react` is installed |
| Tests | None |

The card is **dual-mode**: a single `isLogin` boolean flips it between the "Sign in"
view and the "Create an account" view. That is why there is no separate register
screen even though a `register.jsx` file exists.

**In one sentence:** the frontend is a finished-looking but entirely inert UI shell —
it is pixels, not behaviour.

---

## 2. File tree

```
frontend/
├── index.html              Vite's real entry point. Holds <div id="root"> and the
│                           <script type="module" src="/main.jsx"> that boots React.
├── main.jsx                React bootstrap. createRoot(#root).render(<StrictMode><App/></StrictMode>)
├── app.jsx                 Root component. Currently a pass-through wrapper around <Login/>
├── vite.config.js          Vite config: envDir, react plugin, port 3000, /api -> :5000 dev proxy
├── package.json            Workspace package "1on1-frontend": deps + dev/build/lint/preview scripts
└── src/
    └── pages/
        ├── login.jsx       The one real screen. Login/register card + inline SVG illustration
        ├── login.css       Global stylesheet for that card (dark backdrop, white card, 768px breakpoint)
        ├── landingpage.jsx  ⚠️ EMPTY — 0 bytes. Nothing imports it.
        └── register.jsx     ⚠️ EMPTY — 0 bytes. Nothing imports it. Registration is
                              currently served by login.jsx's `isLogin === false` branch.
```

There is **no** `frontend/public/`, no `assets/`, no `components/`, no `hooks/`, no
`services/` directory. All artwork is inline SVG inside `login.jsx`.

### The two empty files

`frontend/src/pages/landingpage.jsx` and `frontend/src/pages/register.jsx` are both
**literally 0 bytes**. They are placeholders. Because nothing imports them they do not
break the build — but they also mean:

- there is no landing page; `/` renders the login card directly;
- `register.jsx` is dead weight, since the register UI lives in `login.jsx`.

Filling these in is the trigger for adding a router (see §4 and `app.jsx`).

---

## 3. Render chain

```
                       ┌──────────────────────────────────────────────────────┐
  browser requests /   │  frontend/index.html          ← VITE'S ENTRY POINT   │
  ──────────────────►  │  <div id="root"></div>        ← empty mount node     │
                       │  <script type="module" src="/main.jsx">              │
                       └───────────────────────┬──────────────────────────────┘
                                               │  browser loads the module,
                                               │  Vite transpiles JSX on the fly
                                               ▼
                       ┌──────────────────────────────────────────────────────┐
                       │  frontend/main.jsx                                   │
                       │  ReactDOM.createRoot(                                │
                       │      document.getElementById('root')  ← links back   │
                       │  ).render( ... )                                     │
                       └───────────────────────┬──────────────────────────────┘
                                               ▼
                       ┌──────────────────────────────────────────────────────┐
                       │  <React.StrictMode>                                  │
                       │  dev-only; renders no DOM; double-invokes renders     │
                       │  and effects to surface impure code. Stripped in prod.│
                       └───────────────────────┬──────────────────────────────┘
                                               ▼
                       ┌──────────────────────────────────────────────────────┐
                       │  frontend/app.jsx  →  function App()                 │
                       │  returns <div><Login /></div>   ← pass-through only   │
                       │  (future home of the router + global providers)      │
                       └───────────────────────┬──────────────────────────────┘
                                               ▼
                       ┌──────────────────────────────────────────────────────┐
                       │  frontend/src/pages/login.jsx  →  function Login()   │
                       │  state: isLogin, showPassword                        │
                       │  renders: .login-container > .login-card             │
                       │             ├── .login-form-section  (the form)      │
                       │             └── .login-illustration-section          │
                       │                    └── <Illustration/>  (inline SVG) │
                       └───────────────────────┬──────────────────────────────┘
                                               │  import './login.css'
                                               ▼
                       ┌──────────────────────────────────────────────────────┐
                       │  frontend/src/pages/login.css                        │
                       │  global CSS; injected as <style> in dev, extracted    │
                       │  to a hashed .css file by `vite build`                │
                       └──────────────────────────────────────────────────────┘
```

Compact form:

```
index.html (#root) → main.jsx (createRoot) → <StrictMode> → app.jsx (App) → login.jsx (Login) → login.css
```

Two things worth internalising:

1. **`index.html` is the entry point, not `main.jsx`.** Vite parses the HTML first and
   discovers JavaScript by following `<script src>`. In a Webpack/CRA project the
   relationship is inverted (JS entry → HTML plugin injects the tag).
2. **`document.getElementById('root')` is the only coupling** between the HTML and the
   React tree. Rename the `id` in one file and React throws
   *"Target container is not a DOM element"*.

---

## 4. The unusual directory layout

```
frontend/
├── main.jsx     ← at the package root
├── app.jsx      ← at the package root
└── src/
    └── pages/
        └── login.jsx   ← under src/
```

`main.jsx` and `app.jsx` sit at the **`frontend/` root**, while pages live under
**`frontend/src/pages/`**. That is inconsistent — `src/` normally means "all application
source lives here", and here half of it does not.

### Why it still works

Vite resolves module paths relative to the **project root**, which is `frontend/`
(the directory the `vite` command runs in). `index.html` asks for `/main.jsx`; the leading
`/` is root-relative, so Vite serves `frontend/main.jsx`. From there every import is
relative to the importing file:

- `main.jsx` → `./app.jsx` → `frontend/app.jsx`
- `app.jsx` → `./src/pages/login.jsx` → `frontend/src/pages/login.jsx`
- `login.jsx` → `./login.css` → `frontend/src/pages/login.css`

Nothing is broken. It is a convention problem, not a correctness problem.

### The conventional layout

```
frontend/
├── index.html                  <script type="module" src="/src/main.jsx">
├── vite.config.js
├── package.json
├── public/                     static files copied verbatim to dist/
└── src/
    ├── main.jsx                bootstrap
    ├── App.jsx                 root component (PascalCase, matching the component name)
    ├── components/             reusable presentational pieces (Button, InputField, Icon…)
    ├── pages/                  route-level screens (LandingPage, Login, Register)
    ├── hooks/                  custom hooks (useAuth, useFetch)
    ├── services/               API client wrappers (api.js, auth.js)
    └── styles/  or co-located  *.module.css next to each component
```

Migrating is a three-step change: move `main.jsx` and `app.jsx` into `src/`, update
`index.html` to `src="/src/main.jsx"`, and fix `app.jsx`'s import to `./pages/login.jsx`.
Doing it *before* the router lands is cheaper than after.

---

## 5. `frontend/package.json`, field by field

```jsonc
{
  "name": "1on1-frontend",   // workspace package name — the filter target for
                             // `pnpm --filter 1on1-frontend run dev` in the root package.json
  "private": true,           // see below
  "version": "0.0.0",        // placeholder; an app that is never published needs no real version
  "type": "module",          // .js files in this package are ES modules, so vite.config.js
                             // may use `import`/`export` instead of require()
  "scripts": { ... },
  "dependencies": { ... },   // ships in the browser bundle
  "devDependencies": { ... } // build/lint tooling only, never bundled
}
```

### `"private": true`

Makes npm/pnpm **refuse to publish** this package to the public registry. A stray
`npm publish` in this directory errors out instead of pushing your application source
to npmjs.com. It is also what allows a workspace package to skip the fields the registry
would otherwise require (`description`, `license`, a real `version`).

### Scripts

| Script | Command | What it actually does |
| --- | --- | --- |
| `dev` | `vite` | Starts the dev server on `http://localhost:3000` (port from `vite.config.js`). No bundling: each source file is served as a separate ES module and JSX is transpiled per-request by esbuild. Enables HMR + React Fast Refresh, and the `/api → :5000` proxy. |
| `build` | `vite build` | Production build into `frontend/dist/`. Rollup bundles + tree-shakes + minifies the module graph starting from `index.html`, extracts CSS into a hashed `.css` file, rewrites `<script src="/main.jsx">` to the hashed bundle, and drops `StrictMode`'s dev behaviour. **The dev proxy does not exist in this output.** |
| `lint` | `eslint . --ext js,jsx --report-unused-disable-directives --max-warnings 0` | *Intended to* lint every `.js`/`.jsx` file, flag `eslint-disable` comments that suppress nothing, and fail CI on the first warning (`--max-warnings 0`). **Currently broken — see below.** |
| `preview` | `vite preview` | Serves the already-built `dist/` over a local static server. A smoke test of the real production artifact. It is **not** a dev server: no HMR, no JSX transform, **and no `/api` proxy**, so API calls that work under `dev` will 404 under `preview`. |

### ⚠️ `pnpm lint` will fail today — verified

There is **no ESLint configuration file anywhere in the repository**. Verified by:

```bash
find . -not -path "*/node_modules/*" \( -name ".eslintrc*" -o -name "eslint.config.*" \)
# → no results

grep -rn "eslintConfig" --include=package.json .
# → no results
```

So none of `.eslintrc`, `.eslintrc.js`, `.eslintrc.json`, `.eslintrc.cjs`,
`eslint.config.js` (flat config) exists, and there is no `eslintConfig` key in any
`package.json`. ESLint 8 with no config aborts:

```
Oops! Something went wrong! :(
ESLint: 8.x.x
ESLint couldn't find a configuration file.
```

The four ESLint packages in `devDependencies` (`eslint`, `eslint-plugin-react`,
`eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` — `frontend/package.json:20-23`)
are installed but **inert**: nothing loads them. The fix is to add an `.eslintrc.cjs`
(ESLint 8 style) at `frontend/` that extends `eslint:recommended`,
`plugin:react/recommended` and `plugin:react-hooks/recommended`. `react-hooks` would
immediately be useful here — it is the rule set that flags the stale-closure and
component-definition problems listed in §8.

---

## 6. Annotated walkthrough

### 6.1 `frontend/main.jsx`

**Chunk 1 — imports**

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app.jsx'
```

- `react` — needed for the explicit `React.StrictMode` reference. (The automatic JSX
  runtime that `@vitejs/plugin-react` enables means React does *not* have to be in scope
  merely to write JSX.)
- `react-dom/client` — the React 18+ subpath that exports `createRoot`. Importing from
  here, rather than plain `react-dom`, is what opts the app into the concurrent renderer.
- `./app.jsx` — the explicit extension is required; Vite does not silently append `.jsx`
  to relative imports the way Webpack/CRA did.

**Chunk 2 — the mount call** (`main.jsx:66`)

```jsx
ReactDOM.createRoot(document.getElementById('root')).render(...)
```

Two operations in one line:

1. `document.getElementById('root')` grabs the empty `<div>` from `index.html`
   (`index.html:71`). This is the HTML ↔ React seam.
2. `createRoot(container)` builds a **concurrent root**; `.render(tree)` tells it what to draw.

`createRoot` vs the legacy `ReactDOM.render(<App/>, container)`:

| | Legacy `render` | `createRoot` |
| --- | --- | --- |
| Rendering | Synchronous, blocking, uninterruptible | Interruptible, priority-aware |
| State batching | Only inside React event handlers | Automatic everywhere (promises, timeouts, native handlers) |
| Unlocks | — | `useTransition`, `useDeferredValue`, `Suspense` for data, streaming SSR |
| Under React 18 | Works, but warns and silently downgrades to legacy mode | The supported path |

The returned root object is discarded, which is normal for an app that never unmounts.
Keeping it would allow a later `root.unmount()`.

**Chunk 3 — `<React.StrictMode>`** (`main.jsx:89`)

Development-only. It renders **no DOM** — no wrapper element, no styles, zero visual
effect — and is **removed entirely from the production build**. In dev it deliberately
double-invokes anything that must be pure:

- component function bodies run twice per render;
- `useState` / `useMemo` / `useReducer` initialisers run twice;
- every `useEffect` mounts → cleans up → mounts again.

This surfaces missing effect cleanups, prop mutation and other impurity immediately.
It is also why a `console.log` can appear twice in dev. It additionally warns about
legacy APIs (string refs, `findDOMNode`, old context, deprecated lifecycles).

Practical note: `Login` has no effects today, so the double render is invisible. The
moment a `fetch('/api/login')` lands in a `useEffect`, expect it to fire twice in dev —
that is StrictMode, not a bug.

### 6.2 `frontend/vite.config.js`

**Chunk 1 — `defineConfig`** (`vite.config.js:19`)

At runtime it is an **identity function**: it returns the object you pass, unchanged.
Its only value is typing — it is declared `(config: UserConfig) => UserConfig`, so
editors give autocomplete and flag typos. Without it, `serverr: {...}` would be
silently ignored.

**Chunk 2 — `plugins: [react()]`** (`vite.config.js:54`)

`@vitejs/plugin-react` does two jobs:

1. **JSX transform** — `<App />` is not valid JavaScript. The plugin routes `.jsx` files
   through esbuild/Babel so it compiles to a `jsx(App)` call. Without it, every file in
   this project fails to parse.
2. **Fast Refresh** — hot-swaps an edited component in the running page *while preserving
   its `useState` values*, so `isLogin` / `showPassword` survive a save.

`react()` is *called*, not merely referenced, because the plugin is a factory.

**Chunk 3 — `envDir: '../'`** (`vite.config.js:49`)

Vite's default is to read `.env` files from the project root (`frontend/`). `'../'`
points one level up, at the **repository root**, so the frontend and backend share
**one** `.env`. This deliberately mirrors the backend, which does:

```js
// backend/src/server.js
dotenv.config({ path: path.join(__dirname, '../../.env') });   // → <repo root>/.env
```

Same file, two consumers, no drift. (`.env` is gitignored at the repo root.)

**The `VITE_` prefix rule — and why it exists.** Vite injects **only** variables named
`VITE_*` into client code, as `import.meta.env.VITE_FOO`. Everything else in that shared
`.env` — `DB_URI`, `JWT_SECRET`, API keys, SMTP passwords — is filtered out and never
reaches the browser.

The reason is that the **frontend bundle is public**. Anything inlined into it is
readable by anyone via View Source or devtools; minification is not obfuscation. The
prefix is an explicit opt-in meaning "I accept that this value is public". The important
corollary: **never name a secret `VITE_SOMETHING`** — that single rename is all it takes
to publish it to every visitor. This matters more than usual here precisely *because*
`envDir` points at a shared file that also holds backend secrets.

**Chunk 4 — `server.port: 3000`** (`vite.config.js:61`)

Overrides Vite's default `5173`. Keeps the frontend (`3000`) and backend (`5000`)
cleanly separated; the proxy target below assumes this split.

**Chunk 5 — the `/api` dev proxy** (`vite.config.js:109-120`)

```js
proxy: {
  '/api': {
    target: 'http://localhost:5000',
    changeOrigin: true
  }
}
```

How it works:

```
  browser                    Vite dev server              Express
  (origin :3000)             (:3000)                      (:5000)
      │                          │                            │
      │ fetch('/api/health')     │                            │
      ├─────────────────────────►│  path starts with /api     │
      │                          ├───────────────────────────►│ GET /api/health
      │                          │  (server-to-server, Node)  │
      │◄─────────────────────────┤◄───────────────────────────┤ 200 {"status":"ok"}
      │                          │                            │
   the browser only ever saw ONE origin: http://localhost:3000
```

- `'/api'` is a **prefix match**. There is no `rewrite`, so the path is forwarded
  unchanged — correct, because Express registers the route as
  `app.get('/api/health', ...)`, prefix included.
- **Why there is no CORS in dev:** the browser only ever talks to `localhost:3000`. No
  cross-origin request is made, so there is no preflight `OPTIONS` and no
  `Access-Control-Allow-Origin` check. The hop from Vite to Express happens in Node, and
  the same-origin policy is a *browser* rule, not a network rule.
- **Consequence:** `app.use(cors())` in `backend/src/server.js` is **redundant for proxied
  traffic**. It is still required for (a) hitting `http://localhost:5000/api/...` directly
  from a browser, another port, or a second frontend, and (b) any production deploy where
  the API lives on a different origin (`api.example.com` vs `app.example.com`) — a
  genuine cross-origin request.
- `changeOrigin: true` rewrites the outgoing **`Host` header** from `localhost:3000` to
  the target's host (`localhost:5000`). Locally that changes nothing Express cares about,
  but it is the setting that makes the proxy work against virtual-hosted targets — an
  nginx/Vercel/Heroku backend that routes by `Host`, or an HTTPS API that also checks SNI.
  Leaving it off is a classic source of mystery 404s and TLS errors once the target stops
  being localhost.

> ### ⚠️ The proxy is DEVELOPMENT-ONLY
>
> `vite build` emits static HTML/JS/CSS into `dist/`. There is no Vite server left to
> proxy anything, and `vite preview` does **not** apply this config either. In production a
> relative `fetch('/api/health')` hits whatever static host serves `dist/` and 404s.
>
> Production needs one of:
> 1. **A real reverse proxy** (nginx / Caddy / a platform rewrite rule) mapping
>    `/api → the Node service`. Keeps a single origin, so still no CORS. Recommended.
> 2. **An absolute API base URL** baked in at build time, e.g.
>    `import.meta.env.VITE_API_URL`. This *does* make requests cross-origin, so the
>    backend's `cors()` must then be configured with an explicit allowed origin
>    (`cors({ origin: 'https://app.example.com', credentials: true })`) — bare `cors()`
>    allows `*`, which is incompatible with cookie-based auth.

---

## 7. `login.jsx` in detail

`frontend/src/pages/login.jsx`

### Component contract

| | |
| --- | --- |
| Export | `export default function Login()` |
| Props | **none** |
| Imported by | `frontend/app.jsx:28` |
| Side effects | none — no `useEffect`, no network, no storage |
| Emits | nothing — no callbacks, no events out |
| Owns | all of its state internally |
| Styles | `./login.css` (global, not scoped) |

Because it takes no props and emits nothing, `Login` is a **closed box**. Nothing outside
it can observe or influence what the user typed — which is the structural reason §8's
"no form submission" issue is not a one-line fix.

### State

| Hook | Initial | Line |
| --- | --- | --- |
| `const [isLogin, setIsLogin] = useState(true)` | `true` | `login.jsx:57` |
| `const [showPassword, setShowPassword] = useState(false)` | `false` | `login.jsx:64` |

#### What each value changes in the UI

| State | Value | Effect on the rendered UI |
| --- | --- | --- |
| `isLogin` | `true` (default) | Heading = "Sign in". Name field **hidden**. "Remember me" + "Forgot password?" row **shown**. Submit button = "Sign in". Divider = "Or sign in with". Prompt = "Don't have an account?" / button = "Register". |
| `isLogin` | `false` | Heading = "Create an account". Name field **shown**. "Remember me" + "Forgot password?" row **hidden**. Submit button = "Register". Divider = "Or register with". Prompt = "Already have an account?" / button = "Sign in". |
| `showPassword` | `false` (default) | Password input is `type="password"` (masked). Toggle draws the **eye-slash** icon. |
| `showPassword` | `true` | Password input is `type="text"` (readable). Toggle draws the **eye** icon. |

Six pieces of UI hang off one boolean. That is the entire "two screens in one component"
trick.

### Handlers

```jsx
const toggleMode = () => setIsLogin(!isLogin);                        // login.jsx:91
const togglePasswordVisibility = () => setShowPassword(!showPassword); // login.jsx:92
```

Both read state from the **closure of the render that created them**. React 18 batches
every update inside an event handler into one re-render, so if either were called twice
in the same tick — or from an async callback, a `setTimeout`, or a handler captured
earlier — both calls would read the *same* stale value and the second would merely repeat
the first. Net effect: one toggle instead of two.

The safe idiom is the **functional updater**, which receives the latest queued value:

```jsx
const toggleMode = () => setIsLogin(v => !v);
const togglePasswordVisibility = () => setShowPassword(v => !v);
```

With a single synchronous click handler the current code happens to behave correctly,
which is exactly why this bug class is easy to miss. *(Documented, not changed.)*

### Conditional-render map

| Line | Pattern | Renders when |
| --- | --- | --- |
| `login.jsx:319` | `{isLogin ? 'Sign in' : 'Create an account'}` | always (text swaps) |
| `login.jsx:357` | `{!isLogin && (<div className="input-group">…Name…</div>)}` | register mode only |
| `login.jsx:406` | `type={showPassword ? "text" : "password"}` | always (attribute swaps) |
| `login.jsx:435` | `{showPassword ? (<svg eye/>) : (<svg eye-slash/>)}` | always (icon swaps) |
| `login.jsx:475` | `{isLogin && (<div className="form-options">…</div>)}` | sign-in mode only |
| `login.jsx:488` | `{isLogin ? 'Sign in' : 'Register'}` | always (button label swaps) |
| `login.jsx:496` | `Or {isLogin ? 'sign in' : 'register'} with` | always (divider text swaps) |
| `login.jsx:547` | `{isLogin ? "Don't have…" : "Already have…"}` | always (prompt swaps) |
| `login.jsx:549` | `{isLogin ? 'Register' : 'Sign in'}` | always (switch label swaps) |

#### How `&&` rendering works

`{cond && <jsx/>}` relies on JavaScript's short-circuit semantics: `&&` returns the
**right** operand when the left is truthy, and the **left** operand when it is falsy. So:

- `!isLogin === true` → the expression evaluates to the JSX element → React renders it.
- `!isLogin === false` → the expression evaluates to `false` → React renders **nothing**
  (booleans, `null` and `undefined` all produce no output).

**Caveat worth memorising:** the trick is only safe with real booleans. With a number,
`{items.length && <List/>}` renders a literal **`0`** on screen, because `0` is falsy but
*is* a renderable value. Use `cond ? x : null` whenever the left side is not guaranteed
to be a boolean.

`{cond ? a : b}` is used where *both* branches produce output. A ternary — not `if/else` —
because JSX braces hold an **expression**, and `if` is a statement.

### The form

```jsx
<form onSubmit={(e) => e.preventDefault()}>   // login.jsx:342
```

`preventDefault()` cancels the browser's default form behaviour, which for a `<form>` with
no `action` is a full-page GET back to the current URL — a hard navigation that wipes all
React state and visibly reloads the app. Every SPA form needs this call.

**And that is all the handler does.** See §8.

### SVG primer

The `Illustration` component (`login.jsx:176`) is ~35 hand-authored SVG nodes. The
concepts, once:

| Concept | Meaning |
| --- | --- |
| `viewBox="0 0 400 500"` | `min-x min-y width height` — the internal coordinate system. Every child coordinate is in these 400×500 **user units**, not pixels. `width="100%" height="100%"` then scales that virtual canvas to the parent, which is what makes the artwork resolution-independent. The default `preserveAspectRatio` (`xMidYMid meet`) letterboxes and centres it. |
| `<path d="…">` `M x,y` | **MOVETO** — lift the pen, jump to `(x,y)`, start a subpath. |
| `L x,y` | **LINETO** — straight line to `(x,y)`. |
| `C x1,y1 x2,y2 x,y` | **CUBIC BÉZIER** — curve to `(x,y)`, bending toward control points `(x1,y1)` then `(x2,y2)`. The controls are magnets; the curve does not pass through them. |
| `Z` | **CLOSEPATH** — straight line back to the subpath start, sealing the outline so `fill` has a defined interior. |
| `A` / `a` | **ARC** — `rx ry rotation large-arc-flag sweep-flag x y`. Used by the Heroicons eye icons for the round pupil. |
| Case | **Uppercase = absolute** coordinates, **lowercase = relative** to the current point. |
| `fill` | Paints the **interior**. `fill="none"` means hollow — set explicitly on every open path, because SVG's default fill is **black** and an unfilled open curve renders as a black blob closed by an implicit straight line. |
| `stroke` / `strokeWidth` | Paints the **outline**; width is in user units, so it scales with the viewBox. |
| `strokeLinecap` / `strokeLinejoin` | How a stroke **ends** (butt/round/square) and how two segments **meet** (miter/round/bevel). Character 2's legs use `round` + `round` with `strokeWidth="12"` — that is what turns two thin segments into a smooth tubular limb. |
| `<g transform="translate(x,y)">` | A **group**. (a) Shared attributes cascade to children — the sparkle groups declare `stroke` and `strokeWidth` once for four `<line>`s. (b) `transform` establishes a **local coordinate origin**: inside `translate(130,200)`, `(0,0)` means `(130,200)` on the canvas, so a character is authored around its own centre with small numbers and moved by editing one pair. `scale(0.5)` multiplies every child coordinate. Transforms apply right-to-left. |
| Paint order | SVG has **no `z-index`** — later siblings paint over earlier ones. |
| JSX syntax | Hyphenated SVG attributes become camelCase (`stroke-width` → `strokeWidth`); numeric props use braces (`strokeWidth={1.5}`); comments must be `{/* … */}` — a bare `//` inside a JSX tree renders as visible text. |

The illustration is built from five logical groups: background swirls and dots, accent
triangles, character 1 (white/amber, holding a laptop), character 2 (red torso, blue
legs), and two sparkles. Each is comment-marked in the source.

The password-toggle icons are **Heroicons outline** paths using `stroke="currentColor"`,
which inherits the CSS `color` of `.password-toggle` (`#9ca3af` in `login.css`) — restyle
the icon by changing CSS, never the SVG.

---

## 8. Known issues in the frontend

Ordered roughly by severity. All references are `file:line` against the current source.

| # | Issue | Location | Detail |
| --- | --- | --- | --- |
| 1 | **No form submission wiring** | `login.jsx:342` | `onSubmit={(e) => e.preventDefault()}` cancels the navigation and does nothing else. No `fetch`, no `action`, no validation, no loading or error state, no success path. Submitting the form is a no-op. This is the single largest gap. |
| 2 | **Inputs are uncontrolled and unread** | `login.jsx:374` (Name), `login.jsx:387` (Email), `login.jsx:405-409` (Password), `login.jsx:478` (Remember me) | None has `value`, `onChange`, or even a `name` attribute. React never observes what the user types; the text exists only in the DOM nodes. Fixing #1 requires fixing this first (controlled state per field, or refs / `new FormData(e.target)`). |
| 3 | **`Illustration` defined inside `Login`** | `login.jsx:176` (definition), `login.jsx:560` (usage) | A new function object is created on every `Login` render, so React sees a different component *type* each time and **unmounts + remounts the entire ~35-node SVG subtree** instead of reconciling it. Harmless-looking here because the SVG is static, but the same pattern destroys state, focus, and animations in any subtree that has them. Fix: hoist to module scope (it closes over nothing) or move to its own file. |
| 4 | **Google logo is single-colour** | `login.jsx:525`, `:526`, `:527`, `:528` | All four `<path>` elements are hardcoded `fill="#EA4335"` (Google red). The real mark uses four brand colours: path 1 → `#4285F4` blue, path 2 → `#34A853` green, path 3 → `#FBBC05` yellow, path 4 → `#EA4335` red. Also a brand-guidelines violation, not just cosmetics. |
| 5 | **Labels not associated with inputs** | `login.jsx:366` (Name), `login.jsx:385` (Email), `login.jsx:394` (Password) | `<label>` has no `htmlFor` and the matching `<input>` has no `id`. Screen readers announce the fields as unlabelled, and clicking the label text does not focus the input. Fix: `id="email"` + `htmlFor="email"` (JSX uses `htmlFor` because `for` is reserved), or nest the input inside the label — which the "Remember me" checkbox at `login.jsx:477-480` already does correctly. |
| 6 | **Icon-only buttons have no `aria-label`** | `login.jsx:419` (password toggle), `login.jsx:505` (Google button) | Both contain only an `<svg>` and no text, so assistive tech announces "button" with no name. Needs `aria-label={showPassword ? 'Hide password' : 'Show password'}` (plus `aria-pressed`) and `aria-label="Sign in with Google"`, with the inner SVGs marked `aria-hidden="true"`. |
| 7 | **Dead link** | `login.jsx:481` | `<a href="#" className="forgot-password">` navigates to the top of the page and appends `#` to the URL. A control that does nothing yet is not a hyperlink — use a `<button>` styled as a link, or point it at a real `/forgot-password` route. |
| 8 | **Decorative SVG not hidden from AT** | `login.jsx:181` | The illustration `<svg>` has no `aria-hidden="true"`, no `role="img"` and no `<title>`, so screen readers may attempt to traverse it. |
| 9 | **Empty page files** | `frontend/src/pages/landingpage.jsx`, `frontend/src/pages/register.jsx` | Both are 0 bytes. Nothing imports them, so they do not break the build, but there is no landing page and the register UI is squatting inside `login.jsx`'s `isLogin === false` branch. |
| 10 | **No router** | `frontend/app.jsx:63-72` | `App` renders `<div><Login /></div>` and nothing else. Every URL renders the same screen; there is no `/login`, `/register` or `/`, no deep linking, no back-button behaviour. Adding `react-router-dom` in `App` is the unblocking change for #9. |
| 11 | **`pnpm lint` fails — no ESLint config** | `frontend/package.json:9` | The `lint` script and four ESLint packages are installed, but no `.eslintrc*` / `eslint.config.*` exists anywhere in the repo (verified). ESLint 8 exits with *"couldn't find a configuration file"*. See §5. |
| 12 | **Stale-closure toggle idiom** | `login.jsx:91`, `login.jsx:92` | `setIsLogin(!isLogin)` / `setShowPassword(!showPassword)` read the closed-over value. Correct today, but fragile under batching or async callers. Prefer `setIsLogin(v => !v)`. |
| 13 | **Global, unscoped CSS** | `login.jsx:35` → `login.css` | `login.css` contains bare `*` and `body` selectors and generic class names (`.input-field`, `.divider`, `.submit-btn`). Importing it anywhere styles the whole document, and a second page will collide. CSS Modules (`login.module.css`) or a scoping strategy is needed before a second screen exists. |
| 14 | **Inconsistent source layout** | `frontend/main.jsx`, `frontend/app.jsx` vs `frontend/src/pages/` | Entry files at the package root, pages under `src/`. Works, but is not the convention. See §4. |

---

## 9. How to run it

From the **repository root**:

```bash
# frontend only — Vite dev server on http://localhost:3000
pnpm dev:frontend

# backend only — Express on http://localhost:5000
pnpm dev:backend

# both at once (concurrently)
pnpm dev
```

Then open **<http://localhost:3000>**. You should see the dark backdrop with a white
card; the green illustration panel appears only at viewport widths **≥ 768px**
(`@media (min-width: 768px)` in `login.css`).

The root scripts are thin wrappers over the workspace packages:

```jsonc
"dev:frontend": "pnpm --filter 1on1-frontend run dev",   // → `vite` inside frontend/
"dev:backend":  "pnpm --filter 1on1-backend run dev",    // → `nodemon src/server.js`
"dev":          "concurrently \"pnpm run dev:backend\" \"pnpm run dev:frontend\""
```

> `preinstall` runs `only-allow pnpm` — npm and yarn are blocked at the root, and the root
> `devEngines` field enforces pnpm too. Use pnpm.

### Verifying the proxy

With **both** servers running, open the browser devtools console on
`http://localhost:3000` and run:

```js
await (await fetch('/api/health')).json()
// → { status: 'ok', message: 'Server is running perfectly!' }
```

Note what did *not* happen: **no CORS error, and no preflight request**. The browser
only ever contacted `localhost:3000`; Vite forwarded the call to `localhost:5000` from
Node. See §6.2.

Fetching `http://localhost:5000/api/health` **directly** from that same page *is* a
cross-origin request, and it only succeeds because `backend/src/server.js` calls
`app.use(cors())`.

### Production build

```bash
pnpm --filter 1on1-frontend run build     # → frontend/dist/
pnpm --filter 1on1-frontend run preview   # serve dist/ locally
```

Remember: `preview` has **no `/api` proxy**. Any relative API call that worked under
`dev` will 404 under `preview` and in production until a reverse proxy or an absolute
`VITE_API_URL` is in place (§6.2).

---

## 10. Dependencies

Not duplicated here. See **[`06-dependencies.md`](./06-dependencies.md)** for the
package-by-package breakdown — what `react`, `react-dom`, `@vitejs/plugin-react`, `vite`,
the `@types/*` packages and the ESLint plugin set each do, why they sit in
`dependencies` vs `devDependencies`, and the version constraints in play.

---

## Related documents

| Document | Covers |
| --- | --- |
| `docs/01-product-requirements.md` | What the product is meant to become |
| `docs/02-technology-stack.md` | Chosen stack and engineering plan |
| `docs/03-system-design.md` | System architecture |
| `docs/code/04-frontend.md` | **this file** — the frontend as it exists in code |
| `docs/code/06-dependencies.md` | Dependency deep-dive |
