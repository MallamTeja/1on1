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
- **Database engine: PostgreSQL — settled.** Relational, because follows /
  sessions / bookings / availability are join-heavy, and `1on1_sb` already
  proved a Postgres schema for this exact product. The schema is designed in
  `docs/architecture/01-data-model.md`. **Do not re-open the engine choice.**
- **Database & Backend hosting: SETTLED on 2026-09-08.** AWS Lightsail VPS
  (Ubuntu 24.04 LTS, Mumbai `ap-south-1`) running Node.js Express + PostgreSQL
  co-located for flat $5.00/mo (~₹470 INR/mo), safely within Teja's ₹800/mo
  budget. Frontend is deployed on Vercel and proxies `/api/*` to Lightsail via
  `frontend/vercel.json`. Media (images/videos) stored in AWS S3 via presigned
  URLs; binary blobs are forbidden in Postgres. See
  `docs/decisions/2026-09-08-hosting-settled-lightsail-vps-and-vercel.md`.
- **Local Postgres exists but is NOT the plan.** PostgreSQL 18.6 runs natively
  on this machine (service `postgresql-x64-18`, port 5432, `scram-sha-256`, so
  every connection needs a password). Teja ruled out local-only dev on
  2026-09-08 — he wants cloud. Don't propose it again as the destination. If it
  is ever used as a scratch target, note that `oneonone_dev` on that server
  belongs to **`1on1_sb`**; `1on1` must get a separately named database.
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
| Database | PostgreSQL, hosting TBD | PostgreSQL on the EC2 box |
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

## Code commenting — house style, non-negotiable

**Every statement, declaration and block carries a comment saying why it
is there.** Structural lines (`}`, blanks, closing tags) are the only
exception. Applies to `.js`, `.ts`, `.tsx`, `.css`, `.sql`, `.html`,
migrations and test files alike. Teja asked for this on 2026-09-08 because
he learns from reading his own code; the machine-wide rule is #7 in
`~/.claude/CLAUDE.md`. This section records what it looks like *here*.

**Calibration — measured 2026-09-08 (comment lines ÷ code lines):**

| File | Ratio | Status |
|---|---|---|
| `backend/src/repositories/userRepository.js` | 1.65 | house style — this is the target |
| `backend/src/lib/session.js` | 1.43 | house style |
| `backend/src/routes/auth.js` | 1.30 | house style |
| `frontend/src/lib/api.ts` | 0.83 | close; rewritten for Node |
| `frontend/src/pages/Login.tsx` | 0.12 | **debt** — ported from `1on1_sb` |
| `frontend/src/pages/Landing.tsx` | 0.02 | **debt** — md5-identical to donor |

Hand-written backend code already meets the rule; the **debt is the
donor-ported frontend** (the nine files that were copied byte-for-byte
from `1on1_sb`, plus the lightly de-Java-fied pages). A retro-commenting
pass over `frontend/src` is owed and must be its own parcel — never
bundle it into a bug fix, or the diff becomes unreviewable.

Rules of thumb:
- Say **why**, not what. `// bump counter` is noise; `// counter, not a
  timestamp, so two ids minted in the same ms still sort` is the point.
- A comment that names the alternative you rejected is worth two that
  describe the line.
- Comments in SQL migrations are the most valuable of all — they are the
  only place the schema's *reasons* survive once the doc drifts.
- **Brief every worker with this rule before they write a line.**
  Retro-commenting is a second pass nobody budgets for.
- The md5-identity verification used for the port (nine files identical
  to the donor) is **superseded** by this rule: those files are now
  `1on1`'s and will diverge from the donor as they are commented.

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
- **CORS is fixed** (was wide-open `*`, which is incompatible with
  `credentials: "include"` — a hard browser rule, not a preference). It now
  passes a **function** to `cors()` at `backend/src/server.js:186-200`, checking
  `config.corsAllowedOrigins`, so the server echoes one specific origin back
  instead of a wildcard. Requests with no `Origin` header (curl, health checks)
  are allowed through — CORS is a browser mechanism and was never API
  authorisation. Don't "fix" this again.

## Current state — what is real vs. aspirational

- Frontend Landing / Login / Register are **real and typecheck clean**.
- **Backend auth is real and tested — 87 tests across 9 suites**, `node:test`
  + `node:assert`, zero test dependencies. `backend/src/routes/auth.js` is
  mounted at `server.js:293` and `googleAuth.js` at `:309`. Google OAuth is
  tested hermetically: a stub replaces `globalThis.fetch` and serves a JWKS
  whose keys the test controls, so the real verification path runs with
  nothing leaving the machine. Run tests as
  `node --test "tests/**/*.test.js"` — the glob is required; `node --test
  tests/` does not work on Node 24.
  *(Until 2026-09-08 this section claimed the backend served only
  `GET /api/health`. That was false and had been for two days. The same dead
  claim still sits in comments at `backend/src/server.js:9-11` and
  `frontend/src/lib/api.ts:11-13`, and is queued for removal.)*
- **`pg ^8.23.0` (runtime) and `node-pg-migrate ^9.0.0` (dev) landed
  2026-09-08** — the first dependencies added since auth. Before that no
  driver was installed, by design, while hosting was undecided. Migrations
  live in `backend/migrations/`, ESM files whose body is one `pgm.sql()`
  literal so they diff line-for-line against the data-model doc.
  `bcryptjs` was chosen over native `bcrypt` because **native Node addons
  cannot work here**: install scripts are skipped by **two** independent
  allowlists — root `.npmrc` `only-built-dependencies=["esbuild"]` (older
  spelling) and `pnpm-workspace.yaml` `allowBuilds: { esbuild: true }` (pnpm
  11 spelling). Editing one leaves the other blocking. Precisely: packages
  whose binary needs a *build or download step* (`bcrypt`, `pg-native`,
  node-gyp anything) install cleanly then fail at import; packages shipping
  prebuilt binaries as platform optional-deps (napi-rs pattern) are fine.
  `pg` is pure JS. **Never add `pg-native`.**
- `docs/code/04-frontend.md` and `05-styles.md` were re-derived for the TS
  frontend on 2026-09-07 (verified 2026-09-08: the doc describes `.tsx` and
  states zero `.jsx` remain). *(Until 2026-09-08 this line claimed the
  opposite. Stale.)*
- The `.pdf` files beside `docs/01`–`03` still carry pre-migration text.
- **The data-model doc is missing a column the API contract requires.**
  `docs/architecture/01-data-model.md` §5 defines `app_user` with no
  `verification_status`, but `verificationStatus` (`UNVERIFIED | PENDING |
  VERIFIED | REJECTED`) is returned by `toUserResponse()`, declared
  non-optional in `frontend/src/lib/types.ts`, and asserted by exact key set in
  `backend/tests/auth.test.js:69`. It is orthogonal to `account_status`
  (moderation state vs. email-proof state). Migration `0001` must add it and
  the doc must be amended — found 2026-09-08, assigned to the pg data-layer
  parcels.
- **Refresh-token column is `revoked_at`, not `consumed_at`.** The data model
  is the source of truth for names; briefs that say `consumed_at` are wrong.
  Rotation must be one statement: `UPDATE … WHERE token_hash=$1 AND revoked_at
  IS NULL … RETURNING`, fused with the successor `INSERT` via a CTE. The
  in-memory store is atomic only by accident of Node's single thread (no
  `await` between `get` and `delete`) — a two-statement SQL translation
  reintroduces the replay hole.

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
