# Link checker is a zero-dependency Node script, not a vitest/jest suite

- **Status:** accepted
- **Date:** 2026-09-08
- **Decided by:** `1on1-91` (link-checker worker session), on assignment from orchestrator `1on1-4b`; the zero-dependency constraint was set by the orchestrator, the shape of the tool by the worker

## Context

Two dead links survived the full UI migration from `1on1_sb`: `<Link to="/dashboard">`
in `frontend/src/pages/Landing.tsx` and `href="#reset"` in
`frontend/src/pages/Login.tsx`. Nothing could catch them: `tsc` and ESLint see a
string, and App.tsx's catch-all `<Route path="*">` turns every unknown path into
a silent redirect home rather than a 404. The frontend has no test runner
(`frontend/package.json` devDependencies contain none; `node_modules/.bin` has no
vitest/jest/mocha). `pnpm-lock.yaml` is the single most collision-prone file in
the repo while several sessions work the tree concurrently, so any new
dependency has a cost well beyond its own weight.

## Decision

`frontend/scripts/check-links.mjs` is a plain Node 24 ESM script using only
`node:fs`, `node:path` and `node:url`. It scans `frontend/src/**/*.{ts,tsx}` for
navigation targets, checks absolute paths against `<Route path>` declarations
in App.tsx and fragments against `id="…"` definitions, and exits 1 on any dead
target. Its correctness was proven with a `node:test` harness (built into Node,
zero dependencies) that ran against a `git archive HEAD` snapshot still carrying
the dead link, and had to fail there before a passing run on the fixed tree
counted for anything.

## Alternatives considered

- **vitest** — adds a devDependency and a lockfile change to run one check; the
  runner would be idle for everything else in the frontend.
- **jest** — same cost as vitest plus ESM configuration friction in a
  `"type": "module"` package.
- **Custom ESLint rule** — ESLint's model is one file at a time; "does this link
  in Landing.tsx match a route in App.tsx" is a cross-file check that needs
  shared state ESLint does not offer without a plugin scaffold.
- **Browser crawl (Playwright)** — needs a running app, is slow, and the
  catch-all route would answer 200 for every path anyway; the crawler would see
  a redirect, not a failure.
- **Importing the TSX** — see `2026-09-08-link-checker-regex-route-extraction`.

## Consequences

- No lockfile change; the check runs in well under a second.
- The ~40 lines of brace-aware JSX scanning are ours to maintain. A real parser
  would be more general; for string literals in ~20 files it is not needed.
- The `node:test` harness currently lives outside the repo (session
  scratchpad). Adding it as `frontend/scripts/check-links.test.mjs` with a
  `"test": "node --test scripts"` script is the natural follow-up and still
  costs zero dependencies — the backend already made exactly this call.
- The route and id extraction is text-based; its known limits are documented in
  the script header.

## Evidence

- `frontend/package.json` devDependencies: no test runner (checked 2026-09-08).
- `ls frontend/node_modules/.bin | grep -iE 'vitest|jest|mocha'` — empty.
- Node `v24.14.0`; `node:test` and `fs.readdirSync({ recursive })` are stable.
- Harness: 12 tests, 12 pass, against HEAD fixture, working tree and a
  synthetic param-route fixture.
- HEAD fixture run: `src/pages/Landing.tsx:527  /dashboard  → DEAD`, exit 1.
  Working tree run after peer `1on1-2a` removed the link: 22 targets, 0 dead,
  exit 0.
- Backend precedent: `node:test` + `node:assert` with zero test dependencies
  (listed in `docs/decisions.md` backfill).
