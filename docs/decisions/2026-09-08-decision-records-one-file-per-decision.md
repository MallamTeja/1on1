# Keep decision records as one file per decision, named by date and slug

- **Status:** accepted
- **Date:** 2026-09-08
- **Decided by:** Teja asked for a decisions log; the orchestrator chose the shape

## Context

Teja asked (10:56) for a `decisions.md` that he and every peer session write
to, documenting decisions as they are made. At that moment five sessions were
writing the tree concurrently. The project's recorded history has one
recurring failure: every write collision came from a shared file that two
concerns both needed (`frontend/package.json`, `pnpm-lock.yaml`, root
`package.json` — see `docs/handoff/2026-09-07-orchestrator-handoff.md` §2).
A single append-only log that every session writes is that failure with a
new filename.

## Decision

- `docs/decisions.md` is an **index**, owned by the orchestrator only.
- Each decision is its own file under `docs/decisions/`, named
  `YYYY-MM-DD-<slug>.md`.
- Whoever makes a decision writes its record, then reports title + filename;
  the orchestrator adds the index row. Workers never edit the index.
- Records follow the Nygard ADR shape plus two fields Teja's working style
  demands: **Decided by** and **Evidence**.
- Records are not edited after acceptance; a change is a new record whose
  status line reads `superseded by <slug>` on the old one.

## Alternatives considered

- **One `decisions.md` everyone appends to.** Rejected: guaranteed
  concurrent-write collision; also makes `git blame` useless for "who decided
  this".
- **Numbered ADRs (`0007-slug.md`).** The conventional form. Rejected:
  two parallel writers both pick "next number" and collide. Dates cannot
  collide across writers on the same day *unless the slug also matches*,
  which means they made the same decision — a useful signal, not a bug.
- **Decisions only in `CLAUDE.md`.** Rejected: `CLAUDE.md` is loaded into
  every session's context, so it must stay short; and it records the *current
  rule*, not the reasoning or the rejected paths.
- **Decisions only in chat.** Rejected by Teja's standing rule 3: terminal
  output scrolls away and isn't versioned.

## Consequences

- Parallel sessions can each record decisions with zero coordination.
- The index can lag the files by minutes; a decision exists once its file
  does, not once it's indexed.
- Old decisions (2026-09-05 → 07) have no records. A backfill is owed and is
  listed in the index.
- The handoff doc's "decisions settled" list (§ *Teja's decisions*) becomes
  derivative of this log and should point here rather than restate.

## Evidence

- Collision history: handoff doc §2 and §7.
- The pattern: Michael Nygard, "Documenting Architecture Decisions" (2011).
- The write-ownership rule this applies: `~/.claude/CLAUDE.md` standing
  expectation 4.
