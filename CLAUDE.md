# 1on1 — project guide for Claude

Read this before touching anything. It records decisions that are already
made, so they don't get re-litigated or accidentally reversed.

## What this is

`1on1` is an open professional-network + session-booking platform.
Core loop: Discover → Follow → Engage → Request Session → Meet → Return.
Full spec in `docs/01-product-requirements.md`.

## Stack — decided, do not re-open

- **Node.js only.** MERN-shaped, but the M is not MongoDB.
- **Backend:** Node + Express 4, ESM (`"type": "module"`).
- **Frontend:** React 18 + Vite + **TypeScript** (adopted 2026-09-05),
  routing via `react-router-dom` v7.
- **Database: RDS PostgreSQL** — chosen by Teja 2026-09-06. Relational,
  because follows / sessions / bookings / availability are join-heavy, and
  `1on1_sb` already proved a Postgres schema for this exact product.
  **Not provisioned yet.** An AWS CLI audit on 2026-09-06 confirmed the
  account contains *zero* databases of any kind across all 17 regions, and
  the backend still has no DB driver. Until it is provisioned, persistence
  stays behind the repository seam in `backend/src/repositories/`.
  See `docs/deployment/10-aws-inventory-2026-09-06.md`.
- **Infrastructure: AWS only. No GCP.** Google OAuth is an identity
  provider — using it is not GCP hosting and does not violate this rule.

### Explicitly forbidden
- **No MongoDB / Mongoose.** Removed; docs still carry historical notes.
- **No Java, no Spring Boot, no Maven.** That is the *other* repo.
- **No Clerk** or hosted auth SaaS — auth is built here.
- **No npm or yarn.** pnpm only (enforced by `preinstall: only-allow pnpm`).

## The naming trap — read this twice

"1on1" is the **product** name, and two repos build it with opposite
stacks. Never state a fact about one as if it applied to the other.

| | `1on1` (this repo) | `1on1_sb` (legacy, sibling dir) |
|---|---|---|
| Backend | Node + Express | Java 23 + Spring Boot 3.4 + Maven |
| Database | AWS cloud DB (TBD) | PostgreSQL |
| Status | **the keeper** | being wound down |
| Role | production target | design/UI source of truth |

`1on1_sb` lives at `../1on1_sb`. We harvest its **UI** from it; its
backend coupling must never cross over. If you see `/oauth2/authorization/google`,
`@NotBlank`, Bean Validation, STOMP or JPA in this repo, it leaked and
should be removed.

## Commands

```
pnpm install              # from repo root
pnpm dev                  # both packages concurrently
pnpm dev:frontend         # Vite on :3000
pnpm dev:backend          # Express on :5000 (nodemon)
pnpm --filter 1on1-frontend run typecheck   # tsc -b --noEmit
pnpm --filter 1on1-frontend run build       # tsc -b && vite build
```

pnpm is at `C:\Users\tejam\AppData\Roaming\npm\pnpm.ps1` if not on PATH.
`corepack enable` fails here with `EPERM` (needs an elevated shell), and
corepack rejects caret ranges in `packageManager` — pin exact versions.

## Layout

```
frontend/
  index.html            # entry; loads /src/main.tsx, Google Fonts (Archivo wdth axis)
  src/
    main.tsx            # StrictMode > BrowserRouter > AuthProvider > App
    App.tsx             # routes: / , /login , /register , * -> /
    index.css           # design tokens + reset + shared `ui-` primitives
    components/         # Brand, Icons, TextField, SlotBlock, AuthShell
    pages/              # Landing, Login, Register (+ co-located .css)
    lib/                # api.ts, auth.tsx, validate.ts, types.ts
backend/
  src/server.js         # Express app
docs/                   # see docs/code/ and docs/learn/
```

### Frontend conventions
- **`src/index.css` must be imported before any page CSS.** Page rules and
  the shared `ui-` primitives have the same single-class specificity, so
  the cascade is decided by source order. `main.tsx` relies on this.
- Shared primitives are `ui-`prefixed; each page stylesheet uses its own
  namespace (`.ld-` landing, `.au-` auth) so they cannot collide.
- All ~34 design tokens live in `:root` in `index.css`. Page stylesheets
  define **zero** custom properties — never inline a colour, add a token.
- Icons are hand-written inline SVG in `components/Icons.tsx`. There are
  no image assets and no icon library — keep it that way.
- Archivo is loaded with its **`wdth` variable axis**; headings use
  `font-stretch: 112–118%`. Dropping the axis silently flattens the design.

## Auth contract — decided

- **Email + password is the core.** Google OAuth is additive and must
  never replace it.
- Short-lived **JWT access token returned in the response body**, held in
  memory on the client only. **Never localStorage** (XSS).
- **Refresh token in an HTTP-only, rotating, single-use cookie.**
  `AuthProvider` calls `refreshSession()` exactly once on mount, guarded
  by a `useRef` — that guard exists so StrictMode's double-mount cannot
  double-rotate the cookie. Do not remove it.
- Passwords hashed with **bcrypt** server-side.
- Endpoints: `POST /api/auth/{login,register,refresh}`, Google at
  `/api/auth/google`. The frontend branches on **HTTP status** —
  **401** = bad credentials, **409** = email already used — via real
  `ApiError` / `NetworkError` classes in `lib/api.ts`. They are runtime
  classes, not types; keep them.
- `cors()` is currently wide-open `*`, which is **incompatible with
  `credentials: "include"`**. Needs an explicit origin allowlist.

## Current state — what is real vs. aspirational

- Frontend Landing / Login / Register are **real and typecheck clean**.
- Backend implements **only `GET /api/health`**. The auth endpoints above
  are the intended contract, not working code. Don't document them as live.
- No database driver is installed yet, by design — see the TODO above.
- `docs/code/04-frontend.md` §§2–7 still describe the old `.jsx` frontend
  and need re-deriving.
- The `.pdf` files beside `docs/01`–`03` still carry pre-migration text.

## Working rules

- **Never `git commit`, never `git push`.** Stage by explicit path
  (`git add <path>`, never `-A`) and stop. Teja writes his own messages.
- Multiple Claude sessions often work this tree at once. Before staging,
  `git diff` and stage only what belongs to your task — shared files
  routinely carry other sessions' unstaged hunks.
- Windows is **case-insensitive**: `login.jsx` and `Login.tsx` can collide.
  Verify exact case after any delete or rename.
- `TaskStop` on a backgrounded Vite/nodemon kills the wrapper but leaves
  the node child holding the port. Kill the PID.
