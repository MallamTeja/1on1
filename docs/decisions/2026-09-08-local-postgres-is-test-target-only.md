# Local PostgreSQL 18 is the test target, not the application's database

- **Status:** accepted under a stated assumption — Teja has not objected; say so if this is wrong
- **Date:** 2026-09-08
- **Decided by:** orchestrator, after Teja ruled "cloud db only"

## Context

Teja ruled out local Postgres as the application's database ("i wanna use
cloud db only"). But the data layer's test strategy — the same 87 tests run
twice, once against the in-memory fake and once against real Postgres —
needs *some* Postgres to run against on this machine, and the cloud one does
not exist yet and will never be the right place to run a test suite from a
laptop.

PostgreSQL **18.6** is already installed and running locally (service
`postgresql-x64-18`, port 5432). It hosts the legacy `1on1_sb` database
`oneonone_dev` and two unrelated databases.

## Decision

The local server is used **only** as the target for `pnpm test:pg` and for
verifying migrations before they run anywhere real. It holds two databases
created for this purpose — `oneonone_node_dev` and `oneonone_node_test`,
owned by role `oneonone_node_app` — and nothing the application would ever
read in production. Real application data lives in the cloud database once
hosting is decided.

This is the ordinary dev/prod split and does not contradict "cloud only",
which was a statement about where the *application's* data lives.

## Alternatives considered

- **Run the suite against the cloud database.** Rejected: slow from a
  laptop, dirties a shared database with test rows, and impossible today
  because it doesn't exist.
- **In-memory fake only, no Postgres tests.** Rejected: the Postgres
  repository is the one that will run in production, and it would be covered
  only by new tests while the 87 hardest-won assertions never touch it. The
  repository seam exists to have two implementations; testing one is testing
  half a seam.
- **Reuse `oneonone_dev`.** Rejected: it belongs to `1on1_sb`, and the
  project's naming rule forbids one name meaning two things.
- **Docker Postgres.** Rejected as redundant: a native server is already
  running, and Docker Desktop is not known to be installed.

## Consequences

- Creating the two databases and the role is a **human step**: the local
  superuser password is not available to agent sessions (a peer's read of
  the legacy `.env` was denied, correctly, and not routed around). Parcel A
  hands Teja a ready-to-run SQL file.
- **Version skew is real and must be managed.** Local is 18.6; the RDS plan
  said 17.11. The schema is portable, but 18-only SQL (`uuidv7()`) would pass
  locally and fail in the cloud. Two guards: no `uuidv7()` in SQL (IDs are
  app-generated), and a *proposal* — recorded separately by Parcel C — to run
  the cloud database at 18.x.
- `.env` at the repo root (gitignored) carries `DATABASE_URL` and
  `TEST_DATABASE_URL` pointing at the two local databases with the app-role
  credential, never the superuser's.
- `CLAUDE.md` records that local Postgres exists and is *not the plan*, so
  no future session proposes it as the destination again.

## Evidence

- Teja, 2026-09-08 ≈ 10:39 IST.
- Local server inventory: read-only recon 2026-09-08 — `SELECT version()` →
  `PostgreSQL 18.6 on x86_64-windows`; databases `oneonone_dev`, `django`,
  `Automation_Meta_Ads`, `postgres`; HBA `scram-sha-256` on all rules;
  `ssl = off`.
- Test harness constraint: `backend/tests/helpers/serverProcess.js` spawns
  the server as a child process, so transactional rollback fixtures are
  impossible and a real database is the only Postgres test target.
