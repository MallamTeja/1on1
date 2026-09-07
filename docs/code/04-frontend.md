# 04 — Frontend

Code-level documentation for `frontend/`. Every claim here was verified against the
working tree; line references point at the current, commented source.

> **RE-DERIVED 2026-09-06.** §§1–8 previously described the original plain-`.jsx`
> frontend behind a STATUS banner, because the TypeScript port had landed but was
> not yet mounted. That port is now finished and wired: `index.html` loads
> `/src/main.tsx`, a router renders, and the old `main.jsx` / `app.jsx` /
> `src/pages/{login,landingpage,register}.jsx` / `src/pages/login.css` files have
> been **deleted**. This file now describes what exists.
>
> If you are reading an older revision and wondering where the `isLogin` toggle,
> the uncontrolled inputs or the inline `Illustration` SVG went: they were part of
> that deleted mock. See `docs/code/09-stack-correction-2026-09-05.md` for the
> migration record.
>
> Nothing in this frontend involves Java or Spring Boot. `1on1_sb` is a *separate*
> repo that happens to use Spring; only its UI was ported here, into React +
> TypeScript.

---

## 1. What the frontend is today

A **single-page React 18 + TypeScript application built with Vite**, rendering
**three routed screens**: a marketing landing page, a login page and a register page.

| Aspect | Status |
| --- | --- |
| Framework | React 18.3 (`createRoot`, concurrent root) |
| Language | **TypeScript** — `.tsx` / `.ts` only, zero `.jsx` files remain |
| Build tool | Vite 6.4 (dev server on `:3000`, `tsc -b && vite build` for production) |
| Screens rendered | **3** — `/` Landing, `/login`, `/register` |
| Router | `react-router-dom` v7, `<BrowserRouter>` in `main.tsx` |
| API calls | `src/lib/api.ts` — `POST /api/auth/{login,register,refresh}` |
| Global state | React Context — `AuthProvider` / `useAuth()` in `src/lib/auth.tsx` |
| Auth | Access token **in memory**; refresh token in an HTTP-only cookie |
| Form handling | Controlled inputs, per-field validation, touched/error state |
| Styling | Plain global CSS, namespaced by prefix; ~34 design tokens in `:root` |
| Type checking | `pnpm --filter 1on1-frontend run typecheck` — clean |
| Linting | ESLint 10 flat config — `pnpm --filter 1on1-frontend run lint` — clean |
| Tests | **None.** Still the largest gap. |

**In one sentence:** the frontend is now a real application — three routed screens,
validated forms and a typed API layer — talking to a backend that has not
implemented the endpoints yet.

> **The endpoints are a contract, not shipped behaviour.** `backend/src/server.js`
> registers exactly one reachable route, `GET /api/health`. Everything in §7 below
> describes what the client *sends*; nothing on the server answers it yet. The UI
> stays walkable anyway — see the `NetworkError` path in §7.4.

---

## 2. File tree

```
frontend/
├── index.html              Vite's real entry point. Holds <div id="root">, the Google
│                           Fonts links, and <script type="module" src="/src/main.tsx">.
├── vite.config.js          envDir, react plugin, port 3000, /api -> :5000 dev proxy
├── eslint.config.js        ESLint 10 flat config (see §5.4)
├── tsconfig.json           Solution config — references the two below, holds no files
├── tsconfig.app.json       Browser code under src/ (DOM libs, strict)
├── tsconfig.node.json      Build tooling (vite.config.js)
├── package.json            Workspace package "1on1-frontend"
├── public/
│   └── mark.svg            The only static asset in the project. Served at /mark.svg.
└── src/
    ├── main.tsx            Bootstrap: createRoot + the four nested providers
    ├── App.tsx             The router: / , /login , /register , * -> /
    ├── index.css           Design tokens + reset + shared `ui-` primitives
    ├── components/
    │   ├── AuthShell.tsx   Two-panel shell shared by Login and Register
    │   ├── authShell.css   Styles for it, namespaced `.au-`
    │   ├── Brand.tsx       The 1on1 wordmark + inline SVG mark
    │   ├── Icons.tsx       ~28 hand-written inline SVG icons
    │   ├── SlotBlock.tsx   The repeated "bounded piece of time" primitive
    │   └── TextField.tsx   Label + input + hint/error, used by both auth forms
    ├── pages/
    │   ├── Landing.tsx     The marketing page
    │   ├── landing.css     Styles for it, namespaced `.ld-`
    │   ├── Login.tsx       Email + password form
    │   └── Register.tsx    Full name + email + password form
    └── lib/
        ├── api.ts          fetch wrapper, ApiError/NetworkError, in-memory token
        ├── auth.tsx        AuthProvider + useAuth()
        ├── types.ts        Wire shapes — the auth subset only
        └── validate.ts     Field validators mirroring the API's rules
```

Everything lives under `src/`. There are **no image assets** beyond `public/mark.svg`
and **no icon library** — every icon is hand-written inline SVG in `Icons.tsx`. Keep
it that way; it is why the app ships no image requests at all.

---

## 3. Render chain

```
                       ┌──────────────────────────────────────────────────────┐
  browser requests /   │  frontend/index.html          ← VITE'S ENTRY POINT   │
  ──────────────────►  │  <div id="root"></div>        ← empty mount node     │
                       │  <script type="module" src="/src/main.tsx">          │
                       └───────────────────────┬──────────────────────────────┘
                                               │  Vite transpiles TSX on the fly
                                               ▼
                       ┌──────────────────────────────────────────────────────┐
                       │  src/main.tsx                                        │
                       │  import "./index.css"   ← BEFORE ./App. Load-bearing;│
                       │                            see §4.2                  │
                       │  createRoot(getElementById("root")!).render(...)      │
                       └───────────────────────┬──────────────────────────────┘
                                               ▼
                       ┌──────────────────────────────────────────────────────┐
                       │  <StrictMode>          dev-only, double-invokes      │
                       │   └ <BrowserRouter>    history + URL matching        │
                       │      └ <AuthProvider>  session context (lib/auth)    │
                       │         └ <App />                                    │
                       └───────────────────────┬──────────────────────────────┘
                                               ▼
                       ┌──────────────────────────────────────────────────────┐
                       │  src/App.tsx                                         │
                       │  <ScrollToTop/> then <Routes>:                       │
                       │     /          → <Landing/>                          │
                       │     /login     → <Login/>                            │
                       │     /register  → <Register/>                         │
                       │     *          → <Navigate to="/" replace/>          │
                       └───────────────────────┬──────────────────────────────┘
                                               ▼
                       ┌──────────────────────────────────────────────────────┐
                       │  pages → components → lib                            │
                       │  Login/Register wrap themselves in <AuthShell>,      │
                       │  which renders <Brand>, <Icons> and the Google button│
                       └──────────────────────────────────────────────────────┘
```

Compact form:

```
index.html (#root) → main.tsx → StrictMode → BrowserRouter → AuthProvider → App → route → page
```

Three things worth internalising:

1. **`index.html` is the entry point, not `main.tsx`.** Vite parses the HTML first
   and discovers JavaScript by following `<script src>`. In a Webpack/CRA project
   the relationship is inverted (JS entry → HTML plugin injects the tag).
2. **`document.getElementById("root")` is the only coupling** between the HTML and
   the React tree. Rename the `id` in one file and React throws *"Target container
   is not a DOM element"*. The `!` in `main.tsx` is a TypeScript non-null assertion:
   `getElementById` is typed `HTMLElement | null`, and we assert the div is there
   because `index.html` guarantees it.
3. **Provider order is outermost-first and not arbitrary.** `BrowserRouter` must
   wrap `AuthProvider` because anything inside the provider may want to navigate;
   `AuthProvider` must wrap `App` because every page calls `useAuth()` — and that
   hook *throws* if no provider is above it (§7.2).

---

## 4. Layout and the CSS cascade contract

The layout is now the conventional Vite shape — everything under `src/`, entry files
included. The part that is *not* obvious, and that a newcomer will break, is how the
stylesheets relate.

### 4.1 One token vocabulary, three namespaces

| File | Namespace | Owns |
| --- | --- | --- |
| `src/index.css` | `ui-` | The ~34 design tokens, the CSS reset, and shared primitives (`ui-btn`, `ui-field`, `ui-slot`, `ui-label`) |
| `src/pages/landing.css` | `.ld-` | Landing page only |
| `src/components/authShell.css` | `.au-` | The login/register shell only |

**All ~34 design tokens live in `:root` in `index.css`. The page stylesheets define
zero custom properties** — verified: both `landing.css` and `authShell.css` declare
none. So there is exactly one place a colour, radius or type step is defined.

> **Never inline a colour.** If you need one that does not exist, add a token to
> `:root` in `index.css` and use it. A hex code in a page stylesheet is invisible to
> every other screen and to any future theming.

The per-page prefixes are what let three stylesheets share one global namespace
without colliding. `.au-panel` and `.ld-nav` cannot ever fight, because no two files
use the same prefix.

### 4.2 `index.css` must be imported before page CSS — this is load-bearing

`main.tsx` does this, and the order is deliberate:

```tsx
import "./index.css";   // FIRST
import App from "./App";
```

The reason is **specificity, not preference**. The shared `ui-` primitives and the
page rules are both single-class selectors, so they have *identical* specificity
(0,1,0). When specificity ties, CSS resolves the winner by **source order** — the
rule that appears later wins. Page stylesheets are imported by their components,
which are reached through `./App`, so importing `index.css` first is what puts the
primitives *earlier* in the sheet and lets a page override them.

Flip those two lines and page-level overrides silently stop working. Nothing errors;
the design just quietly reverts to the primitive's styling in a handful of places.

### 4.3 The Archivo `wdth` axis is load-bearing too

`index.html` loads Archivo with its **variable width axis**:

```
family=Archivo:wdth,wght@100..125,400..800
```

The stylesheets then use `font-stretch` at **112%, 115%, 116% and 118%** on headings
(six declarations across `index.css`, `landing.css` and `authShell.css`).

If the `wdth,` part of that URL is ever dropped — or the font fails to load and a
fallback takes over — those declarations become no-ops. Nothing errors and no
warning appears; the headlines simply render at normal width and the design
flattens. It is one of the least visible ways to break this UI.

---

## 5. Configuration

### 5.1 `frontend/package.json` scripts

| Script | Command | What it actually does |
| --- | --- | --- |
| `dev` | `vite` | Dev server on `http://localhost:3000` (port from `vite.config.js`). No bundling: each source file is served as a separate ES module and TSX is transpiled per-request by esbuild. HMR + React Fast Refresh, and the `/api → :5000` proxy. **Note: esbuild strips types without checking them** — `dev` will happily run code that `typecheck` rejects. |
| `build` | `tsc -b && vite build` | Type-checks the whole project *first* and fails the build on any type error, then produces the production bundle in `frontend/dist/`. The `&&` is the gate: a type error stops the build rather than shipping. |
| `typecheck` | `tsc -b --noEmit` | Types only, no output. What CI and pre-commit should run. |
| `lint` | `eslint . --max-warnings 0` | ESLint 10 flat config (§5.4). `--max-warnings 0` makes a warning fail the run, so warnings cannot accumulate. |
| `preview` | `vite preview` | Serves the already-built `dist/` over a local static server. A smoke test of the real production artifact — **not** a dev server: no HMR, no transform, **and no `/api` proxy**. |

> ### ⚠️ `tsc -b` is *build mode*, and it caches
>
> `-b` consults a `.tsbuildinfo` file and will exit 0 without re-checking anything
> if it believes the project is unchanged. A clean `typecheck` therefore means "no
> errors" *or* "did not look". When you need certainty — after a dependency bump,
> or before trusting a green run — use `tsc -b --force --noEmit`.

### 5.2 `"private": true`

Makes npm/pnpm **refuse to publish** this package. A stray `pnpm publish` here errors
out instead of pushing application source to the registry. It is also what lets a
workspace package skip the fields the registry would otherwise require.

### 5.3 The three `tsconfig` files

`tsconfig.json` is a **solution-style** config: `"files": []`, and two `references`.
It holds no source of its own; it exists so that `tsc -b` builds both real projects.

| File | Covers | Why it is separate |
| --- | --- | --- |
| `tsconfig.app.json` | `src/` | Browser code. `lib: ES2023 + DOM + DOM.Iterable`, `jsx: react-jsx`, `types: ["vite/client"]` for `import.meta.env`. |
| `tsconfig.node.json` | `vite.config.js` | Build tooling, which runs in Node and has no business seeing DOM types. |

Splitting them is what stops build tooling and browser code sharing a `lib`/`types`
surface they should not share — e.g. it prevents `document` type-checking inside
`vite.config.js`.

Settings in `tsconfig.app.json` worth knowing:

- **`"strict": true`** — deliberately on, and the donor repo had it off. New code
  should not accumulate implicit-`any` debt from day one.
- **`noUnusedLocals` / `noUnusedParameters`** — dead bindings are a type error here,
  not a lint warning.
- **`moduleResolution: "bundler"`** + `verbatimModuleSyntax` — matches how Vite
  actually resolves; `verbatimModuleSyntax` is why type-only imports must be written
  `import type { X }`.
- **`tsBuildInfoFile`** points inside `node_modules/.tmp/`, which is why the build
  cache never shows up in `git status`.

### 5.4 ESLint 10 flat config

`frontend/eslint.config.js`. **Flat config replaced `.eslintrc`**: there is no `env`,
no `extends:` string, and no cascading lookup up the directory tree. That one file is
the entire configuration, and config objects apply in array order — later wins.

What it composes:

| Source | Provides |
| --- | --- |
| `@eslint/js` `recommended` | Core JS correctness — `no-unreachable`, `no-dupe-keys`, and friends |
| `typescript-eslint` `recommended` | TS rules + the TS parser. **Non-type-checked on purpose** — the type-aware preset needs a full TS Program per run, and `typecheck` already covers what it would add |
| `eslint-plugin-react-hooks` v7 | 16 rules: `rules-of-hooks`, `exhaustive-deps`, plus the React Compiler set (`purity`, `immutability`, `set-state-in-effect`, `refs`) |
| `eslint-plugin-react-refresh` | Fast Refresh boundary warnings |
| `globals.browser` | Flat config has no `env: { browser: true }` — globals are explicit now |

Two deliberate choices recorded here so they are not "fixed" later:

1. **`react-refresh/only-export-components` is switched off for `src/lib/**` only.**
   `lib/auth.tsx` exports both `AuthProvider` (a component) and `useAuth` (a hook),
   which is the standard React context shape. Fast Refresh genuinely degrades for
   such a file — splitting them would be worse code for a dev-only convenience, so
   the rule is scoped off rather than the file reshaped. The rule stays **on**
   everywhere else.
2. **No `eslint-plugin-react`.** Under the automatic JSX runtime (`jsx: react-jsx`)
   its scope rules are obsolete, and the rest duplicates what TypeScript catches.

`dist`, `node_modules`, `eslint.config.js` and `vite.config.js` are ignored.

---

## 6. Annotated walkthrough — the entry points

### 6.1 `src/main.tsx`

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";        // before ./App — see §4.2
import App from "./App";
import { AuthProvider } from "./lib/auth";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
```

- `react-dom/client` is the React 18+ subpath exporting `createRoot`. Importing from
  here rather than plain `react-dom` is what opts into the concurrent renderer.
- The returned root object is discarded, which is normal for an app that never
  unmounts. Keeping it would allow a later `root.unmount()`.

**`<StrictMode>` is development-only.** It renders no DOM and is removed entirely
from the production build. In dev it deliberately double-invokes anything that must
be pure: component bodies, state initialisers, and every `useEffect`
(mount → cleanup → mount). That double-mount is not a curiosity here — it is the
reason `AuthProvider` needs the guard described in §7.2.

### 6.2 `src/App.tsx`

```tsx
<ScrollToTop />
<Routes>
  <Route path="/"         element={<Landing />} />
  <Route path="/login"    element={<Login />} />
  <Route path="/register" element={<Register />} />
  <Route path="*"         element={<Navigate to="/" replace />} />
</Routes>
```

- **`ScrollToTop`** is a component that renders `null`. It reads `useLocation()` and
  runs `window.scrollTo(0, 0)` in an effect keyed on `pathname`. Without it, a
  client-side route change keeps the previous scroll position — you navigate from
  the bottom of the landing page to `/login` and arrive halfway down the form.
- **The catch-all matters.** `path="*"` sends any unknown URL home. Without it an
  unmatched route renders *nothing* — a blank white page with no error, which reads
  as "the app is broken" rather than "that URL does not exist".
- **`replace`** means the bad URL does not enter history, so Back does not bounce the
  user straight into the same dead route.
- There is **no `ErrorBoundary`** yet. The donor repo wraps the routes in one keyed
  on `pathname`; a `// TODO` marks the spot. Until it exists, a render-time throw in
  any page blanks the whole app.

### 6.3 `frontend/vite.config.js`

**`defineConfig`** is an identity function at runtime — it returns the object you
pass, unchanged. Its only value is typing, so editors autocomplete and flag typos.
Without it, `serverr: {...}` would be silently ignored.

**`plugins: [react()]`** does two jobs: the **JSX/TSX transform** (routing `.tsx`
through esbuild so `<App />` compiles to a `jsx(App)` call), and **Fast Refresh**,
which hot-swaps an edited component while preserving its `useState` values — so a
half-typed email and the `touched` map in `Login.tsx` survive a save.

**`envDir: '../'`** points Vite at the **repository root** for `.env`, so frontend and
backend share one file. The backend does the same from its side. Same file, two
consumers, no drift.

> **The `VITE_` prefix rule.** Vite injects **only** `VITE_*` variables into client
> code. Everything else in that shared `.env` — the database URI, `JWT_SECRET`, API
> keys — is filtered out and never reaches the browser. The reason is that the
> **frontend bundle is public**: anything inlined into it is readable via View Source,
> and minification is not obfuscation. The prefix is an explicit opt-in meaning "I
> accept that this value is public". Corollary: **never name a secret
> `VITE_SOMETHING`.** That single rename publishes it to every visitor — and it
> matters more than usual here precisely *because* `envDir` points at a shared file
> that also holds backend secrets.

**`server.port: 3000`** overrides Vite's default `5173`, keeping frontend (`3000`) and
backend (`5000`) cleanly separated.

**The `/api` dev proxy:**

```js
proxy: { '/api': { target: 'http://localhost:5000', changeOrigin: true } }
```

```
  browser                    Vite dev server              Express
  (origin :3000)             (:3000)                      (:5000)
      │ fetch('/api/health')     │                            │
      ├─────────────────────────►│  path starts with /api     │
      │                          ├───────────────────────────►│ GET /api/health
      │                          │  (server-to-server, Node)  │
      │◄─────────────────────────┤◄───────────────────────────┤ 200 {"status":"ok"}
   the browser only ever saw ONE origin: http://localhost:3000
```

- `'/api'` is a **prefix match** with no `rewrite`, so the path forwards unchanged —
  correct, because Express registers `/api/health` with the prefix included.
- **This is also why `src/lib/api.ts` can default `API_BASE` to `""`.** Relative
  paths are same-origin, and the proxy makes same-origin reach the backend.
- **Why there is no CORS in dev:** the browser only ever talks to `localhost:3000`.
  No cross-origin request is made, so there is no preflight and no
  `Access-Control-Allow-Origin` check. The Vite→Express hop happens in Node, and the
  same-origin policy is a *browser* rule, not a network rule.
- `changeOrigin: true` rewrites the outgoing **`Host`** header to the target's host.
  Locally that changes nothing, but it is what makes the proxy work against
  virtual-hosted targets — a platform backend that routes by `Host`, or an HTTPS API
  that checks SNI. Leaving it off is a classic source of mystery 404s.

> ### ⚠️ The proxy is DEVELOPMENT-ONLY
>
> `vite build` emits static files into `dist/`. There is no Vite server left to proxy
> anything, and `vite preview` does **not** apply this config either. In production a
> relative `fetch('/api/auth/login')` hits whatever static host serves `dist/` and 404s.
>
> Production needs one of:
> 1. **A real reverse proxy** mapping `/api → the Node service`. Keeps a single
>    origin, so still no CORS, and the HTTP-only refresh cookie stays first-party.
>    Recommended.
> 2. **An absolute API base URL** baked in at build time via `VITE_API_BASE_URL`
>    (which `api.ts` already reads). This makes requests cross-origin, so the
>    backend's `cors()` must then name an explicit origin **with
>    `credentials: true`** — bare `cors()` sends `*`, which browsers reject outright
>    for credentialed requests. See §8.

---

## 7. The auth layer

This is the part of the frontend with real behaviour in it, and the part where the
non-obvious decisions live.

### 7.1 `src/lib/api.ts` — the fetch wrapper

**`ApiError` and `NetworkError` are runtime `class`es, not type aliases.** That
distinction is load-bearing: the pages branch with `instanceof` and read `.status`.
Replace them with types or with string matching and the error UX silently dies —
every failure collapses into one generic message.

| Class | Means | Carries |
| --- | --- | --- |
| `ApiError` | The server answered, and said no | `.status` (number) + the server's message |
| `NetworkError` | The server never answered — not deployed, offline, CORS, DNS | message only |

The status codes the UI actually branches on:

| Status | Where | Behaviour |
| --- | --- | --- |
| **401** | `Login.tsx` | "That email and password don't match." |
| **409** | `Register.tsx` | Sets a field error on *email* — "An account already uses this email." — and focuses it |
| *network* | both | Navigates onward anyway, so the UI stays walkable with no API |

**The access token is held in a module-level variable**, not React state and never
`localStorage`:

```ts
let accessToken: string | null = null;
```

This is deliberate and matches the auth contract. Anything readable by script is
readable by *injected* script, so an XSS bug would hand over a `localStorage` token
immediately. In memory, the token dies with the tab. It lives in a module rather
than state because these are plain async functions, not hooks — `auth.tsx` calls
`setAccessToken()` whenever an auth response resolves.

**Every request sends `credentials: "include"`.** Without it the browser will not
attach the HTTP-only refresh cookie, and `refreshSession()` can never work.

`API_BASE` defaults to `""` — see §6.3 for why an empty base is the correct default.

`googleAuthorizeUrl()` returns `${API_BASE}/api/auth/google`. It carries a `TODO`:
the route does not exist on the Node backend, and the path was chosen only because
the Spring convention the donor used (`/oauth2/authorization/google`) has no meaning
in Express.

### 7.2 `src/lib/auth.tsx` — session context

Exports exactly two runtime values: **`AuthProvider`** and **`useAuth()`**. The
context object itself is deliberately *not* exported, so there is one supported way
to read auth state.

```ts
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used inside <AuthProvider>.");
  return ctx;
}
```

That throw is why provider order in `main.tsx` is not negotiable (§3).

> #### The `useRef` guard — do not remove it
>
> ```ts
> const started = useRef(false);
> useEffect(() => {
>   if (started.current) return;
>   started.current = true;
>   refreshSession() /* … */
> }, []);
> ```
>
> The refresh cookie is **single-use and rotates on every call**. StrictMode's
> dev-only mount → cleanup → mount runs this effect **twice**, and two concurrent
> `refreshSession()` calls would have the second invalidate the cookie the first
> just rotated in.
>
> A plain `cancelled` boolean is **not** enough. That pattern only decides which
> *response* to keep — both requests still go out, and here it can end up keeping
> the failed one. The ref makes the network call itself fire exactly once per real
> mount.
>
> Delete it and you get an intermittent, dev-only logout that is miserable to debug.

### 7.3 `src/lib/validate.ts` — client-side validation

Exports `LIMITS` (`as const`), the four validators, `anyInvalid`, and the
`FieldError` type. The limits — email ≤ 255, password 8–100, full name ≤ 120 —
mirror the API's intended validation so the two cannot disagree.

Note `validateExistingPassword` (login) deliberately has **no minimum**, while
`validateNewPassword` (register) enforces 8. Applying today's minimum at login would
lock out any account whose password predates it.

The server stays the authority; this only spares the user a round trip.

### 7.4 `Login.tsx` and `Register.tsx` — structural twins

Both follow an identical shape, which is worth learning once:

| Piece | Role |
| --- | --- |
| module-level `check(values)` | Pure function returning an errors object. Outside the component so it is not re-created per render. |
| `values` / `errors` / `touched` | Field values, per-field messages, and which fields the user has left |
| `formError` / `pending` | Form-level error banner, and submit-in-flight |
| `edit(field)` / `leave(field)` | onChange / onBlur handler factories |
| input refs | So submit can focus the first invalid field |

**The `touched` behaviour is deliberate UX, not an accident.** `edit()` only
re-validates a field **if it has already been blurred once**:

```ts
if (touched[field]) setErrors(prev => ({ ...prev, [field]: check(updated)[field] }));
```

Without that check, the first keystroke of an email address gets shouted at as
invalid. Preserve it.

**Both navigate onward even on `NetworkError`**, so the app stays walkable while the
backend is unimplemented. Both currently target `"/"` with a `// TODO` to point at
`/dashboard` once that route exists.

`Landing.tsx` does **not** use the auth layer at all — it imports only `Brand` and
`Icons`. Only `Login` and `Register` call `useAuth()`.

---

## 8. Known issues in the frontend

Ordered roughly by severity. The `.jsx`-era issues (uncontrolled inputs, the
`isLogin` toggle, the inline `Illustration`, the monochrome Google logo) are gone
with the files that held them.

| # | Issue | Location | Detail |
| --- | --- | --- | --- |
| 1 | **No tests, no test runner** | all packages | No `test` script in any `package.json`. `validate.ts` is pure and total — the cheapest possible first test suite, and nothing covers it. |
| 2 | **`cors()` is wide open and incompatible with the cookie** | `backend/src/server.js` | Bare `cors()` sends `Access-Control-Allow-Origin: *`. Browsers **reject** `*` for credentialed requests, and every call here sends `credentials: "include"`. Harmless while the dev proxy makes everything same-origin; it breaks the moment the API is on another origin. Needs an explicit origin + `credentials: true`. |
| 3 | **Vite proxy target ignores `PORT`** | `vite.config.js:118` | Hardcoded `http://localhost:5000` while the backend reads `process.env.PORT \|\| 5000`. Set `PORT=8080` and every `/api` call returns `ECONNREFUSED` with no obvious cause. Fix is `loadEnv(mode, '../', '')`. |
| 4 | **No `ErrorBoundary`** | `App.tsx` | A render-time throw in any page blanks the entire app. The donor repo has one keyed on `pathname`; a `// TODO` marks the spot. |
| 5 | **Focus ring vanishes in forced-colors mode** | `index.css:470` | `index.css` *does* ship a global `:focus-visible` ring, and `.ui-field__input:focus` replaces its `outline: none` with a visible 3px `box-shadow` ring — so keyboard focus is indicated. But `box-shadow` is discarded in Windows High Contrast / `forced-colors` mode while `outline` survives, so inputs lose the indicator there. Needs a `@media (forced-colors: active)` block. |
| 6 | **Most icons are not marked decorative** | `Icons.tsx` | `Brand.tsx` sets `aria-hidden="true"` + `focusable="false"` on its mark, and 3 icons in `Icons.tsx` do the same — but the file exports ~28. The rest are announced by screen readers as unnamed graphics. Every icon here is decorative (its control always carries visible text), so they should all be `aria-hidden`. |
| 7 | **Dead placeholder link** | `Login.tsx` | `<a href="#reset">Forgot it?</a>` navigates to the top of the page. A control that does nothing yet is not a hyperlink — use a `<button>` styled as one, or point it at a real `/forgot-password` route. |
| 8 | **Divergent narrow breakpoints** | `landing.css` 560px, `authShell.css` 520px | The same "narrow phone" case implemented at two different widths, while 900px and 720px are shared — almost certainly accidental drift. Harmless today (the files style disjoint pages); worth unifying before a third stylesheet exists. |
| 9 | **`dev` does not type-check** | `package.json` | esbuild strips types without checking them, so `pnpm dev` runs code that `pnpm typecheck` would reject. Run `typecheck` before trusting a green dev server. |

> **`TextField` already does the right thing** on the accessibility items that used
> to be listed here: it pairs `htmlFor`/`id`, sets `aria-invalid`, and wires
> `aria-describedby` to either the hint or the error. The old A2 finding is closed.

---

## 9. How to run it

From the **repository root**:

```bash
pnpm dev:frontend    # Vite dev server on http://localhost:3000
pnpm dev:backend     # Express on http://localhost:5000
pnpm dev             # both at once (concurrently)
```

Then open **<http://localhost:3000>**. You should see the landing page; `/login` and
`/register` render the two-panel auth shell — a dark spruce marketing panel beside a
white form card, which collapses to a single column at 900px **with the form on top**
(`.au-main { order: -1 }`).

Quality gates, also from the root:

```bash
pnpm --filter 1on1-frontend run typecheck   # tsc -b --noEmit
pnpm --filter 1on1-frontend run lint        # eslint . --max-warnings 0
pnpm --filter 1on1-frontend run build       # tsc -b && vite build  → frontend/dist/
pnpm --filter 1on1-frontend run preview     # serve dist/ locally
```

> `preinstall` runs `only-allow pnpm` — npm and yarn are blocked. Use pnpm.

### Verifying the proxy

With **both** servers running, open devtools on `http://localhost:3000`:

```js
await (await fetch('/api/health')).json()
// → { status: 'ok', ... }
```

Note what did *not* happen: **no CORS error, no preflight**. The browser only
contacted `localhost:3000`; Vite forwarded to `localhost:5000` from Node.

`/api/health` is the **only** endpoint that answers today. The auth calls in
`lib/api.ts` will take the `NetworkError` path, which is exactly what keeps the UI
walkable.

Remember: `preview` has **no `/api` proxy**, so any relative API call that worked
under `dev` will 404 under `preview` and in production until a reverse proxy or an
absolute `VITE_API_BASE_URL` is in place (§6.3).

---

## 10. Dependencies

Not duplicated here. See **[`06-dependencies.md`](./06-dependencies.md)** for the
package-by-package breakdown.

---

## Related documents

| Document | Covers |
| --- | --- |
| `CLAUDE.md` (repo root) | The decided stack, auth contract and frontend conventions |
| `docs/01-product-requirements.md` | What the product is meant to become |
| `docs/02-technology-stack.md` | Chosen stack and engineering plan |
| `docs/03-system-design.md` | System architecture |
| `docs/code/04-frontend.md` | **this file** — the frontend as it exists in code |
| `docs/code/05-styles.md` | ⚠️ Still documents the deleted `login.css`. Needs the same re-derivation this file just had. |
| `docs/code/06-dependencies.md` | Dependency deep-dive |
| `docs/code/08-gaps-and-findings.md` | Open/closed findings across the repo |
| `docs/code/09-stack-correction-2026-09-05.md` | The migration record |
