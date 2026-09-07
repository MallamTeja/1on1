# 08 — Gaps, Bugs and Findings

> Every item below was verified against the working tree, not inferred.
> Nothing here has been auto-fixed — this document records the **current** state
> so you can decide what to change. Where a fix is obvious, it is shown as a
> suggestion in a fenced block, not applied.

**Original audit:** 2026-09-04 · commit `f856a01` · branch `main`
**Re-audited:** 2026-09-06 against the working tree, after the TypeScript port was
mounted, the dead `.jsx` files were deleted, and the ESLint / `.gitignore` work landed.

Findings are **not deleted when they close.** A gaps document with history tells you
what a fix actually changed; one that quietly drops resolved items just looks like it
was never broken. Each finding below carries a status:

| Status | Meaning |
|---|---|
| ✅ **CLOSED** | Fixed. The note records what closed it. |
| 🔓 **STILL OPEN** | Verified still present on 2026-09-06. |
| ⤵️ **SUPERSEDED** | The code it described no longer exists, so the finding is moot rather than fixed. |

---

## Severity key

| | Meaning |
|---|---|
| 🔴 **Broken** | Does not work today. Will fail if you run it. |
| 🟠 **Bug** | Works, but produces a wrong result. |
| 🟡 **Risk** | Works now, will bite you later. |
| 🔵 **Gap** | Not implemented yet. Expected at this stage — listed so it is tracked. |

---

## 1. 🔴 Broken — things that fail right now

### 1.1 ✅ CLOSED — `pnpm lint` cannot run, no ESLint config exists

> **Closed 2026-09-06.** `frontend/eslint.config.js` now exists — **ESLint 10 flat
> config**, not the `.eslintrc.cjs` suggested below. That suggestion was correct for
> the ESLint 8 pinned at audit time, but by 2026-09-06 `eslint@latest` is **10.10.0**
> and both 8 and 9 are off support (9.39.5 is `maintenance`, and pnpm prints a
> deprecation warning for it). Writing `.eslintrc` would have adopted a
> two-generations-stale format on day one. The script is now
> `eslint . --max-warnings 0` — `--ext` was removed in ESLint 9+, and flat config
> does its own file discovery — and it passes clean across all 14 source files.
> Composition and the one scoped rule relaxation are documented in
> [`04-frontend.md` §5.4](04-frontend.md).
>
> *The original finding and its ESLint 8 suggestion are kept below as written.*

`frontend/package.json` declares:

```json
"lint": "eslint . --ext js,jsx --report-unused-disable-directives --max-warnings 0"
```

and installs `eslint@^8.55.0` plus three plugins. But a filesystem search found
**no `.eslintrc*` and no `eslint.config.*`** anywhere in the repo:

```console
$ ls -a | grep -i eslint          # root      -> nothing
$ ls -a frontend/ | grep -i eslint # frontend -> nothing
```

ESLint 8 without a config file exits with `No ESLint configuration found`. The
four ESLint packages are currently dead weight.

**Suggested fix** — ESLint 8 uses the legacy `.eslintrc.cjs` format:

```js
// frontend/.eslintrc.cjs   (NOT created — suggestion only)
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: 'detect' } },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    'react/react-in-jsx-scope': 'off',
  },
  ignorePatterns: ['dist', '.eslintrc.cjs'],
}
```

> Note the version trap: ESLint **9** requires flat config (`eslint.config.js`) and
> would reject the file above. This repo pins `^8.55.0`, so `.eslintrc.cjs` is correct.

---

### 1.2 🔓 STILL OPEN — Dependabot is misconfigured and will never open a PR

> **Re-verified 2026-09-06:** `.github/dependabot.yml:39` still reads
> `package-ecosystem: ""` and `:46` still `directory: "/"`. Unchanged.

[`.github/dependabot.yml`](../../.github/dependabot.yml) contains:

```yaml
  - package-ecosystem: "" # See documentation for possible values
```

An **empty string is not a valid ecosystem**. GitHub validates this file on push;
as written, Dependabot reports a config error and opens zero update PRs. The file
is unmodified `npm init`-style boilerplate — the placeholder was never filled in.

There is a second, subtler problem: `directory: "/"` points at the root
`package.json` only. This is a **workspace with three manifests**, so
`frontend/` and `backend/` dependencies would go unwatched even after the
ecosystem is fixed.

Full corrected config is in [`07-ci-and-security.md`](07-ci-and-security.md).

---

### 1.3 🔓 STILL OPEN — No `.env` file exists, and nothing tells you that

> **Re-verified 2026-09-06:** still no `.env` at the repo root, and still no
> `.env.example`. The backend now also reads `JWT_ACCESS_SECRET`; with no `.env` it
> generates a random one per process and warns that tokens are invalidated on every
> restart. That raises this from cosmetic to genuinely confusing.

Confirmed: no `.env` at the repo root. `.gitignore` correctly excludes it, so a
fresh clone will never have one. Consequences:

- `dotenv.config()` in [backend/src/server.js:10](../../backend/src/server.js#L10)
  silently does nothing — dotenv does **not** throw on a missing file.
- `process.env.PORT` is `undefined`, so the `|| 5000` fallback kicks in and the
  backend still starts. It works *by accident*, not by design.
- The moment a real secret is added (the AWS database URI, JWT secret, Gemini key), a fresh
  clone breaks with a confusing runtime error rather than a clear one.

**Suggested fix:** commit a `.env.example` (see [`02-root-config.md`](02-root-config.md))
and add a fail-fast check:

```js
// suggestion only — not applied
const required = ['PORT'];
for (const k of required) {
  if (!process.env[k]) throw new Error(`Missing required env var: ${k}. Copy .env.example to .env`);
}
```

---

## 2. 🟠 Bugs — code that runs but is wrong

### 2.1 ⤵️ SUPERSEDED — The Google logo renders entirely in red

> **Superseded 2026-09-06.** `frontend/src/pages/login.jsx` was deleted. The Google
> mark now comes from `IconGoogle` in `frontend/src/components/Icons.tsx`, a
> different implementation — so this finding does not apply to it, and was never
> fixed in the old file. *Kept for history.*

[frontend/src/pages/login.jsx:146-151](../../frontend/src/pages/login.jsx#L146-L151) —
all **four** `<path>` elements of the Google mark are `fill="#EA4335"`:

```jsx
<path d="M22.56 12.25c…" fill="#EA4335"/>   {/* should be #4285F4 blue  */}
<path d="M12 23c2.97…"   fill="#EA4335"/>   {/* should be #34A853 green */}
<path d="M5.84 14.09c…"  fill="#EA4335"/>   {/* should be #FBBC05 yellow*/}
<path d="M12 5.38c1.62…" fill="#EA4335"/>   {/* correct: red            */}
```

The Google brand mark is four-coloured. Rendering it monochrome-red is both
visually wrong and a brand-guideline violation. Only the last path's colour is
right. **Not fixed** — the correct hexes are noted inline in the source comments.

---

### 2.2 ⤵️ SUPERSEDED — `Illustration` defined inside `Login`, subtree remounts

> **Superseded 2026-09-06.** The file that held it was deleted. The pattern is still
> worth knowing — a component defined inside another gets a new identity every
> render, so React unmounts and remounts the whole subtree — which is why the
> explanation is kept. `eslint-plugin-react-hooks` v7's `static-components` rule now
> catches this class automatically. *Kept for history.*

[frontend/src/pages/login.jsx:11](../../frontend/src/pages/login.jsx#L11):

```jsx
export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const Illustration = () => ( /* ~70 lines of SVG */ );   // ← re-created every render
```

Every time `Login` re-renders (any click on the eye toggle or the mode switch),
`Illustration` is a **brand-new function identity**. React compares element types
by reference, sees a different type, and **unmounts the entire SVG subtree and
remounts it** instead of updating it. Today the SVG is static so you only pay the
cost; the moment it holds state or an animation, that state resets on every keystroke.

**Correct pattern** — hoist to module scope:

```jsx
// module scope, outside Login
const Illustration = () => ( /* … */ );

export default function Login() { /* … */ }
```

**Not applied** — flagged in a source comment.

---

### 2.3 🔓 STILL OPEN — The Vite proxy target ignores `PORT`

> **Re-verified 2026-09-06:** `frontend/vite.config.js:118` still hardcodes
> `http://localhost:5000`. The suggested `loadEnv` fix below is still the right one.

[frontend/vite.config.js](../../frontend/vite.config.js) hardcodes:

```js
proxy: { '/api': { target: 'http://localhost:5000', changeOrigin: true } }
```

while the backend reads `process.env.PORT || 5000`. Set `PORT=8080` in `.env` and
the backend moves to 8080 while the proxy keeps forwarding to 5000 — every `/api`
call returns `ECONNREFUSED`, with no obvious cause.

**Suggested fix** — read the same env var Vite already loads via `envDir: '../'`:

```js
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../', '');           // '' = load non-VITE_ vars too
  const apiPort = env.PORT || 5000;
  return {
    envDir: '../',
    plugins: [react()],
    server: {
      port: 3000,
      proxy: { '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true } },
    },
  };
});
```

---

## 3. 🔵 Gaps — not built yet

### 3.1 ✅ CLOSED — The login form sends nothing, anywhere

> **Closed 2026-09-06.** `frontend/src/pages/Login.tsx` and `Register.tsx` have
> controlled inputs, per-field validation via `src/lib/validate.ts`, touched/error
> state, a `pending` submit lock, and real calls through `src/lib/api.ts` to
> `POST /api/auth/{login,register}` followed by `refreshSession()`.
> **The server does not answer them yet** — see 3.4 — so submissions take the
> `NetworkError` path by design, which is what keeps the UI walkable.
>
> *The original table below describes the deleted `login.jsx` mock.*

This is the largest gap in the frontend. In
[login.jsx](../../frontend/src/pages/login.jsx):

| Expected | Present? |
|---|---|
| `value` / `onChange` on inputs | ❌ inputs are **uncontrolled**; React never sees what you type |
| State for email / password / name | ❌ only `isLogin` and `showPassword` exist |
| `fetch()` or axios call | ❌ zero network calls in the entire frontend |
| Submit handler | ⚠ `onSubmit={(e) => e.preventDefault()}` — cancels the browser POST and does nothing else |
| Validation | ❌ none (the "at least 8+ characters" placeholder is not enforced) |
| Loading / error UI | ❌ none |

The screen is a **visual mock**. Clicking "Sign in" is a no-op.

### 3.2 ✅ CLOSED — Two empty page files

> **Closed 2026-09-06.** Both 0-byte files were deleted, along with `login.jsx`,
> `login.css`, `main.jsx` and `app.jsx`. Real `Landing.tsx` and `Register.tsx` pages
> replaced them, each on its own route.

```console
frontend/src/pages/landingpage.jsx   0 bytes
frontend/src/pages/register.jsx      0 bytes
```

Both are 0 bytes. An empty `.jsx` file is valid JavaScript but exports nothing —
importing it yields `undefined`, and rendering `<undefined />` throws. Nothing
imports them today, so they are inert. Note that **register is already handled**
by `login.jsx`'s `isLogin === false` branch, so `register.jsx` may be redundant
by design rather than unfinished.

### 3.3 ✅ CLOSED — No router

[app.jsx](../../frontend/app.jsx) renders `<Login />` unconditionally. With
`landingpage.jsx` waiting to be filled in there is no way to navigate anywhere.

**Update 2026-09-05:** `react-router-dom@^7.9.1` **is** now in
`frontend/package.json`, and `Landing.tsx` / `Login.tsx` / `Register.tsx` exist.
The routing is still not wired, though: `frontend/index.html` continues to load
`/main.jsx`, so `app.jsx` remains the live root and no `<BrowserRouter>` is
mounted. The dependency is there; the wiring is not.

> **Closed 2026-09-06.** The wiring landed. `frontend/index.html` now loads
> `/src/main.tsx`, which renders `StrictMode > BrowserRouter > AuthProvider > App`.
> `src/App.tsx` routes `/`, `/login`, `/register` and a `*` catch-all that redirects
> home. `app.jsx` and `main.jsx` were deleted. Verified: all three routes return 200
> from the dev server, and the production build succeeds.

### 3.4 🔓 STILL OPEN (in progress) — The backend has one route and no architecture

> **Re-verified 2026-09-06, and changing under active development.**
> `backend/src/server.js` still registers exactly one reachable route,
> `GET /api/health`. New files have appeared — `routes/auth.js`,
> `routes/googleAuth.js`, `lib/{tokens,passwords,session,validation,httpError}.js`,
> `middleware/{requireAuth,errorHandler}.js`, `repositories/userRepository.js` — and
> `server.js` imports `authRouter`, `googleAuthRouter` and the error handlers, but
> **does not yet mount any of them**, so none of those routes is reachable. At the
> moment of this audit the module also failed to import
> (`fileURLToPath is not defined`), i.e. the backend would not start.
>
> This is a snapshot of a tree being written concurrently, not a defect report — it
> may well be resolved by the time you read it. It is recorded only so nobody reads
> [`04-frontend.md` §7](04-frontend.md) and assumes the auth endpoints answer.

[server.js](../../backend/src/server.js) is 23 lines. Missing, in the order you
will need them:

| Layer | Status |
|---|---|
| Router modules (`routes/`) | ❌ routes are inline in `server.js` |
| Controllers | ❌ |
| Models / schemas | ❌ no database at all |
| Auth middleware (JWT) | ❌ |
| Request validation (zod / joi) | ❌ |
| Centralised error handler | ❌ an unhandled throw crashes the process |
| 404 handler | ❌ unknown routes return Express's default HTML page |
| Structured logging | ❌ one `console.log` |
| Graceful shutdown (SIGTERM) | ❌ |
| Tests | ❌ no test runner in any package.json |

---

## 4. 🟡 Accessibility findings

All in [login.jsx](../../frontend/src/pages/login.jsx) and
[login.css](../../frontend/src/pages/login.css):

| # | Finding | Where | Impact |
|---|---|---|---|
| A1 | `outline: none` on `.input-field` | [login.css:87](../../frontend/src/pages/login.css#L87) | Keyboard users lose the focus ring. Partly compensated by the `:focus` border+background change, but `:focus-visible` with a real ring is the correct fix. |
| A2 | Labels not associated with inputs | login.jsx `.input-label` | No `htmlFor` / `id` pair. Clicking the label does not focus the field; screen readers do not announce it. |
| A3 | Password toggle has no accessible name | [login.jsx:114](../../frontend/src/pages/login.jsx#L114) | Icon-only button announces as "button". Needs `aria-label="Show password"` and `aria-pressed`. |
| A4 | Google button has no accessible name | [login.jsx:145](../../frontend/src/pages/login.jsx#L145) | Same problem. |
| A5 | Dead link | [login.jsx:135](../../frontend/src/pages/login.jsx#L135) | `href="#"` on "Forgot password?" jumps to top of page. |
| A6 | Decorative SVG not hidden | login.jsx `Illustration` | Should carry `aria-hidden="true"` so assistive tech skips it. |
| A7 | No `prefers-reduced-motion` guard | login.css transitions | Minor here (0.2s), matters once real animation lands. |

### Re-audit 2026-09-06

Every row above pointed at `login.jsx` / `login.css`, which were deleted. Re-checked
against the current `frontend/src/`:

| # | Status | Now |
|---|---|---|
| A1 | ✅ **CLOSED** (narrow residual) | **Corrected 2026-09-06 — this row previously said STILL OPEN, which was wrong.** `index.css:134` ships a global `:focus-visible { outline: 2px solid var(--spruce); outline-offset: 2px }`, and the one remaining `outline: none` (`:470`, on `.ui-field__input:focus`) immediately substitutes a visible `box-shadow: 0 0 0 3px var(--spruce-tint)` ring. Users do not lose the focus indicator, so the finding as written no longer holds. The narrow residual: `box-shadow` is discarded in `forced-colors` / Windows High Contrast mode while `outline` survives, so inputs lose their ring *there*. Tracked as [`05-styles.md` §8 row 2](05-styles.md). |
| A2 | ✅ **CLOSED** | `components/TextField.tsx` pairs `htmlFor={id}` with the input's `id`, and adds `aria-invalid` plus `aria-describedby` wired to either the hint or the error message. Both auth forms use it, so every field is labelled. |
| A3 | ⤵️ **SUPERSEDED** | There is no password-visibility toggle in the ported UI. |
| A4 | ✅ **CLOSED** | The Google button in `components/AuthShell.tsx` renders visible text — "Continue with Google" — beside its icon, so it has an accessible name from its content. No `aria-label` needed. |
| A5 | 🔓 **STILL OPEN** | The dead link survived the port: `pages/Login.tsx` renders `<a href="#reset">Forgot it?</a>` as a placeholder, with a `TODO` for a real `/forgot-password` route. |
| A6 | 🔓 **STILL OPEN** | `components/Brand.tsx` correctly marks its mark `aria-hidden="true"` + `focusable="false"`, and 3 icons in `Icons.tsx` do the same — but that file exports ~28. Every icon here is decorative, so they should all be hidden from assistive tech. |
| A7 | ✅ **CLOSED** | **Corrected 2026-09-06 — this row previously said STILL OPEN, which was wrong.** `index.css:557` ships the standard universal guard: `@media (prefers-reduced-motion: reduce)` clamping `animation-duration`, `animation-iteration-count` and `transition-duration` to `0.01ms !important` across `*, *::before, *::after`. Because it is universal it covers the page stylesheets too, which is why they correctly do not repeat it. |

**Net: 4 closed, 1 superseded, 2 still open** (A5 the placeholder link, A6 the
unmarked icons).

> **Correction, same day.** A1 and A7 were first recorded as STILL OPEN in this
> pass and are now CLOSED. Both were wrong for the same reason: the a11y sweep
> searched the *component* files for the fixes and did not read `index.css`, where
> both actually live — the `:focus-visible` ring at `:134` and the reduced-motion
> guard at `:557`. The lesson is specific: in a system where one file holds the
> reset and the shared primitives, "absent from the components" is not the same
> claim as "absent". Each corrected row states what it previously said, so the
> wrong call stays visible rather than being quietly overwritten.

---

## 5. 🟡 Structural / convention findings

### 5.1 ✅ CLOSED — Entry files sit outside `src/`

> **Closed 2026-09-06.** `main.jsx` and `app.jsx` were deleted; their replacements
> are `src/main.tsx` and `src/App.tsx`. Everything now lives under `src/`, which is
> the conventional Vite layout this finding asked for.

```text
frontend/
├── main.jsx        ← at package root
├── app.jsx         ← at package root
└── src/pages/      ← everything else
```

This **works** — Vite resolves from `index.html`, and `app.jsx` imports
`./src/pages/login.jsx` correctly. But it is inconsistent: half the source is in
`src/`, half is not. The conventional Vite layout puts everything under `src/`:

```text
frontend/
├── index.html
└── src/
    ├── main.jsx
    ├── App.jsx
    └── pages/
```

Cosmetic today, annoying at 50 files.

### 5.2 ⤵️ SUPERSEDED — CSS is global, not scoped

> **Superseded 2026-09-06.** `login.css` — with its bare `*` and `body` rules and
> generic class names — was deleted. The CSS is still deliberately **global rather
> than CSS Modules**, but it is no longer unscoped: each stylesheet owns a prefix
> (`ui-` shared primitives, `.ld-` landing, `.au-` auth shell), and all ~34 design
> tokens live in one `:root` block in `src/index.css` with the page stylesheets
> defining **zero**. Collisions are prevented by naming convention rather than by
> tooling. The one real constraint that creates is documented in
> [`04-frontend.md` §4.2](04-frontend.md): `index.css` must be imported before any
> page CSS, because equal specificity makes source order decide the winner.

`import './login.css'` makes Vite inject it as a plain `<style>` tag. The rules
`*` and `body` therefore apply **application-wide**, and generic class names
(`.input-field`, `.submit-btn`, `.divider`) sit in one flat namespace. The second
page that imports its own CSS will collide. See [`05-styles.md`](05-styles.md) for
the CSS Modules / custom-properties migration path.

### 5.3 🔓 STILL OPEN — `main: "index.js"` in the root package.json points at nothing

> **Re-verified 2026-09-06:** `package.json:5` still declares it; there is still no
> `index.js`. Harmless, still boilerplate.

There is no `index.js` at the repo root. Harmless — the root package is only ever
a script runner, never imported — but it is leftover `npm init` boilerplate.

### 5.4 🔓 STILL OPEN — README is 5 bytes and does not render

> **Re-verified 2026-09-06:** still 5 bytes, still `#1on1` with no space after the
> `#`. The repo root now has a `CLAUDE.md` project guide which covers some of the
> same ground, but it is written for Claude sessions, not for a human landing on the
> GitHub page.

```markdown
#1on1
```

No space after `#`, so GitHub-flavored markdown renders this as literal text, not
an `<h1>`. A README skeleton is proposed in [`02-root-config.md`](02-root-config.md).

### 5.5 🔓 STILL OPEN — and now more serious than "redundant"

> **Re-verified 2026-09-06:** `backend/src/server.js:214` still calls bare
> `app.use(cors())`. This is no longer merely redundant. Every request from
> `src/lib/api.ts` sends `credentials: "include"` so the HTTP-only refresh cookie
> rides along, and browsers **reject** `Access-Control-Allow-Origin: *` outright for
> credentialed requests. The dev proxy hides this by making everything same-origin;
> it breaks the moment the API is served from another origin. The fix is an explicit
> origin plus `credentials: true`.

The Vite proxy means the browser only ever talks to `localhost:3000` — it is a
same-origin request, so CORS never engages. `app.use(cors())` matters for direct
`:5000` calls and for a split-origin production deploy. Keeping it is correct;
just know that in dev it is doing nothing, and that bare `cors()` means
`Access-Control-Allow-Origin: *`, which must be narrowed before production.

---

### 5.6 ✅ CLOSED — build output was not gitignored

> **Found and closed 2026-09-06.** Not in the original audit. The root `.gitignore`
> was two lines — `node_modules` and `.env` — so `frontend/dist/` was untracked but
> **not ignored**. Every production build dropped a 211 kB bundle into `git status`,
> one careless `git add .` away from being committed. Committed build output is worse
> than noise: hashed filenames change on every rebuild, so it generates phantom merge
> conflicts indefinitely.
>
> The root `.gitignore` now also covers `dist/`, `build/`, `.vite/`, `*.tsbuildinfo`,
> `.env.local`, `.env.*.local`, `*.log`, `.DS_Store`, `Thumbs.db` and `*.stackdump`.
> Checked before writing it that **nothing matching those patterns was already
> tracked** — an ignore rule does nothing to a file git already tracks, so that check
> is what makes the fix real rather than cosmetic. Verified after: a build produces
> `frontend/dist/` on disk and `git status` stays clean.

---

## 6. 🔵 The big one: docs describe a system the code has not started

`docs/02-technology-stack.md` and `docs/03-system-design.md` describe the target
architecture. Here is the honest delta:

| Declared in docs | In `package.json`? | In code? |
|---|---|---|
| React | ✅ `^18.2.0` | ✅ |
| **TypeScript** | ✅ `typescript@^5.9.2` | ✅ **as of 2026-09-05** — `tsconfig.json` + `tsconfig.app.json` + `tsconfig.node.json` exist, and `src/pages/*.tsx`, `src/components/*.tsx`, `src/lib/*.ts` are TypeScript |
| HTML / CSS | ✅ | ✅ |
| anime.js | ❌ | ❌ |
| D3.js | ❌ | ❌ |
| Node.js + Express | ✅ `^4.18.2` | ✅ |
| AWS-hosted cloud database + its client | ❌ | ❌ |
| Socket.IO | ❌ | ❌ |
| WebRTC | ❌ | ❌ |
| Gemini API / AI layer | ❌ | ❌ |
| JWT auth | ❌ | ❌ |
| Redis / RAG / job queue | ❌ (documented as "later") | ❌ |

**The TypeScript one used to be worth calling out.** `frontend/package.json` installed
`@types/react` and `@types/react-dom` — TypeScript type definitions — but there was
no `tsconfig.json` and no `.tsx` file, so those packages did nothing except feed your
editor's IntelliSense and **you were not type-checked**, despite the docs saying the
stack is TypeScript.

**That gap closed on 2026-09-05.** `typescript@^5.9.2` and `react-router-dom@^7.9.1`
are now real dependencies, the three `tsconfig*.json` files exist, `build` runs
`tsc -b` before `vite build`, and `typecheck` is its own script. The Landing, Login and
Register pages were ported to `frontend/src/pages/{Landing,Login,Register}.tsx` with
supporting `frontend/src/components/` and `frontend/src/lib/`. The backend was **not**
ported — it is still plain ESM JavaScript.

> **✅ That TODO closed on 2026-09-06.** The entry point was switched
> (`index.html` → `/src/main.tsx`), the router was wired, and all six dead files
> — `main.jsx`, `app.jsx`, `src/pages/{landingpage,login,register}.jsx` and
> `src/pages/login.css` — were deleted with Teja's approval. Before deleting, each
> was shown to be part of a **closed island**: every reference to those six came from
> inside the six themselves, so nothing live reached them.
>
> The frontend rows of the table above are now accurate as written. The remaining
> ❌ rows — the database and its client, JWT auth, Socket.IO, WebRTC, Gemini —
> are still genuinely absent, and the **JWT auth row is actively being worked on**
> (see 3.4). No auth endpoint answers yet.

This is not a defect. It is the normal distance between a design document and
commit 5. It is written down here so nobody reads `docs/03-system-design.md` and
assumes any of it is running.

---

## 7. Fix order, if you want one

Ranked by (breaks-things × cheapness-to-fix):

Items 2, 4, 5 (partly) and 8 from the original list are **done**. What remains,
re-ranked by (breaks-things × cheapness-to-fix) as of 2026-09-06:

1. **Fix `dependabot.yml`** — one word (`"npm"`), plus entries for `frontend/` and
   `backend/`. Turns broken automation back on. *5 min*
2. **Add `.env.example` + a real README** — the "can a new person clone this?" test,
   and now also the answer to the `JWT_ACCESS_SECRET` warning on every backend boot.
   *20 min*
3. **Make the proxy read `PORT`** — kills a future debugging session. *5 min*
4. **Narrow `cors()` to an explicit origin with `credentials: true`** — required
   before any split-origin deploy, because `*` is rejected for credentialed
   requests. *10 min*
5. **Finish mounting the backend auth routers** — in progress; see 3.4.
6. **Add a test runner and test `validate.ts` first** — it is pure, total, and has
   zero coverage. The cheapest possible first suite. *1 h*
7. **Finish the a11y pass** — A1, A5, A6, A7 above. Small and mechanical. *30 min*
8. **Add an `ErrorBoundary`** — today a render throw in any page blanks the whole
   app. *20 min*

*(Original list preserved in git history; the numbering above replaces it.)*

---

## 8. What is genuinely good here

Worth stating, because an audit that only lists problems is misleading:

- **pnpm workspaces from day one.** Most people bolt a monorepo on later and it hurts.
- **`only-allow pnpm` in `preinstall`.** Stops a stray `npm install` from producing a
  second, conflicting lockfile. Many teams learn this the hard way.
- **`only-built-dependencies=["esbuild"]`.** Lifecycle scripts blocked by default with
  a single explicit allowance. That is a real supply-chain control, and unusual to see
  this early.
- **CodeQL running on push, PR *and* a weekly schedule.** The weekly cron is the part
  people skip, and it is the part that catches newly-published CVEs in unchanged code.
- **The single shared root `.env`, wired deliberately from both sides.** Easy to get
  wrong; this repo got it right.
- **The docs exist and are substantial** (2,574 lines). Writing the design before the
  code is the correct order.

Added 2026-09-06:

- **`strict: true` in `tsconfig.app.json`**, plus `noUnusedLocals` and
  `noUnusedParameters` — turned on at the start of the TypeScript port rather than
  bolted on at file 50, which is when it becomes expensive.
- **Solution-style `tsconfig`** with separate app/node projects, so build tooling and
  browser code never share a `lib`/`types` surface.
- **One token vocabulary.** All ~34 design tokens in a single `:root`; page
  stylesheets define zero. That is a discipline most projects lose by the third
  screen.
- **The access token is memory-only, never `localStorage`.** The XSS-safe choice, and
  it was made before any endpoint existed to return one.

The scaffolding decisions are better than the average project at this stage. The gap
is purely that the application logic has not been written yet.
