# Link checker matches `:param` and `*` splat routes ahead of need

- **Status:** accepted
- **Date:** 2026-09-08
- **Decided by:** `1on1-91` (link-checker worker session) — a scope addition beyond the orchestrator's brief, recorded so it can be challenged

## Context

Every route in `frontend/src/App.tsx` is static today (`/`, `/login`,
`/register`). The comment at App.tsx:16-18 lists what is still unported from
`1on1_sb`: `/dashboard`, `/feed`, `/search`, `/profile` and the meeting room —
and profile pages are param routes (`/profile/:username`). A checker that
reports `/profile/teja` as DEAD on the day the first param route lands is a
false positive, and a gate that cries wolf once gets disabled.

## Decision

`routeMatches()` compares segment by segment: a `:param` segment accepts any
one segment, a trailing `*` accepts any remainder, lengths must otherwise
agree exactly, and trailing slashes are ignored. Roughly ten lines, covered by
a synthetic fixture in the test harness so the behaviour is proven rather than
assumed.

## Alternatives considered

- **Exact string comparison (strict YAGNI)** — simplest, but fails on the first
  ported page. The cost of the ten lines is lower than the cost of one false
  DEAD.
- **`import { matchPath } from "react-router"`** — exact router semantics
  (optional segments, case rules) and no *new* dependency since it is already
  installed. Rejected for now because it drags React into a CLI tool at
  runtime and slows startup for two syntaxes ten lines already handle. This is
  the right upgrade if optional segments (`/x/:id?`) or case-insensitivity ever
  matter.

## Consequences

- The matcher covers the subset of React Router path syntax actually used and
  must be extended if new syntax appears; the fixture test is the guard.
- Query strings and hashes on absolute targets are stripped before matching,
  so `/login?next=/x` passes when `/login` exists — the same rule the router
  applies.

## Evidence

- `frontend/scripts/check-links.mjs` — `segments()`, `routeMatches()`.
- Synthetic fixture (session scratchpad, `params/frontend/src`): App.tsx with
  `/`, `/u/:username`, `/docs/*`; harness tests 10-12 pass: `/u/teja` ok,
  `/docs/a/b/c` ok, `/u/teja/extra` DEAD, bare `#` DEAD, 2 external counted,
  template literal unchecked.
- `frontend/src/App.tsx:16-18` — the list of unported routes.
