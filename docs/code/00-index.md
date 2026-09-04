# 1on1 — Codebase Documentation

> Everything in this folder describes the code that **actually exists** today, file
> by file and line by line. For the product *plan*, see `docs/01-product-requirements.md`,
> `docs/02-technology-stack.md` and `docs/03-system-design.md` — and read
> [`08-gaps-and-findings.md`](08-gaps-and-findings.md) for an honest account of the
> distance between the two.

**Generated:** 2026-09-04 · **Commit:** `f856a01` · **Branch:** `main`

---

## Start here

If you have never seen this repo before, read in this order:

1. [`01-repo-anatomy.md`](01-repo-anatomy.md) — the map. Every file, how the frontend and backend find each other, what happens when you type `pnpm dev`.
2. [`02-root-config.md`](02-root-config.md) — the workspace, the scripts, `.env`, the README.
3. [`03-backend.md`](03-backend.md) or [`04-frontend.md`](04-frontend.md) — whichever half you are touching.
4. [`08-gaps-and-findings.md`](08-gaps-and-findings.md) — what is broken, what is missing, what to fix first.

---

## All documents

| # | Document | Covers |
|---|---|---|
| 01 | [Repo Anatomy](01-repo-anatomy.md) | Full file tree · the three `package.json` roles · the frontend↔backend wiring · the `.env` triangle · the `pnpm dev` startup sequence |
| 02 | [Root Config](02-root-config.md) | Root `package.json` field by field · the script call-chain · `pnpm-workspace.yaml` · `.npmrc` · `.gitignore` · a `.env.example` and README skeleton |
| 03 | [Backend](03-backend.md) | `backend/src/server.js` annotated · `backend/package.json` · the `GET /api/health` request lifecycle · what the backend still needs |
| 04 | [Frontend](04-frontend.md) | The render chain · `login.jsx` in depth · `vite.config.js` · the SVG primer · known frontend issues |
| 05 | [Styles](05-styles.md) | `login.css` rule by rule · design-token table · layout anatomy · responsive behaviour · CSS concepts primer |
| 06 | [Dependencies](06-dependencies.md) | Every package: what, why, where used, gotcha · pnpm workspace mechanics · semver primer · declared-but-not-installed table · install cheatsheet |
| 07 | [CI & Security](07-ci-and-security.md) | `codeql.yml` block by block · the `dependabot.yml` bug and its fix · security posture table · suggested CI additions |
| 08 | [Gaps & Findings](08-gaps-and-findings.md) | Severity-ranked audit: what is broken, buggy, risky or simply not built yet · accessibility findings · docs-vs-code delta · a suggested fix order |

---

## The 60-second summary of this codebase

**What it is:** a pnpm monorepo with two workspaces — a React 18 + Vite frontend
and an Express 4 backend.

**What works:** both halves boot. `pnpm dev` starts them together. The frontend
renders one screen — a combined sign-in / register card with an inline SVG
illustration. The backend serves exactly one route, `GET /api/health`. A Vite dev
proxy forwards `/api` from `:3000` to `:5000`, so they can talk.

**What does not exist yet:** any database, any authentication, any real API route,
any form submission, any router, any tests. The login form is a visual mock — it
sends nothing anywhere.

**Size:** 4 source files with logic, 1 stylesheet, 2 empty placeholder files,
5 config files, 2 CI files.

```text
        BROWSER                VITE :3000              EXPRESS :5000
     login.jsx (UI)  ──/api──►  dev proxy  ──────────►  GET /api/health
     (sends nothing today)                              → {status:'ok'}
```

---

## Quick reference

### Run it

```bash
pnpm install          # first time — nothing is installed yet
pnpm dev              # both halves, one terminal
pnpm dev:backend      # just Express  → http://localhost:5000
pnpm dev:frontend     # just Vite     → http://localhost:3000

curl http://localhost:5000/api/health   # {"status":"ok", ...}
```

> `pnpm lint` **fails today** — ESLint is installed but no config file exists.
> See [`08-gaps-and-findings.md §1.1`](08-gaps-and-findings.md).

### The numbers that matter

| Fact | Value | Where |
|---|---|---|
| Frontend port | `3000` | `frontend/vite.config.js` |
| Backend port | `5000` (or `$PORT`) | `backend/src/server.js` |
| Proxy target | `http://localhost:5000` — **hardcoded** | `frontend/vite.config.js` |
| Env file | `<repo root>/.env` — shared by both halves, gitignored, **does not exist yet** | — |
| Package manager | pnpm only — `npm install` is blocked by `preinstall` | root `package.json` |

---

## About the comments in the source

Every source file in this repo now carries teaching-level comments explaining what
each line does and why. Those edits were **comments only** — verified mechanically:

```text
  OK  backend/src/server.js          --  18 executable lines, byte-identical
  OK  frontend/app.jsx               --  10 executable lines, byte-identical
  OK  frontend/index.html            --  12 executable lines, byte-identical
  OK  frontend/main.jsx              --   8 executable lines, byte-identical
  OK  frontend/src/pages/login.css   -- 201 executable lines, byte-identical
  OK  frontend/src/pages/login.jsx   -- 134 executable lines, byte-identical
  OK  frontend/vite.config.js        --  15 executable lines, byte-identical

  node --check backend/src/server.js   -> PASS
  node --check frontend/vite.config.js -> PASS
```

Comments were stripped from both the committed version and the current version, and
the remaining executable lines compared. **No behaviour changed.** No bug found
during this pass was fixed — every one is documented in
[`08-gaps-and-findings.md`](08-gaps-and-findings.md) with a proposed fix you can
review and apply deliberately.

---

## Related

- [`../learn/00-index.md`](../learn/00-index.md) — prompt, context, loop and graph
  engineering: how to drive AI coding agents well, using this documentation job as
  the worked example.
- `../01-product-requirements.md` · `../02-technology-stack.md` · `../03-system-design.md`
  — the product plan. Mostly not built yet; see the delta table in
  [`08-gaps-and-findings.md §6`](08-gaps-and-findings.md).
