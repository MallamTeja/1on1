# Comment every line of code, saying why

- **Status:** accepted
- **Date:** 2026-09-08
- **Decided by:** Teja

## Context

Teja learns from worked examples in his own code, not from abstract theory
(`~/.claude/CLAUDE.md`, "Who I am"). At 10:47 he made it a standing rule:
*"remember that we need to comment each line of code"*, recorded in local
memory, the global `CLAUDE.md`, and the project `CLAUDE.md`.

Before writing it down, the orchestrator measured what the codebase already
did (comment lines ÷ code lines, `grep`-counted):

| File | Ratio |
|---|---|
| `backend/src/repositories/userRepository.js` | 1.65 |
| `backend/src/lib/session.js` | 1.43 |
| `backend/src/routes/auth.js` | 1.30 |
| `frontend/src/lib/api.ts` | 0.83 |
| `frontend/src/pages/Login.tsx` | 0.12 |
| `frontend/src/pages/Landing.tsx` | 0.02 |

Hand-written backend code already carried *more comment than code*. The
donor-ported frontend — nine files copied byte-for-byte from `1on1_sb` plus
two lightly de-Java-fied pages — did not.

## Decision

Every statement, declaration and block carries a comment saying **why** it
is there, not what it does. Structural lines (`}`, blanks, closing tags) are
the only exception. Applies to `.js`, `.ts`, `.tsx`, `.css`, `.sql`, `.html`,
migrations and tests. Calibration target: ≥ 1 comment line per code line,
which is what the hand-written backend already does. Every worker is briefed
with the rule *before* writing a line.

"Each line" is read as *each statement*, not literally every physical line —
stated as an interpretation Teja can override.

## Alternatives considered

- **Comment only the non-obvious.** The industry default. Rejected because
  it optimises for a reader who already knows the idiom; Teja is deliberately
  the reader who doesn't yet, and "obvious" is exactly what he wants
  explained.
- **Doc-comments on functions only (JSDoc).** Rejected: explains the
  contract, not the line-level *why* — the rejected alternative, the race
  being avoided, the browser rule being obeyed.
- **Literal every-physical-line.** Rejected as noise: a comment on `}`
  teaches nothing and buries the ones that do.

## Consequences

- New code from Parcels A/B/C and the link checker lands at house density
  from the start. Three peers were mid-task when the rule arrived and got an
  addendum — a rule that arrives after the code is written is a rework pass.
- **A retro-commenting pass over `frontend/src` is owed.** It must be its
  own parcel with its own write ownership; bundled into a bug fix it makes
  the diff unreviewable.
- The **md5-identical-to-donor** verification used for the frontend port is
  superseded: those files are now `1on1`'s and will diverge from `1on1_sb`
  as they are commented. "Is it byte-identical to the donor" stops being a
  valid test.
- Diffs get longer. Reviews should read the comments as part of the change,
  because a wrong *why* is a bug that compiles.
- Workers report a measured density, not a claim (`1on1-11` proposed this;
  adopted).

## Evidence

- Teja, 2026-09-08 10:47 IST.
- Ratios measured 2026-09-08 with
  `grep -cE "^\s*(//|/\*|\*|\{/\*)"` vs total minus blank lines, per file.
- Rule text: `~/.claude/CLAUDE.md` rule 7; `1on1/CLAUDE.md` "Code commenting
  — house style"; memory `comment-every-line-of-code.md`.
