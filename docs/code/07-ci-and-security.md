# 07 — CI and Security

Everything under `.github/` in this repository, plus an honest assessment of what is and is not protected today.

**Current state in one line:** two automation files exist — `.github/workflows/codeql.yml` (working) and `.github/dependabot.yml` (**broken**, empty `package-ecosystem`). Nothing builds, nothing tests, nothing deploys.

---

## 1. What CI/CD is, and what this repo actually automates

**Continuous Integration** is the practice of running automated checks against every change, on a machine that is not your laptop, before that change is merged. The value is not the checks themselves — you could run them locally — but that they run *unconditionally*, on a *clean* environment, on *someone else's* commits too. A check that only runs when a developer remembers to run it is not a control.

**Continuous Delivery/Deployment** extends that: once the checks pass, the artifact is built, published, and (for CD) released automatically.

This repo has GitHub Actions available and uses exactly one workflow.

| Automation | Status | File |
| --- | --- | --- |
| Static analysis (CodeQL) | ✅ Working | `.github/workflows/codeql.yml` |
| Dependency version updates | ❌ Configured but invalid | `.github/dependabot.yml` |
| Test job | ❌ None — no `test` script exists in any `package.json` |  |
| Build job | ❌ None — `frontend` has a `build` script, nothing runs it in CI |  |
| Lint job | ❌ None — and it would fail today (see §6) |  |
| Deploy job | ❌ None — no deployment target configured anywhere |  |
| Dependency audit in CI | ❌ None — `pnpm audit` is manual only |  |

So: **the only thing automated on every push is CodeQL scanning.** A pull request that breaks the build, breaks the frontend, or deletes half the backend will pass CI, because there is nothing to fail.

The full directory:

```
.github/
├── dependabot.yml            # dependency updates — broken (§4)
└── workflows/
    └── codeql.yml            # the only workflow (§2)
```

---

## 2. `.github/workflows/codeql.yml`, block by block

The file is GitHub's "CodeQL Advanced" starter workflow, committed unmodified in commit `3bc8c3c` (2026-07-31).

### Name

```yaml
name: "CodeQL Advanced"
```

The display name in the Actions tab and in PR check lists. Purely cosmetic — but it is the string a branch-protection rule would have to match if required checks were ever configured.

### Triggers

```yaml
on:
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]
  schedule:
    - cron: '35 8 * * 1'
```

Three independent triggers:

1. **`push` to `main`** — scans the code as it lands on the default branch. This is what keeps the Security tab's "current state" accurate.
2. **`pull_request` targeting `main`** — scans the *merge result* of the PR before it lands, and annotates newly introduced alerts directly on the diff. This is the trigger that actually prevents new vulnerabilities, as opposed to reporting them after the fact.
3. **`schedule`** — a weekly re-scan of unchanged code.

**Decoding `cron: '35 8 * * 1'`** — the five POSIX cron fields are `minute hour day-of-month month day-of-week`:

| Field | Value | Meaning |
| --- | --- | --- |
| minute | `35` | at minute 35 |
| hour | `8` | of hour 08 |
| day of month | `*` | any day of the month |
| month | `*` | any month |
| day of week | `1` | Monday (0 = Sunday) |

So: **08:35 UTC every Monday**. In IST (UTC+05:30) that is **14:05 (2:05 pm) every Monday**.

Why a scheduled scan at all, when push and PR already cover every change? Because CodeQL's *queries* change even when your code does not. A query pack update can find a vulnerability class in code that was scanned clean last month. The weekly run re-evaluates untouched code against the current rules.

Two GitHub-specific caveats worth knowing about `schedule`:

- The cron is always interpreted in **UTC** — it does not follow the repo owner's timezone, and does not shift for daylight saving.
- Scheduled workflows are **best-effort**, can be delayed under platform load (which is why the starter template uses an odd minute like `35` rather than `0`), and are **automatically disabled after 60 days of repository inactivity**.

### Job and runner

```yaml
jobs:
  analyze:
    name: Analyze (${{ matrix.language }})
    runs-on: ${{ (matrix.language == 'swift' && 'macos-latest') || 'ubuntu-latest' }}
```

One job, `analyze`. Its display name interpolates the matrix language, so with multiple languages you get one distinctly-named check per language: `Analyze (javascript-typescript)`.

The `runs-on` expression is GitHub Actions' idiom for a **ternary**, which the expression language does not have. It works through short-circuit evaluation:

- `A && B` returns `B` when `A` is truthy, and `A` (falsy) otherwise.
- `A || B` returns `A` when `A` is truthy, and `B` otherwise.

So when `matrix.language == 'swift'`, the first half evaluates to `'macos-latest'` (truthy) and `||` returns it. Otherwise the first half is `false`, and `||` falls through to `'ubuntu-latest'`.

**Why Swift needs macOS:** CodeQL analyses a compiled language by observing its real compiler as it builds. The Swift compiler and the Xcode toolchain it depends on are only supported on macOS, so the Swift extractor can only run on a macOS runner.

**In this repo the expression is vestigial.** The matrix (below) contains only `javascript-typescript`, so this always evaluates to `ubuntu-latest`. It is template code kept for the day another language is added.

### Permissions

```yaml
    permissions:
      # required for all workflows
      security-events: write

      # required to fetch internal or private CodeQL packs
      packages: read

      # only required for workflows in private repositories
      actions: read
      contents: read
```

Each job gets a scoped `GITHUB_TOKEN`. This block declares exactly what that token may do:

| Scope | Why this job needs it |
| --- | --- |
| `security-events: write` | The whole point of the job. `codeql-action/analyze` uploads its findings as a **SARIF** file to the code-scanning API; that upload requires write access to security events. Without it the job runs, finds everything, and fails at the last step. |
| `packages: read` | CodeQL query packs can be published to GitHub Packages. Needed to fetch private or internal packs; harmless for a repo using only the public default suite. |
| `actions: read` | Lets the job read workflow-run metadata. Required in **private** repositories so the analysis can be correctly associated with its run; unnecessary in public ones. |
| `contents: read` | Lets `actions/checkout` clone the repository. Read-only: this job never pushes a commit, a tag, or a branch. |

**Principle of least privilege.** A token should carry the smallest set of permissions that lets the job succeed, so that a compromised action — a typo-squatted dependency, a maintainer account takeover, an injected `run` step — has the smallest possible blast radius. `contents: read` instead of `contents: write` is the difference between an attacker reading your code and an attacker rewriting your default branch.

The important mechanical detail: **declaring a `permissions` block replaces the default token scopes entirely.** Every scope not listed becomes `none`, not "whatever the repo default was". That is why this block has to enumerate even the obvious ones like `contents: read` — omitting it would break `actions/checkout`.

### Strategy and matrix

```yaml
    strategy:
      fail-fast: false
      matrix:
        include:
        - language: javascript-typescript
          build-mode: none
```

**`fail-fast: false`** — by default, when one matrix leg fails, GitHub cancels every other in-flight leg. Turning it off means each language is analysed to completion regardless of the others, so one broken extractor does not hide findings in the languages that work. With a single-entry matrix it changes nothing today, but it is correct and free to keep.

**`matrix.include`** — one leg per (language, build-mode) pair:

- **`language: javascript-typescript`** — one CodeQL extractor covers JavaScript *and* TypeScript together, including `.jsx` and `.tsx`. That single value covers everything analysable in this repo: `backend/src/server.js` and the frontend's `app.jsx`, `main.jsx`, and `src/pages/*.jsx`. The other accepted values, per the comments in the file itself, are `actions`, `c-cpp`, `csharp`, `go`, `java-kotlin`, `python`, `ruby`, `rust`, and `swift`.
- **`build-mode: none`** — no build step is needed to produce the CodeQL database.

**Why `build-mode` exists.** CodeQL builds its database from source, but *how* it gets complete source depends on the language:

| Language kind | Examples | Build mode | Why |
| --- | --- | --- | --- |
| Interpreted / transpiled | JavaScript, TypeScript, Python, Ruby | `none` | The source on disk *is* the program. CodeQL scans the files directly. |
| Compiled | C/C++, C#, Go, Java/Kotlin, Swift | `autobuild` or `manual` | The extractor must watch a real compiler invocation to learn which files are actually compiled, with which flags, and how generated code is produced. |

This project is plain ESM JavaScript and JSX, so `none` is right — and it makes the job fast, because CI never has to install a single dependency to scan the code.

### Step 1 — checkout

```yaml
    steps:
    - name: Checkout repository
      uses: actions/checkout@v4
```

Clones the repository onto the runner at the exact commit that triggered the workflow (for a `pull_request` event, the simulated merge commit). Shallow by default (`fetch-depth: 1`), which is all a source scan needs. `@v4` is a **moving major tag**: patch and minor releases are picked up automatically, major upgrades are not. Pinning to a full commit SHA is the hardened alternative, at the cost of manual updates — one of the things Dependabot's `github-actions` ecosystem exists to automate (§4).

### Step 2 — initialize CodeQL

```yaml
    - name: Initialize CodeQL
      uses: github/codeql-action/init@v4
      with:
        languages: ${{ matrix.language }}
        build-mode: ${{ matrix.build-mode }}
        # queries: security-extended,security-and-quality
```

Downloads the CodeQL CLI bundle and the query packs, then creates an empty database and (for compiled languages) installs the build tracer. `languages` and `build-mode` come straight from the matrix leg. The commented `queries:` line is discussed in §3.

### Step 3 — the manual build step that never runs

```yaml
    - name: Run manual build steps
      if: matrix.build-mode == 'manual'
      shell: bash
      run: |
        echo 'If you are using a "manual" build mode for one or more of the' \
          'languages you are analyzing, replace this with the commands to build' \
          'your code, for example:'
        echo '  make bootstrap'
        echo '  make release'
        exit 1
```

**This step is inert.** Its `if:` condition compares `matrix.build-mode` to `'manual'`, and the only matrix leg sets `build-mode: none`. The condition is false on every run, so GitHub marks the step *skipped* and never executes the body.

> ⚠️ **Flag it.** The body ends in `exit 1`. It is a deliberate landmine from the starter template: it exists so that anyone who switches a language to `build-mode: manual` without replacing this placeholder gets an immediate, loud failure rather than a silently empty analysis. That is good design — but it means **the day someone changes `build-mode: none` to `manual` in the matrix, this job starts failing on every push until this step's body is replaced with a real build command.** If a compiled language is ever added here, edit this step in the same commit.

### Step 4 — analyze and upload

```yaml
    - name: Perform CodeQL Analysis
      uses: github/codeql-action/analyze@v4
      with:
        category: "/language:${{matrix.language}}"
```

Finalizes the database, runs the selected query suite against it, and uploads the results as SARIF to the code-scanning API — the call that needs `security-events: write`.

**`category`** labels the upload. Code scanning keys results on `(commit, category)`: two uploads sharing a category *replace* one another, while different categories *coexist*. Interpolating the matrix language gives every leg its own category (`/language:javascript-typescript`), so a multi-language matrix does not have each leg overwriting the last one's findings. It matters equally when a repo runs several scanners — CodeQL plus a third-party SARIF producer — against the same commit.

---

## 3. What CodeQL actually is

CodeQL is **semantic** code analysis, not pattern matching. The distinction is the whole point:

1. **Extraction.** The source is parsed into a relational database — not text, but tables of program facts: every expression, every function, every call edge, the control-flow graph, the data-flow graph, type information where it exists.
2. **Query.** Analyses are written in **QL**, a declarative, logic-programming query language, and executed against that database. A query is a *question about program structure*, so it can express things a regex fundamentally cannot: "is there any path, through any number of intermediate assignments, function calls, and array operations, from a value that came off an HTTP request to an argument of `child_process.exec`?"

That last question is **taint tracking** — following untrusted data from a *source* (request body, query string, header, file, environment) to a *sink* (a shell command, a SQL string, a filesystem path, an HTML sink). It is why CodeQL finds injection bugs that survive several layers of indirection, and why it produces far fewer false positives than grep-based scanners.

Vulnerability classes the default JavaScript/TypeScript suite covers include:

- **Injection** — command injection, SQL and NoSQL injection, code injection via `eval`
- **Cross-site scripting (XSS)** — reflected, stored, and DOM-based
- **Path traversal** — user input reaching `fs` calls or `res.sendFile`
- **Hardcoded credentials** — secrets and tokens embedded in source
- **Server-side request forgery (SSRF)** and open redirects
- **Prototype pollution** and unsafe deserialization
- **Regular-expression denial of service (ReDoS)** — catastrophic backtracking
- **Insecure randomness** for security-relevant values

**Where results appear.** The SARIF upload lands in the repository's **Security → Code scanning** tab, one entry per alert with the full data-flow path rendered step by step. On pull requests the same alerts appear as inline annotations on the changed lines. Alerts can be dismissed with a reason, and they close automatically when the underlying code is fixed.

### The commented-out `queries:` line

```yaml
        # queries: security-extended,security-and-quality
```

Uncommenting it changes which query suite runs:

| Suite | Contents | Trade-off |
| --- | --- | --- |
| `security` (the default, in force today) | High-precision security queries only | Very low false-positive rate; misses lower-confidence issues |
| `security-extended` | The default **plus** lower-precision, higher-recall security queries | Finds more real bugs; some findings need human triage |
| `security-and-quality` | `security-extended` **plus** maintainability and correctness queries | Broadest coverage; also flags dead code, redundant conditions, and other non-security issues |

For a codebase this small, `security-and-quality` is cheap to enable and the extra noise is manageable. On a large legacy codebase it can produce hundreds of alerts on day one, which is why the template leaves it commented.

**Note on what CodeQL can and cannot see here.** It scans first-party source; it does **not** audit your dependency tree — that is Dependabot's job, and Dependabot is currently broken (§4). It also cannot flag missing controls: it will not tell you that `backend/src/server.js` calls `app.use(cors())` with no origin allowlist (which permits `Access-Control-Allow-Origin: *` on every route), because permissive-CORS queries live outside the default suite. It will not tell you the API has no authentication, because absent code is invisible to a code scanner.

---

## 4. `.github/dependabot.yml` — and its bug

The file as it stands, in full:

```yaml
# To get started with Dependabot version updates, you'll need to specify which
# package ecosystems to update and where the package manifests are located.
# Please see the documentation for all configuration options:
# https://docs.github.com/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file

version: 2
updates:
  - package-ecosystem: "" # See documentation for possible values
    directory: "/" # Location of package manifests
    schedule:
      interval: "daily"
```

*(The live file has since been annotated with explanatory comments — see the note at the end of this section. Its values are unchanged.)*

### The bug: `package-ecosystem: ""`

> ### ❌ This configuration is invalid and does nothing.
>
> `package-ecosystem` is a **required** key and must be one of Dependabot's known ecosystem identifiers. An empty string matches none of them. Dependabot validates `dependabot.yml` when it changes; a config error means the entry is rejected, an error is surfaced under **Insights → Dependency graph → Dependabot**, and **no version-update pull request is ever opened**. The file looks like dependency management is configured. It is not.

The trailing comment `# See documentation for possible values` gives the bug away: this is GitHub's web-UI template with the placeholder never filled in. The git history confirms it — commit `36af1bf` ("Create dependabot.yml", 2026-07-31) added the file straight from the template, and no commit has touched it since.

There is a direct precedent in this repo for the same mistake being caught and fixed: `pnpm-workspace.yaml` was committed with the literal placeholder `esbuild: set this to true or false`, and commit `87a85c9` replaced it with `true`. The Dependabot placeholder never got its equivalent commit.

### The correct value: `"npm"`

For this repository the value is **`"npm"`**. Dependabot's `npm` ecosystem is the JavaScript ecosystem as a whole — it covers **npm, Yarn, pnpm, and Bun**, and it selects the right resolver by detecting which lockfile is present. This repo has `pnpm-lock.yaml` at the root, so Dependabot uses its pnpm handling. There is no separate `"pnpm"` value; using one would be as invalid as the empty string. ([Dependabot options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference))

**Honest caveat on pnpm workspace support.** pnpm is supported under the `npm` ecosystem, but pnpm *workspaces* specifically have known rough edges in `dependabot-core`, and this repo is a pnpm workspace:

- [dependabot-core#11135](https://github.com/dependabot/dependabot-core/issues/11135) — when updates are split by `directory` in a pnpm workspace, the shared root `pnpm-lock.yaml` is not updated in the resulting PRs.
- [dependabot-core#10758](https://github.com/dependabot/dependabot-core/issues/10758) — Dependabot inspects each workspace package, finds no lockfile in that directory (pnpm keeps one lockfile at the root), concludes there is no work, and opens nothing.
- [dependabot-core#11953](https://github.com/dependabot/dependabot-core/issues/11953) — `pnpm-workspace.yaml` catalog entries are not updated alongside the lockfile.

So the honest expectation is: setting `package-ecosystem: "npm"` is necessary and correct, but **verify that PRs actually appear** rather than assuming it. If the per-directory entries below produce nothing, fall back to `directory: "/"` alone — the root entry sees the root `package.json` and the shared lockfile, which is the configuration least affected by the issues above.

### The workspace implication

There are **three** `package.json` files in this repo:

| Manifest | Package name | Dependencies |
| --- | --- | --- |
| `package.json` | `1on1` | `concurrently` |
| `backend/package.json` | `1on1-backend` | `express`, `cors`, `dotenv`, `nodemon` |
| `frontend/package.json` | `1on1-frontend` | `react`, `react-dom`, `vite`, `eslint`, plugins |

…and exactly **one** lockfile, `pnpm-lock.yaml`, at the root.

`directory: "/"` points Dependabot at the root manifest only. As written it would — assuming the ecosystem were valid — watch `concurrently` and nothing else. **Every dependency that actually ships to users, and every dependency with a meaningful CVE surface, lives in `frontend/` and `backend/`, where Dependabot is not looking.**

### Suggested corrected configuration

**Form A — one entry using `directories` (plural).** `directories` accepts a list and supports globbing; `directory` (singular) accepts one path and does not.

```yaml
version: 2

updates:
  # ---- JavaScript dependencies (npm ecosystem covers pnpm) ----------------
  - package-ecosystem: "npm"
    directories:
      - "/"            # root: concurrently
      - "/frontend"    # react, react-dom, vite, eslint
      - "/backend"     # express, cors, dotenv, nodemon
    schedule:
      interval: "weekly"
      day: "monday"
    open-pull-requests-limit: 5
    groups:
      # One PR for all patch/minor bumps instead of one PR per package.
      minor-and-patch:
        applies-to: version-updates
        update-types: ["minor", "patch"]
      # Keep the React pair in lockstep — they must move together.
      react:
        patterns: ["react", "react-dom", "@types/react", "@types/react-dom"]
      # Vite and its plugins likewise.
      vite:
        patterns: ["vite", "@vitejs/*"]
    commit-message:
      prefix: "deps"
      prefix-development: "deps-dev"

  # ---- GitHub Actions used by .github/workflows/codeql.yml ---------------
  # Keeps actions/checkout and github/codeql-action from silently going stale.
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    open-pull-requests-limit: 3
    groups:
      actions:
        patterns: ["*"]
```

**Form B — three separate `updates:` entries.** More verbose, but each directory gets its own schedule, limits, and grouping, and it works on older Dependabot behaviour that predates `directories`.

```yaml
version: 2

updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 3
    groups:
      root-deps:
        patterns: ["*"]

  - package-ecosystem: "npm"
    directory: "/frontend"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    groups:
      react:
        patterns: ["react", "react-dom", "@types/react", "@types/react-dom"]
      vite:
        patterns: ["vite", "@vitejs/*"]
      lint:
        patterns: ["eslint", "eslint-plugin-*"]

  - package-ecosystem: "npm"
    directory: "/backend"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    groups:
      backend-deps:
        patterns: ["*"]

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

### Why the other changes

| Key | Current | Suggested | Reason |
| --- | --- | --- | --- |
| `schedule.interval` | `"daily"` | `"weekly"` | Daily on a repo this size produces a steady drip of PRs nobody reviews, and unreviewed dependency PRs are worse than none — they train you to merge without looking. Weekly batches them. |
| `open-pull-requests-limit` | unset (**default 5**) | explicit | Caps concurrent version-update PRs. Setting it to `0` is the documented way to pause version updates without deleting the config. |
| `groups` | none | several | Collapses many single-package PRs into a few themed ones. Also *required for correctness* in places: `react` and `react-dom` must move together, and Vite's plugins track Vite's major. Ungrouped, Dependabot can open a `react` PR whose CI passes and a `react-dom` PR whose CI passes, which merge into a broken combination. |
| `github-actions` ecosystem | absent | added | `codeql.yml` pins `actions/checkout@v4` and `github/codeql-action@v4`. Nothing currently tells you when those majors move — or when one of them ships a security fix. |
| `commit-message.prefix` | unset | `deps` / `deps-dev` | Makes dependency commits trivially filterable in `git log` and in changelog tooling. |

> **Not applied.** The live `.github/dependabot.yml` keeps its current values verbatim — `package-ecosystem: ""` included — because the point of this documentation set is to describe what the repo *is*, not to silently change it. The file has been annotated with `#` comments (YAML comments only; no value touched) that flag the empty ecosystem inline and point back here. Applying the fix is a separate, deliberate commit.

### Also worth knowing

Dependabot has **two independent features**, and this file configures only one:

| Feature | Configured by | Status here |
| --- | --- | --- |
| **Version updates** — routine bumps to the newest release | `.github/dependabot.yml` | Present but invalid |
| **Security updates / alerts** — PRs and alerts for dependencies with known CVEs | A repository setting (Settings → Code security), *not* this file | **Unknown** — cannot be determined from repo contents |

Security alerts do not require a working `dependabot.yml`. If the repository toggle is on, CVE alerts are already flowing regardless of the bug above. Nothing in the checked-in files reveals which toggles are set, so this document does not claim either way.

---

## 5. Security posture

| Control | Present? | Detail and gap |
| --- | --- | --- |
| **Dependency version updates** | ❌ Broken | `.github/dependabot.yml` exists but `package-ecosystem` is `""` → config error, zero PRs opened. Also scoped to `/` only, missing `frontend/` and `backend/` where all real dependencies live. Fix in §4. |
| **Dependabot security alerts** | ❓ Unknown | A repository setting, not a file. Cannot be verified from the repo contents — check Settings → Code security. Independent of the `dependabot.yml` bug. |
| **Static analysis** | ✅ Working | CodeQL on every push to `main`, every PR to `main`, and weekly (Mon 08:35 UTC / 14:05 IST). Runs the **default** `security` suite only; `security-extended,security-and-quality` is present but commented out. |
| **Secret scanning / push protection** | ❌ Not configured in-repo | A repository setting; no evidence in any file. The one mitigation actually present is `.gitignore` line 2 (`.env`), which is unanchored and so covers `.env`, `backend/.env`, and `frontend/.env`. No secret is currently tracked — `git ls-files` shows no `.env` anywhere. |
| **Branch protection / required checks** | ❓ Unknown | Not expressible in repository files, so it cannot be confirmed here. Worth stating plainly: **the CodeQL workflow existing does not mean it is required to pass.** Without a branch-protection rule naming `Analyze (javascript-typescript)` as a required check, a PR with failing CodeQL is merge-able. |
| **`pnpm audit`** | ⚠️ Manual only | Nothing in CI runs it. It is a one-liner (`pnpm audit --audit-level=high`) and would catch known CVEs in the resolved tree that Dependabot is currently not reporting. |
| **Lockfile committed** | ✅ Yes | `pnpm-lock.yaml` is tracked, lockfileVersion `9.0`, covering all three packages. This is what makes installs reproducible and what `--frozen-lockfile` verifies. The historical `backend/package-lock.json` and `frontend/package-lock.json` from commit `a6c21fa` are gone — good, competing lockfiles are a real hazard. |
| **Install lifecycle scripts blocked** | ✅ Yes | `pnpm-workspace.yaml` sets `allowBuilds: { esbuild: true }` — a default-deny allowlist, so only esbuild may execute install-time scripts. `.npmrc` carries the pnpm-10-era equivalent (`only-built-dependencies=["esbuild"]`), which pnpm 11 likely ignores. This is the single strongest supply-chain control the repo has: a malicious transitive dependency can be downloaded but not executed at install time. |
| **Package-manager lock-in** | ✅ Yes | Root `preinstall: pnpm dlx only-allow pnpm` aborts `npm install` and `yarn`, preventing a second lockfile and a divergent tree. |
| **Test suite** | ❌ None | No `test` script in the root, `backend/`, or `frontend/` `package.json`; no test framework in any dependency list; no test files. Nothing verifies behaviour before a merge. |
| **Authentication / authorization in the app** | ❌ None yet | `backend/src/server.js` exposes exactly one route, `GET /api/health`, and installs no auth middleware — no session, no JWT, no API key. The frontend has `src/pages/login.jsx` and `src/pages/register.jsx`, but there are no backend endpoints behind them. **This is not a vulnerability today** (there is nothing to protect); it becomes the top item the moment a data route is added. |
| **CORS policy** | ⚠️ Fully permissive | `app.use(cors())` with no options sends `Access-Control-Allow-Origin: *` on every route. Fine while the only route is a public health check; must become an explicit origin allowlist before any authenticated or data-bearing endpoint exists. Note this is invisible in development, because `frontend/vite.config.js` proxies `/api` and the browser never makes a cross-origin request. |
| **Secrets management** | ⚠️ Basic | A single gitignored `.env` at the repo root, read by `dotenv` in the backend and by Vite's `envDir: '../'` in the frontend. No `.env.example` is committed, so the required keys are undocumented (a template is proposed in [`02-root-config.md`](./02-root-config.md) §5). No secret manager, no rotation, no separation between development and production values. |
| **Dependency pinning** | ⚠️ Caret ranges | Every dependency in all three manifests uses `^`, which permits minor and patch drift. The lockfile is the actual pin — which is exactly why `--frozen-lockfile` in CI is non-negotiable once CI exists. |
| **Action pinning** | ⚠️ Major tags | `actions/checkout@v4` and `github/codeql-action/*@v4` are moving tags. Full-SHA pinning is the hardened option; the `github-actions` Dependabot ecosystem (§4) is the maintainable middle ground. |
| **SBOM / build provenance** | ❌ None | No software bill of materials generated, no artifact signing. Reasonable to defer at this stage. |

### Reading the table

The two controls that are actually working — **CodeQL** and **build-script blocking** — are both about code that already exists or code that arrives from the registry. The gaps cluster in a different place: **nothing verifies that a change is correct before it merges.** No tests, no build check, no lint, and (probably) no required checks. CodeQL will tell you a PR introduced an XSS sink. It will not tell you the PR broke the app.

---

## 6. Suggested CI additions

Everything below is a **proposal**. No workflow file is created by this document — the only file under `.github/` that has been touched is `dependabot.yml`, and only to add comments.

### Verified first: what would actually run

Before proposing a lint job, the claim was checked against the repo:

| Check | Result |
| --- | --- |
| Root `lint` script | ❌ Absent — root `scripts` are only `preinstall`, `dev:backend`, `dev:frontend`, `dev`. `pnpm lint` at the root exits with *"Missing script: lint"*. |
| Root `build` script | ❌ Absent — same reason. `pnpm build` at the root fails identically. |
| Frontend `lint` script | ✅ Present — `eslint . --ext js,jsx --report-unused-disable-directives --max-warnings 0` |
| Frontend `build` script | ✅ Present — `vite build` |
| Backend `build` script | ❌ Absent, and correctly so — plain ESM JavaScript, nothing to compile. |
| `.eslintrc*` anywhere | ❌ None found (searched the whole tree excluding `node_modules`) |
| `eslint.config.*` anywhere | ❌ None found |
| `eslintConfig` key in any `package.json` | ❌ None found |

> ⚠️ **`pnpm lint` fails today, for two separate reasons.**
>
> 1. **At the repo root there is no `lint` script at all** — the command fails before ESLint is even reached.
> 2. **Even routed correctly** — `pnpm --filter 1on1-frontend run lint` — **there is no ESLint configuration file anywhere in the repository.** `frontend/package.json` pins `eslint: ^8.55.0`, and ESLint 8 in its default (eslintrc) mode requires a `.eslintrc.{js,cjs,json,yml,yaml}` file or an `eslintConfig` key in `package.json`. With none present it exits non-zero with *"ESLint couldn't find a configuration file."* The three `eslint-plugin-*` packages in `devDependencies` are installed and entirely unused.
>
> **A lint job added today would fail on its first run.** Add a config first.

Minimal config that makes the existing `lint` script work, matching the plugins already in `frontend/package.json` — save as `frontend/.eslintrc.cjs`:

```js
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.2' } },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
  },
};
```

### Proposed `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [ "main" ]
  pull_request:
    branches: [ "main" ]

# Least privilege: this workflow only reads code.
permissions:
  contents: read

# A new push to the same branch cancels the previous, still-running job.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    name: Lint and build
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      # Installs the pnpm version required by devEngines.packageManager
      # in the root package.json (^11.5.2).
      - name: Set up pnpm
        uses: pnpm/action-setup@v4

      # Must come AFTER pnpm/action-setup: cache: 'pnpm' needs pnpm on PATH.
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      # --frozen-lockfile fails if pnpm-lock.yaml and any package.json have
      # drifted apart, instead of quietly re-resolving. This is the check that
      # makes a lockfile worth committing.
      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # NOTE: there is no root `lint` script — the frontend must be targeted
      # by name via --filter. This step FAILS until frontend/.eslintrc.cjs
      # (or an eslint.config.js) exists. See the warning above.
      - name: Lint frontend
        run: pnpm --filter 1on1-frontend run lint

      # vite build → frontend/dist. The backend is plain ESM; nothing to build.
      - name: Build frontend
        run: pnpm --filter 1on1-frontend run build

      # Cheap smoke test in place of a real test suite: does the server start?
      - name: Backend smoke check
        run: |
          node backend/src/server.js &
          SERVER_PID=$!
          for i in $(seq 1 20); do
            if curl -sf http://localhost:5000/api/health > /dev/null; then
              echo "backend responded"
              kill $SERVER_PID
              exit 0
            fi
            sleep 1
          done
          echo "backend did not respond on :5000"
          kill $SERVER_PID
          exit 1
```

Notes on the ordering and flags, since both are easy to get wrong:

- **`pnpm/action-setup` must run before `actions/setup-node`** when using `cache: 'pnpm'`. The Node action resolves the pnpm store path by invoking pnpm; if pnpm is not yet on `PATH`, the step fails with *"Unable to locate executable file: pnpm"*.
- **`pnpm/action-setup@v4` needs no `version:` input here.** It reads `devEngines.packageManager` (or `packageManager`) from the root `package.json`, which this repo sets to `^11.5.2`. Specifying a version in the workflow too would create a second place to keep in sync.
- **`--frozen-lockfile` is already the default in CI** (pnpm detects `CI=true`), but stating it explicitly documents the intent and keeps the behaviour if the job is ever run locally.

### Proposed audit workflow

Cheap, and it partly compensates for Dependabot being broken:

```yaml
name: Dependency audit

on:
  schedule:
    - cron: '0 6 * * 1'      # 06:00 UTC Monday = 11:30 IST
  workflow_dispatch:          # allow a manual run from the Actions tab

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      # Fail only on high/critical so the job stays actionable.
      - run: pnpm audit --audit-level=high
```

### Deliberately not proposed

- **A test job.** There is no test script and no test framework in any `package.json`. A job that runs nothing and reports green is worse than no job — it manufactures false confidence.
- **A deploy job.** No hosting target is configured anywhere in the repo, and a deploy workflow needs `contents: write` plus real credentials in repository secrets. Not something to add speculatively.

### The change that costs nothing

Once `ci.yml` exists, the highest-value follow-up is **not** another workflow — it is a branch-protection rule on `main` requiring `Analyze (javascript-typescript)` and `Lint and build` to pass before merge. Without it, every workflow in this repo is advisory.

---

## 7. Git history for these files

```
f856a01  2026-08-23   docs added
87a85c9  2026-07-31   vulnerals solved
3bc8c3c  2026-07-31   Create codeql.yml
36af1bf  2026-07-31   Create dependabot.yml
a6c21fa  2026-07-14   basic proj structure , env , pnpm
88ba52c  2026-05-24   structure for client sid e
49fbca7  2026-05-24   initial project structure
7c4cd62  2025-12-29   Initial commit
```

| Commit | Date | Relevance to CI and security |
| --- | --- | --- |
| `7c4cd62` | 2025-12-29 | Initial commit. |
| `49fbca7` | 2026-05-24 | First project structure. No tooling, no CI. |
| `88ba52c` | 2026-05-24 | Client-side structure; added `backend/package-lock.json` and `frontend/package-lock.json` — the npm lockfiles later replaced by pnpm. |
| `a6c21fa` | 2026-07-14 | The security-relevant foundation lands: `.gitignore` (ignoring `node_modules` and `.env`), `.npmrc` (`only-built-dependencies`), the root `package.json` with the `preinstall` pnpm guard, `pnpm-workspace.yaml`, and `pnpm-lock.yaml`. This commit also added `backend/.env` and `frontend/.env`; neither is tracked today. |
| `36af1bf` | 2026-07-31 | **`Create dependabot.yml`** — added verbatim from GitHub's web-UI template, with `package-ecosystem: ""` left as the placeholder. Never edited since. This commit is the bug in §4. |
| `3bc8c3c` | 2026-07-31 | **`Create codeql.yml`** — added verbatim from GitHub's "CodeQL Advanced" starter workflow. Never edited since either, which is why the Swift/macOS conditional and the `exit 1` manual-build step are still in the file. |
| `87a85c9` | 2026-07-31 | **`vulnerals solved`** — changed `pnpm-workspace.yaml` `allowBuilds.esbuild` from the placeholder string `set this to true or false` to `true`, activating the install-script allowlist. Proof that the pattern *"committed a template, filled in the placeholder later"* is established practice in this repo — and that `dependabot.yml` is the one placeholder that never got its follow-up. |
| `f856a01` | 2026-08-23 | Added `docs/01-product-requirements.md`, `docs/02-technology-stack.md`, `docs/03-system-design.md`. |

Three of the four commits on 2026-07-31 were a single security-hardening session. Two landed correctly; one did not, and the difference has gone unnoticed for over a month because a broken Dependabot config fails silently — it opens no PRs, which is indistinguishable from "no updates available".

---

## Related documents

- [`02-root-config.md`](./02-root-config.md) — root config files, including `.gitignore`, `.npmrc`, and the `allowBuilds` supply-chain control
- [`../02-technology-stack.md`](../02-technology-stack.md) — stack choices and engineering plan
- [`../03-system-design.md`](../03-system-design.md) — system architecture

### External references

- [Dependabot options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)
- [Dependabot supported ecosystems](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)
- [pnpm build settings (`allowBuilds`)](https://pnpm.io/settings/build)
