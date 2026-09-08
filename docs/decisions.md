# Decisions — index

Every non-trivial decision in `1on1` gets a record here, written **by whoever
made it, at the time they made it**. Teja asked for this on 2026-09-08 so the
*why* survives the chat window that produced it.

## How this is organised — and why not one big file

The pattern is **Architecture Decision Records** (ADRs, Michael Nygard 2011):
one short file per decision, immutable once accepted, superseded rather than
edited. Two local adaptations, both forced by how this repo is worked on:

- **One file per decision, under `docs/decisions/`.** Up to five Claude
  sessions write this tree at once. Every collision in the project's history
  came from two workers touching one shared file (`frontend/package.json`,
  `pnpm-lock.yaml`, root `package.json`). A single `decisions.md` that every
  session appends to would be the next one. Separate files are collision-free
  by construction — *write-ownership partitioning* applied to documentation.
- **Filenames are `YYYY-MM-DD-<slug>.md`, not `0007-<slug>.md`.** Sequence
  numbers collide when two parallel writers both pick "next". Dates don't.
  Cite a decision by its slug.
- **This index is orchestrator-owned.** Workers create their record and
  report the title + filename; the orchestrator adds the row. That keeps the
  index the one place where two writers *would* otherwise meet.

### Template

```markdown
# <Title as a decision, e.g. "Rotate refresh tokens in one SQL statement">

- **Status:** proposed | accepted | superseded by `<slug>`
- **Date:** YYYY-MM-DD
- **Decided by:** Teja | orchestrator | <session name> (with Teja's approval if it cost money or is irreversible)

## Context
What was true, what was at stake, what forced a choice now.

## Decision
One paragraph. What we do.

## Alternatives considered
The rejected options and the one-line reason each lost. This is the most
valuable section — it is what stops the decision being re-litigated.

## Consequences
What gets easier, what gets harder, what must now be true elsewhere.

## Evidence
File paths, line numbers, measurements, commands run. Claims without
evidence are hypotheses (see `~/.claude/CLAUDE.md` rule 6).
```

Keep records short. A decision that needs a long document gets a short ADR
*pointing at* that document — the ADR is the index card, not the book.

---

## Records

| Date | Decision | Status | Decided by | File |
|---|---|---|---|---|
| 2026-09-08 | Decision records: one file per decision, date-slug names | accepted | Teja + orchestrator | [decision-records-one-file-per-decision](decisions/2026-09-08-decision-records-one-file-per-decision.md) |
| 2026-09-08 | PostgreSQL engine is settled; RDS hosting re-opened on cost | accepted (engine) / superseded by Lightsail | Teja | [postgresql-engine-settled-hosting-reopened](decisions/2026-09-08-postgresql-engine-settled-hosting-reopened.md) |
| 2026-09-08 | Hosting settled: AWS Lightsail VPS for Backend/DB, Vercel for Frontend | accepted | Teja | [hosting-settled-lightsail-vps-and-vercel](decisions/2026-09-08-hosting-settled-lightsail-vps-and-vercel.md) |
| 2026-09-08 | Comment every line of code | accepted | Teja | [comment-every-line-of-code](decisions/2026-09-08-comment-every-line-of-code.md) |
| 2026-09-08 | Peer sessions write; subagents are read-only recon | accepted | Teja | [peers-write-subagents-read-only](decisions/2026-09-08-peers-write-subagents-read-only.md) |
| 2026-09-08 | Local PostgreSQL 18 is the test target, not the app's database | accepted under stated assumption | orchestrator | [local-postgres-is-test-target-only](decisions/2026-09-08-local-postgres-is-test-target-only.md) |

### Being written now — not yet files (do not cite until the row above has a link)

| Decision | Owner | Parcel |
|---|---|---|
| Pool sizing and Lambda auto-detection | `1on1-11` | A |
| SSL as three postures, not a boolean | `1on1-11` | A |
| Database/role naming `oneonone_node_*` | `1on1-11` | A |
| `DATABASE_URL` blanked in the test harness child env | `1on1-11` | A |
| App-generated UUIDv7 over DB defaults | `1on1-11` | A |
| Refresh rotation as one CTE statement | `1on1-59` | B |
| `LOWER(email)` expression index over a normalised column | `1on1-59` | B |
| Insert-and-catch over check-then-insert for register | `1on1-59` | B |
| Reuse detection on the refresh failure path | `1on1-59` | B |
| `rotateRefreshToken` replaces `consumeRefreshToken` | `1on1-59` | B |
| `node-pg-migrate` with verbatim `pgm.sql()` | `1on1-2a` | C |
| Backend as always-on container, not Lambda | `1on1-2a` (proposed — Teja to rule) | C |
| Same 87 tests run in two modes | `1on1-2a` | C |
| Cloud Postgres at 18.x, not 17.11 | `1on1-2a` (proposed — Teja to rule) | C |
| `.gitattributes` `eol=lf` | `1on1-2a` | C |
| Plain `CREATE INDEX` in initial migrations | `1on1-2a` | C |
| Zero-dependency link checker over a test runner | `1on1-91` | — |
| Route extraction by regex, not import | `1on1-91` | — |
| Allowlist-with-reasons for known placeholders | `1on1-91` | — |

### Backfill owed — decisions made before this log existed

These were made 2026-09-05 → 2026-09-07 and are recorded only in
`CLAUDE.md`, the handoff doc, or code comments. Each deserves a record; none
has one yet. Unassigned.

- Frontend adopts TypeScript; React stays on 18 (2026-09-05)
- RDS PostgreSQL chosen (2026-09-06) — *now superseded by the hosting re-open above; the record should say so*
- `bcryptjs` over native `bcrypt` (the two build-allowlists)
- `jose` replaces `jsonwebtoken` + `jwks-rsa`
- `node:test` + `node:assert`, zero test dependencies
- Auth behind a repository seam while the DB decision was open
- CORS: origin function with allowlist, not `*`
- Google OAuth tested hermetically via a stubbed JWKS
- ESLint 10 flat config
- `.npmrc` / `pnpm-workspace.yaml` build allowlist = `esbuild` only
- Handoff docs are wanted (reversal of an older preference, 2026-09-07)
