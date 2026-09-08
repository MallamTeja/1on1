# Known placeholders are allowlisted with a reason, keyed by target + file

- **Status:** accepted
- **Date:** 2026-09-08
- **Decided by:** `1on1-91` (link-checker worker session); the allowlist mechanism was specified by orchestrator `1on1-4b`, the keying and stale-entry behaviour by the worker

## Context

`href="#reset"` in `frontend/src/pages/Login.tsx` is a deliberate placeholder:
the TODO directly above it says `/forgot-password` needs a backend flow that
mails a single-use reset token. It is known-broken and staying. A gate that
fails on it blocks every commit until that flow exists, so people would
disable the gate. A gate that silently skips it lets it be forgotten. During
this very session the line moved three times (182 → 213 → 240) as a peer
edited the file above it.

## Decision

`KNOWN_PLACEHOLDERS` at the top of `frontend/scripts/check-links.mjs` is an
array of `{ target, file, reason }`. It is applied *after* classification, not
instead of it, so:

- a dead allowlisted target prints as `allowed (placeholder: <reason>)` and does
  not fail the run — visible every run, never blocking;
- an allowlisted target that now resolves prints `ok … allowlist entry is now
  redundant, remove it`;
- an entry that matched nothing prints a `warning: allowlist entry never matched`
  line.

Entries are keyed by target + file, never by line number. Seeded with exactly
one entry: `#reset` in `src/pages/Login.tsx`.

## Alternatives considered

- **Silent skip (hard-coded ignore)** — invisible; the placeholder is forgotten
  and the ignore rots.
- **No allowlist, fail on it** — blocks all commits on an unrelated feature
  gap; the predictable outcome is the check gets removed.
- **Inline suppression comment (`// check-links-ignore`) beside the link** —
  puts the suppression in a file owned by another session, and spreads
  policy across the codebase instead of one reviewable list.
- **Line-keyed entries (`Login.tsx:182`)** — would have rotted twice within
  the hour it was written.
- **Stale entry fails the run (exit 1)** — stricter and probably right once the
  list grows, but the brief fixed the contract as "exit 1 only on a dead
  target". Recorded as the recommended tightening, not done.

## Consequences

- Adding a placeholder requires writing a reason. That friction is the point.
- The report shows the placeholder on every run, so `#reset` cannot be lost.
- When `/forgot-password` ships, the checker itself says the entry is redundant.
- The `file` field uses the report's own path form (frontend-relative, forward
  slashes), so an entry can be copied from a failing line verbatim.

## Evidence

- `frontend/src/pages/Login.tsx` — TODO on the two lines above `href="#reset"`.
- Working-tree run 2026-09-08: `src/pages/Login.tsx:240  #reset  → allowed
  (placeholder: …)`, exit 0. HEAD fixture run: same target at line 182, also
  allowed, while `/dashboard` at Landing.tsx:527 was DEAD and exit was 1.
- Harness tests 2, 4 and 11 cover allowed, still-allowed-after-move, and bare
  `#` (empty id) correctly DEAD.
