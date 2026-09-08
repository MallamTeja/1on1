# `check:links` is standalone now; fold it into `lint`, not `build`, as the follow-up

- **Status:** accepted (standalone script) / proposed (folding into `lint` — needs Teja or the orchestrator, since it edits an existing line of `frontend/package.json`)
- **Date:** 2026-09-08
- **Decided by:** `1on1-91` (link-checker worker session); recommendation only for the fold-in

## Context

A check nobody runs re-opens the gap it was built to close — that is precisely
how the two dead links survived. `frontend/package.json` today has `typecheck`
(`tsc -b --noEmit`), `lint` (`eslint . --max-warnings 0`) and `build`
(`tsc -b && vite build`). The worker's write authority on that file was exactly
one added line.

## Decision

Added `"check:links": "node scripts/check-links.mjs"` as a standalone script.
Recommendation: change `lint` to
`eslint . --max-warnings 0 && node scripts/check-links.mjs`, keeping
`check:links` for targeted runs. Reasoning: `lint` is the static-correctness
gate that already runs on every change, a dead link *is* a static-correctness
defect, and it should fail at the same stage as an ESLint error — before
anything is built.

## Alternatives considered

- **Fold into `build`** — build runs rarely on a dev machine, so feedback
  arrives late; a content-correctness problem failing a deploy step is the
  wrong layer; and `tsc -b && vite build` growing a third stage slows the one
  command that is already slowest.
- **Leave standalone only** — the failure mode this tool exists to prevent.
  Nobody runs an optional check.
- **New `check` aggregate (`typecheck && lint && check:links`)** — cleanest
  semantically, but introduces a convention no CI calls yet. The right home
  once a CI workflow exists; until then, `lint` is what people actually run.

## Consequences

- `lint` gets roughly 60 ms slower and its failures can now mean "dead link";
  the report line says exactly which file:line and why.
- ESLint's flat config only has rules for `**/*.{ts,tsx}`; `eslint .` parses
  `scripts/check-links.mjs` via its default `**/*.mjs` pattern but applies no
  rules to it. Adding a `files: ["scripts/**/*.mjs"]` block with
  `js.configs.recommended` and `globals.node` would lint the checker itself —
  a separate, optional edit to `eslint.config.js`.

## Evidence

- `frontend/package.json` diff 2026-09-08: one added line, `check:links`.
- `pnpm --filter 1on1-frontend run check:links` from the repo root: exit 0,
  22 targets, 0 dead.
- `pnpm --filter 1on1-frontend run lint` after adding the script: exit 0.
- `eslint --print-config scripts/check-links.mjs` → `"rules": {}` (parsed, no
  rules applied).
