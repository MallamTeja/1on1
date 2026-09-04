# 08 — Gaps, Bugs and Findings

> Every item below was verified against the working tree, not inferred.
> Nothing here has been auto-fixed — this document records the **current** state
> so you can decide what to change. Where a fix is obvious, it is shown as a
> suggestion in a fenced block, not applied.

**Audit date:** 2026-09-04 · **Commit:** `f856a01` · **Branch:** `main`

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

### 1.1 `pnpm lint` cannot run — no ESLint config exists

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

### 1.2 🔴 Dependabot is misconfigured and will never open a PR

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

### 1.3 🟡 No `.env` file exists, and nothing tells you that

Confirmed: no `.env` at the repo root. `.gitignore` correctly excludes it, so a
fresh clone will never have one. Consequences:

- `dotenv.config()` in [backend/src/server.js:10](../../backend/src/server.js#L10)
  silently does nothing — dotenv does **not** throw on a missing file.
- `process.env.PORT` is `undefined`, so the `|| 5000` fallback kicks in and the
  backend still starts. It works *by accident*, not by design.
- The moment a real secret is added (Mongo URI, JWT secret, Gemini key), a fresh
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

### 2.1 The Google logo renders entirely in red

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

### 2.2 `Illustration` is defined inside `Login` — subtree remounts on every render

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

### 2.3 🟡 The Vite proxy target ignores `PORT`

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

### 3.1 The login form sends nothing, anywhere

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

### 3.2 Two empty page files

```console
frontend/src/pages/landingpage.jsx   0 bytes
frontend/src/pages/register.jsx      0 bytes
```

Both are 0 bytes. An empty `.jsx` file is valid JavaScript but exports nothing —
importing it yields `undefined`, and rendering `<undefined />` throws. Nothing
imports them today, so they are inert. Note that **register is already handled**
by `login.jsx`'s `isLogin === false` branch, so `register.jsx` may be redundant
by design rather than unfinished.

### 3.3 No router

[app.jsx](../../frontend/app.jsx) renders `<Login />` unconditionally. With
`landingpage.jsx` waiting to be filled in there is no way to navigate anywhere.
`react-router-dom` is not in `frontend/package.json`.

### 3.4 The backend has one route and no architecture

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

---

## 5. 🟡 Structural / convention findings

### 5.1 Entry files sit outside `src/`

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

### 5.2 CSS is global, not scoped

`import './login.css'` makes Vite inject it as a plain `<style>` tag. The rules
`*` and `body` therefore apply **application-wide**, and generic class names
(`.input-field`, `.submit-btn`, `.divider`) sit in one flat namespace. The second
page that imports its own CSS will collide. See [`05-styles.md`](05-styles.md) for
the CSS Modules / custom-properties migration path.

### 5.3 `main: "index.js"` in the root package.json points at nothing

There is no `index.js` at the repo root. Harmless — the root package is only ever
a script runner, never imported — but it is leftover `npm init` boilerplate.

### 5.4 README is 5 bytes and does not render

```markdown
#1on1
```

No space after `#`, so GitHub-flavored markdown renders this as literal text, not
an `<h1>`. A README skeleton is proposed in [`02-root-config.md`](02-root-config.md).

### 5.5 `cors()` is currently redundant in dev

The Vite proxy means the browser only ever talks to `localhost:3000` — it is a
same-origin request, so CORS never engages. `app.use(cors())` matters for direct
`:5000` calls and for a split-origin production deploy. Keeping it is correct;
just know that in dev it is doing nothing, and that bare `cors()` means
`Access-Control-Allow-Origin: *`, which must be narrowed before production.

---

## 6. 🔵 The big one: docs describe a system the code has not started

`docs/02-technology-stack.md` and `docs/03-system-design.md` describe the target
architecture. Here is the honest delta:

| Declared in docs | In `package.json`? | In code? |
|---|---|---|
| React | ✅ `^18.2.0` | ✅ |
| **TypeScript** | ❌ | ❌ — all files are `.js` / `.jsx`, and there is **no `tsconfig.json`** |
| HTML / CSS | ✅ | ✅ |
| anime.js | ❌ | ❌ |
| D3.js | ❌ | ❌ |
| Node.js + Express | ✅ `^4.18.2` | ✅ |
| MongoDB Atlas + Mongoose | ❌ | ❌ |
| Socket.IO | ❌ | ❌ |
| WebRTC | ❌ | ❌ |
| Gemini API / AI layer | ❌ | ❌ |
| JWT auth | ❌ | ❌ |
| Redis / RAG / job queue | ❌ (documented as "later") | ❌ |

**The TypeScript one is worth calling out.** `frontend/package.json` installs
`@types/react` and `@types/react-dom` — TypeScript type definitions — but there is
no `tsconfig.json` and no `.tsx` file. Those packages currently do nothing except
feed your editor's IntelliSense. That is a reasonable half-step, but be aware that
**you are not type-checked today**, despite the docs saying the stack is TypeScript.

This is not a defect. It is the normal distance between a design document and
commit 5. It is written down here so nobody reads `docs/03-system-design.md` and
assumes any of it is running.

---

## 7. Fix order, if you want one

Ranked by (breaks-things × cheapness-to-fix):

1. **Fix `dependabot.yml`** — one word (`"npm"`). Turns broken automation back on. *2 min*
2. **Add the ESLint config** — makes `pnpm lint` real, catches hook bugs automatically. *10 min*
3. **Add `.env.example` + a real README** — the "can a new person clone this?" test. *20 min*
4. **Wire the login form** — controlled inputs + a `fetch('/api/...')` call. This is the first line of code that makes the app an *application* rather than a mock. *1–2 h*
5. **Hoist `Illustration`, fix the Google SVG colours, add the a11y attributes** — small, mechanical, done once. *30 min*
6. **Make the proxy read `PORT`** — kills a future debugging session. *5 min*
7. **Give the backend a shape** — `routes/`, `controllers/`, an error handler, a 404 handler — *before* the second route exists, not after the tenth. *2 h*
8. **Decide on TypeScript** — do it before there are 50 files, or drop `@types/*` and be honestly JavaScript. Half-states get expensive.

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

The scaffolding decisions are better than the average project at this stage. The gap
is purely that the application logic has not been written yet.
