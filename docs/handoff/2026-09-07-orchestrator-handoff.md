# Orchestrator handoff — 2026-09-07

Written at the end of a two-day multi-session push (2026-09-05 → 2026-09-07).
Read this top to bottom before doing anything. It is the resume point.

---

## 1. What this file is

Teja works by opening several Claude Code sessions at once: **one orchestrator**
that coordinates, plus **peer sessions** that do the actual work. Long sessions
get expensive (every message re-sends the whole accumulated conversation), so
sessions get killed and restarted. This file is how context survives that.

> **Note on a stale preference:** an old `1on1_sb` memory claims Teja "does not
> want standalone handoff/resume doc files". That is **no longer true** — he
> explicitly asked for this file on 2026-09-07. The memory has been corrected.

---

## 2. Your role, if you are the next orchestrator

From `~/.claude/CLAUDE.md`, which you must read in full:

- **Never execute work directly.** Route everything to a peer session or a
  subagent, even small tasks. The orchestrator coordinates, decides and
  communicates. Read-only checks to decide *what* to delegate are fine — the
  line is "does this change state", not "is a tool call involved".
- **Exception:** managing memory, `CLAUDE.md` and config stays with the
  orchestrator. Never let a peer edit those.
- **Never `git commit`. Never `git push`. Never `git add -A`.** Teja writes his
  own commit messages and does his own pushes. You may stage by explicit path.
- **You cannot create peer sessions.** `ListAgents` only discovers sessions that
  already exist; `SendMessage` talks to them. Ask Teja to open idle sessions and
  leave them parked, then assign.
- **You CAN create subagents** (the Agent tool). For one-shot tasks these are
  strictly cheaper than resuming an old peer, because they start with an empty
  context and die when done.

### How to write a brief that works
Every peer and subagent starts with **zero context**. A brief must be
self-contained: state the established facts they cannot re-derive, name the
files they own, name the files they must not touch, and state the verification
you expect. The briefs in this session ran 40–80 lines each. That is correct,
not excessive — it is what makes workers disposable.

**Partition by write ownership.** No two workers may write the same file. Shared
reads are fine. Every collision this session came from a file two concerns both
needed (`frontend/package.json`, `pnpm-lock.yaml`, root `package.json`).

---

## 3. Resume checklist

1. Read `~/.claude/CLAUDE.md` (machine-wide working rules).
2. Read `1on1/CLAUDE.md` (project stack, conventions, auth contract).
3. Read this file.
4. `ListAgents` — see what sessions exist. Expect none on a fresh start.
5. Ask Teja to open idle peer sessions for whatever you plan to parallelise.
6. Check `git status` — see §7, some work is staged and uncommitted.
7. Check §6 for open questions that block work.

---

## 4. Project state — one paragraph

`1on1` is a Node-only rebuild of a session-booking product. The **frontend
migration is complete and verified**; the **backend auth layer is complete and
tested** but persists to an in-memory store; **no database exists anywhere yet**.
The legacy `1on1_sb` (Java/Spring) project is being wound down — its AWS EC2
instance is stopped and its Vercel deployment is a known open risk. Nothing has
been committed in two days of work.

---

## 5. Completed work

### 5.1 Frontend TypeScript migration — DONE, independently verified
Landing, Login and Register were ported from `1on1_sb` (React 19 + TS) into
`1on1` (React 18 + TS). ~2,500 lines.

- Nine files are **md5-identical** to the donor: `Landing.tsx`, `landing.css`,
  `authShell.css`, `Brand.tsx`, `Icons.tsx`, `TextField.tsx`, `SlotBlock.tsx`,
  `index.css`, `main.tsx`.
- Expected differences only in `Login.tsx`, `Register.tsx`, `AuthShell.tsx`,
  `auth.tsx`, `validate.ts` (comments de-Java-fied), `api.ts` (rewritten for
  Node), `types.ts` (trimmed to the auth subset), `App.tsx` (3 routes, not 11).
- **Zero Spring leakage.** No `@NotBlank`, `/oauth2/authorization/google`, STOMP,
  JPA or Bean Validation anywhere in `frontend/src`.
- **Zero dangling imports.** All 27 imports resolve.
- Typecheck exit 0. Production build exit 0 — 52 modules, 211 kB JS / 24 kB CSS.
- **React stayed on 18.** Predicted React 19 type friction never materialised.
- Six dead `.jsx` files deleted after proving they formed a *closed island*.
- ESLint 10 flat config added — `pnpm lint` works for the first time ever.
- `.gitignore` extended (it was 2 lines; `dist/` was unignored).

**Load-bearing design details verified in a real headless browser**, because
these fail silently:

| Check | Result |
|---|---|
| `index.css` imported before `App` in `main.tsx` | PASS |
| Archivo `wdth` variable axis live | PASS — computed `font-stretch: 118%` on landing `h1` |
| 8 × `<hr className="ui-rule" />` | PASS — 8 in source, 8 in DOM |
| `gap: 1px` hairline trick | PASS — 18 elements rendering it |
| 34 `:root` tokens, page stylesheets define zero | PASS |
| `public/mark.svg` present and referenced | PASS |

### 5.2 Backend auth — DONE, 87 tests passing
`POST /api/auth/{register,login,refresh,logout}`, `GET /api/auth/me`,
`GET /api/auth/google` + `/callback`, `GET /api/health`.

- JWT access token in the response body; refresh token in an **HttpOnly,
  rotating, single-use** cookie. `bcryptjs` hashing.
- **`jose`** signs our HS256 tokens *and* verifies Google's RS256 ID tokens via
  remote JWKS — one zero-dep library replacing `jsonwebtoken` + `jwks-rsa`.
- **`bcryptjs`, not native `bcrypt`** — see §11 for why native addons cannot
  work in this repo.
- CORS fixed from wide-open `*` to an explicit origin allowlist with
  `credentials: true`.
- Persistence sits behind a **repository seam** at
  `backend/src/repositories/userRepository.js`, in-memory, which **hard-throws on
  `NODE_ENV=production`** by design.
- 87 tests, 9 suites, `node:test` + `node:assert`, **zero new dependencies**.
  Google OAuth is tested **hermetically** — a stub replaces `globalThis.fetch`
  and serves a JWKS whose keys it controls, so the *real* verification path runs
  (signature, issuer, audience, expiry) with nothing leaving the machine.
- Script must be `node --test "tests/**/*.test.js"` — `node --test tests/` does
  not work on Node 24.

### 5.3 Documentation — rewritten to match reality
- `docs/code/04-frontend.md` and `05-styles.md` re-derived for the TS frontend.
- `docs/code/08-gaps-and-findings.md`: **11 CLOSED / 10 OPEN / 5 SUPERSEDED**,
  nothing deleted — every original finding kept verbatim with a status note.
  *SUPERSEDED (the code was deleted) is tracked separately from CLOSED (the
  problem was fixed)* — they teach different lessons.
- 64 stale MongoDB/Java references corrected across `docs/`.
- `docs/learn/06-database-indexing.md` written (new).
- `docs/architecture/01-data-model.md` — full PostgreSQL schema design.
- `docs/deployment/10-aws-inventory-2026-09-06.md`,
  `11-rds-provisioning-plan.md`.
- `1on1_sb/docs/deployment/08-shutdown-and-teardown.md` + a `teardown.sh`.

### 5.4 Environment fixes
- **pnpm was never installed on this machine** despite every repo mandating it.
  Now installed globally: **pnpm 11.25.0** at
  `C:\Users\tejam\AppData\Roaming\npm\pnpm.ps1`.
- pnpm standardisation swept across the sibling repos (report in
  `1on1_sb/docs/pnpm-migration-report.md`).

---

## 6. OPEN QUESTIONS — these block work. Ask Teja.

1. **Where does the database actually live?** RDS PostgreSQL is *chosen* but
   **not provisioned**. Teja pushed back hard on the cost. The honest options:
   - **Local Postgres for dev now, RDS when deploying** — $0, same Postgres,
     unblocks everything. This was the recommendation; he never explicitly
     accepted it.
   - **RDS now** — ~$17.95/mo (`db.t4g.micro` + 20 GB in ap-south-1), covered by
     credits until 2027-02-27, then real money. Breaches his existing $9.50
     budget alarm on day one.
2. **RDS parameters, if provisioned** — public accessibility (recommended YES
   but only with 5432 locked to a single /32, `rds.force_ssl=1`, and a
   Secrets-Manager-generated password), `db.t4g.micro` over `t3.micro` (19%
   cheaper *and* faster, Graviton), PG 17.11, and a budget raise.
3. **Which AWS compute for the Express backend?** Teja said "in aws nowww".
   Lambda + API Gateway HTTP API is the likely answer (1M requests/month is
   Always Free), but it was assigned and not completed. Note: **Lambda's
   ephemeral concurrent containers make the in-memory store even more broken**,
   so this does not work end-to-end until the database lands.
4. **`1on1_sb`'s Vercel deployment is still live and still a risk.** It proxies
   `/api/*` and OAuth callbacks over **plain HTTP** to `13.235.82.139` — an
   ephemeral IP that was **released back to AWS** when the instance stopped, so
   it may now belong to a stranger. Teja said the projects have separate
   dashboards and he'd handle it later. **Editing `vercel.json` does not fix
   this** — Vercel bakes config into an immutable deployment at build time; only
   the dashboard action stops a running deployment.
5. **Migration runner** — Flyway is banned (JVM, and `CLAUDE.md` forbids Java).
   `node-pg-migrate` was the recommendation; not confirmed.
6. **Two small frontend items**, never done: the stale TODO comment on
   `googleAuthorizeUrl()` in `lib/api.ts`, and rendering `?error=` on `/login`
   (codes: `google_failed`, `google_cancelled`, `google_email_unverified`,
   `google_unavailable`).

---

## 7. Git state — IMPORTANT

**Nothing has been committed in two days.** ~50 paths are uncommitted. Work was
sorted into four groups; **Group 1 is staged and waiting for Teja's commit.**

| Group | Contents | State |
|---|---|---|
| **1 — frontend TS migration** | 31 paths, all `frontend/` — 21 added, 4 modified (`index.html`, `package.json`, `vite.config.js`), 6 deleted `.jsx`/`.css` | **STAGED** |
| **2 — backend auth** | 17 paths under `backend/` | unstaged |
| **3 — toolchain** | `.gitignore`, root `package.json`, `pnpm-lock.yaml` | unstaged |
| **4 — docs** | 19 paths under `docs/` | unstaged |
| *(standalone)* | root `CLAUDE.md` — governance, deserves its own commit | unstaged |

**Commit order matters: 1 → 2 → 3 → 4.** `pnpm-lock.yaml` describes packages
from all three code groups and cannot be split. It is only self-consistent once
every manifest it references is in `HEAD` — land it early and intermediate
commits fail `pnpm install --frozen-lockfile`, breaking bisect and CI on
history. Group 3 owns it, so Group 3 goes last of the code groups.

`frontend/package.json` mixes the TS deps and the ESLint 10 bump in **one
unsplittable hunk**. Judged as one causal change (you cannot lint `.tsx` without
`typescript-eslint`), so it is staged with Group 1.

`frontend/dist/` has **never been tracked** in any of the 12 commits — but it is
protected only by the *uncommitted* `.gitignore`, since git reads that from the
working tree. Committing Group 3 reasonably soon closes that gap.

---

## 8. Cleanup owed

**Two dev servers were deliberately left running** so Teja could look at the app:

| | URL | PID |
|---|---|---|
| Frontend (Vite 6.4.3) | http://localhost:3000/ | 26920 |
| Backend (Express) | http://localhost:5000/api/health | 12912 |

Register and login work through the browser right now, against the in-memory
store. Kill them by **PID** — `TaskStop` kills the wrapper but leaves the node
child holding the port, and nodemon runs as `node.exe`, so name-based kills miss
it. An orphaned nodemon already survived that way once this session.

---

## 9. AWS state — verified read-only 2026-09-07

- **One billable resource in the whole account:** a **stopped** t3.micro
  (`i-06832c2229943e99d`) + a 20 GiB gp3 volume, ap-south-1. Both belong to the
  **legacy `1on1_sb`** project, despite being tagged `oneonone-server` — a name
  that reads like the keeper. *A tag that reads like what you're looking for is
  not evidence; check provenance.*
- **Zero databases** of any kind across all 17 regions. Zero running instances.
- **`1on1` has no AWS footprint at all.**
- **Billing:** the **credit-based Free Plan** — $116.51 in credits expiring
  **2027-02-27**. There is **no legacy 12-month free tier**; an earlier session
  assumed there was and was wrong. Only "Always Free" allowances apply.
- Existing budget `Monthly-800INR-Limit` (~$9.50/mo) is **alert-only, not a cap**.
- The instance was stopped by **Teja himself on 2026-09-04 05:21:43 GMT**
  ("User initiated") — not by any tooling here.
- `13.235.82.139` is **gone**; it was ephemeral and released on stop. A restart
  yields a new IP, so `1on1_sb`'s `vercel.json` and `deploy-aws.yml` would both
  need edits.
- Teja asked whether `1on1` needs a **separate AWS account**. Recommendation:
  **no** — credits don't transfer, and the account holds exactly one stopped
  resource. The fix for the confusion is **tagging** (`Project=1on1` vs
  `Project=1on1-legacy-sb`), which is free.

---

## 10. Known remaining defects

1. **`Landing.tsx:527` links to `/dashboard`, which has no route.** The catch-all
   silently bounces the user back to `/`. This is the one user-visible broken
   thing in the app.
2. **`frontend/index.html` lost two lines** relative to the donor: the
   `<meta name="description">` (its only SEO/social-preview metadata) and the
   title, downgraded from `1on1 — book the time, not just the connection` to
   `1on1 App`. The file was retyped with teaching comments rather than copied,
   and these were lost.
3. `Login.tsx:182` has a dead `#reset` forgot-password anchor — **inherited from
   the donor**, byte-identical, not a migration miss.
4. `Icons.tsx` exports ~28 icons; only 3 carry `aria-hidden`.
5. `landing.css` breaks at 560px while `authShell.css` breaks at 520px for the
   same narrow-phone case — accidental drift, harmless today.
6. `frontend/vite.config.js` hardcodes the dev proxy to `:5000` while the backend
   reads `process.env.PORT`.
7. The `.pdf` files beside `docs/01`–`03` still carry pre-migration text.

---

## 11. Machine gotchas that cost real time

- **Native Node addons cannot work in `1on1`.** The root `.npmrc` pins
  `only-built-dependencies=["esbuild"]`, so pnpm skips other packages' install
  scripts. Native addons **install cleanly and then fail at import** — a runtime
  failure that looks like a code bug, not a packaging one. Hence `bcryptjs`.
- **`corepack enable pnpm` fails with `EPERM`** (needs an elevated shell), and
  corepack **rejects caret ranges** in `packageManager` / `devEngines` — it wants
  an exact pin like `pnpm@11.25.0`. If `packageManager` and
  `devEngines.packageManager` disagree, pnpm warns and **devEngines wins**.
- **Plain `npm` inside these repos fails with `EBADDEVENGINES`.** Run npm from
  outside the repo.
- **Bash heredocs are safe for prose and config** but mangle doubled backslashes
  and regex inside *code*. Use `Write` for `.js`/`.ts`, or Read + `Edit`.
- Windows is **case-insensitive**: `login.jsx` and `Login.tsx` can collide.
- A peer reading a file another session is **mid-edit** on will see incoherent
  states that are not defects. This happened once — a peer correctly reported the
  backend as broken while another was three edits into wiring it.

---

## 12. Errors caught this session — the most useful section

Peers and subagents corrected the orchestrator **nine times**. Every one was
found by a worker verifying a claim instead of complying with it. Treat every
brief you receive as a hypothesis.

| Wrong claim | Reality |
|---|---|
| "ESLint 8 vs 9 vs oxlint" | ESLint **10.10** is current; 9.39 is already `maintenance`. Both offered options were stale. |
| "Account has the 12-month free tier to 2027-08-27" | **Credit-based Free Plan**, $116.51 expiring **2027-02-27**. No free `db.t3.micro`. |
| "All three ported pages call `useAuth()`" | **`Landing.tsx` does not.** Only Login and Register do. |
| "Editing `vercel.json` neutralises the proxy" | Vercel bakes config in at **build time**; the live deployment is immutable. |
| "The `oneonone-server` instance may be the keeper's" | It's the **legacy** project's, proven from `1on1_sb`'s own deploy docs. |
| "`13.235.82.139` will go down when we stop it" | Already released **two days earlier**. |
| "Copy `1on1`'s `.npmrc` to other repos" | `only-built-dependencies` is an **allowlist** — copying `["esbuild"]` would silently skip sharp/oxide builds elsewhere. |
| "Root `package.json` has TypeScript changes" | It doesn't — its only hunk is toolchain. |
| "`vite.config.js` is a toolchain change" | Its diff is **comment-only**; it belongs with the migration. |
| "Use Flyway for migrations" | Flyway is a **JVM** tool and `CLAUDE.md` bans Java. |

Workers also caught **their own** errors, which is rarer and more valuable:
- One planned to prove file deletion via a 404 — got **200**, because Vite's SPA
  fallback serves `index.html` for everything. It tested a control path that
  never existed, got the same 200, and concluded its *test* was worthless.
- One dropped `--max-warnings 0` while legitimately removing the obsolete
  `--ext` flag, caught it, and restored the gate. *Bundling a real change with an
  unnoticed one is how quality gates die.*
- One found that `body-parser` attaches the raw request body to its
  `SyntaxError`, so `console.error(err)` was writing **cleartext passwords** to
  stdout on a malformed login. Fixed, and pinned with a canary test.
- One ran an a11y sweep over the *component* files and never opened `index.css`
  — where the reset lives. "Absent from the components" is not "absent". Two
  findings were wrong as a result; both corrected.

---

## 13. Techniques worth reusing

- **Write-ownership partitioning** — the only rule that makes parallel sessions
  safe. Every collision came from a shared file.
- **Discover before you mutate** — the AWS pause was gated behind an inventory,
  which is what revealed the resource wasn't the keeper's *and* that the pause
  was already done.
- **Dependency seams unblock decisions you don't own** — auth landed behind a
  repository interface while the database question stayed open. One file changes
  later, not the whole auth layer.
- **Gate the irreversible, allowlist the reversible** — read-only discovery ran
  freely; anything with a standing hourly charge stopped for confirmation.
- **Prove tooling works by making it fail** — a zero-problem first-ever lint run
  is a smell. Reintroduce the bug and watch the test go red.
- **Verify the artifact, not the input** — grep the built CSS bundle, not the
  source.
- **Prove the closed island before deleting** — "nothing imports X" is weak;
  "X and its dependents form a set with no edge from the live graph" is proof.
- **One fact, one home** — a rule stored twice drifts and then contradicts
  itself. Machine-wide rules in `~/.claude/CLAUDE.md`, project facts in
  `1on1/CLAUDE.md`, non-obvious learnings in project memory. Nothing duplicated.
- **Route knowledge between workers who can't see each other.** Two peers were
  about to publish contradicting documents — one teaching index principles, one
  designing the schema those principles govern. In parallel work this is the
  orchestrator's real job, more than assigning tasks.

---

## 14. Tooling gaps in Teja's setup

- **`/fewer-permission-prompts` — never run.** There is **no permissions
  allowlist anywhere**: `~/.claude/settings.json` has only `enabledPlugins`,
  `effortLevel` and `theme`, and there is no project `.claude/settings.json`. So
  every `git status` and `ls` prompts for approval, across every session at once.
- **`effortLevel: "xhigh"` is global**, so every session inherits it — including
  peers doing mechanical file copies. Worth calibrating per task; `/config`
  changes it.
- **`chrome-devtools-mcp` and `playwright` MCP servers failed to connect** this
  session (cached failure, auto-retries ~15 min). A render-level audit had to be
  hand-written as a CDP probe. Getting either working would make that class of
  check a one-liner. The **`vercel`**, **`github`**, `atlassian`, `figma`,
  `postman` and `supabase` servers also need authorization — run `/mcp` in an
  interactive session.
- **No route-vs-link consistency check exists**, which is why the `/dashboard`
  dead link and the `#reset` placeholder survived.
- **`/revise-claude-md` is installed and unused** — the right tool for keeping
  `CLAUDE.md` honest as reality moves.
