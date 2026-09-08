# Routes are extracted from App.tsx by text scan, not by importing the module

- **Status:** accepted
- **Date:** 2026-09-08
- **Decided by:** `1on1-91` (link-checker worker session), on assignment from orchestrator `1on1-4b`

## Context

The link checker needs the list of routes the app actually serves. That list
lives in `frontend/src/App.tsx` as `<Route path="…">` elements — TSX. A plain
Node script cannot import TSX: Node 24 strips TypeScript types natively but
does not transform JSX, and adding a transpile step (esbuild, tsx, vite-node)
would be a dependency and would make the checker depend on build order.

## Decision

`parseRoutes()` in `frontend/scripts/check-links.mjs` locates each `<Route`
opening tag with a small brace-aware scanner (so `element={…}` written before
`path` cannot hide it), reads `path="…"` with a regex, and drops the `*`
catch-all on purpose — the catch-all matches everything, so keeping it would
make every link "valid" and the check meaningless. Matching is segment-based:
`:param` accepts any one segment, a trailing `*` accepts any remainder, a
trailing slash is ignored, and `?query`/`#hash` are stripped before matching,
mirroring how React Router matches on pathname alone.

## Alternatives considered

- **Import App.tsx through esbuild / tsx / vite-node** — new dependency, plus
  the route list would then have to be recovered by rendering a React element
  tree; far more machinery than reading three string literals.
- **Move routes into a plain `src/routes.ts` data module and import that** —
  the better long-term shape: Node 24 can run a JSX-free `.ts` file directly,
  and App.tsx would map over the table. Rejected for now because it edits
  App.tsx (owned by another session during this work) and three routes do not
  yet justify a data module. Revisit when the ported pages land.
- **Import `matchPath` from `react-router` for exact matching semantics** — no
  new dependency (already installed) but pulls React into a CLI tool at
  runtime. Ten lines of segment matching cover the two syntaxes in use; see
  `2026-09-08-link-checker-param-route-matching`.

## Consequences

- No build step, no dependency, runs from any working directory.
- Known limits, documented in the script header: nested relative routes
  (`<Route path="settings">` under `/account`) are not joined to their parent;
  a dynamic `path={expr}` is invisible. Today there are none of either.
- If routes move to a data module later, `parseRoutes()` is the only function
  that changes.

## Evidence

- `frontend/src/App.tsx:25-28` — `/`, `/login`, `/register`, `*`.
- `frontend/scripts/check-links.mjs` — `parseRoutes()`, `routeMatches()`,
  `tagEnd()`.
- Synthetic fixture test: `/u/teja` matches `/u/:username`; `/docs/a/b/c`
  matches `/docs/*`; `/u/teja/extra` and `/login?next=/u/x#top` (no `/login`
  route in the fixture) are DEAD.
