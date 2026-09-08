#!/usr/bin/env node
/**
 * check-links.mjs — route-vs-link consistency checker for the `1on1` frontend.
 *
 * WHY THIS EXISTS
 *   Two dead links survived a full UI migration: `<Link to="/dashboard">` in
 *   Landing.tsx and `href="#reset"` in Login.tsx. Nothing caught them because
 *   nothing *could*: `tsc` sees a string, ESLint sees a string, and at runtime
 *   App.tsx's catch-all `<Route path="*">` redirects every unknown path to `/`.
 *   The catch-all is the right UX, but it turns a 404 into a silent bounce
 *   home, so a broken link never surfaces as an error anywhere. This script is
 *   the missing check: it compares every navigation target the source
 *   *declares* against the routes and element ids the source *defines*.
 *
 * WHY ZERO DEPENDENCIES
 *   `pnpm-lock.yaml` is the most collision-prone file in this repo while
 *   several sessions work the tree at once. A test runner or a JSX parser would
 *   each be a new dependency and therefore a lockfile change. Node 24 built-ins
 *   (`node:fs`, `node:path`, `node:url`) are enough for a string scan of ~20
 *   files, so that is all this uses.
 *
 * WHY REGEX + A TINY SCANNER, NOT A REAL PARSER
 *   App.tsx and the pages are TSX. Node cannot import them without a transpile
 *   step (Vite/esbuild), which would be both a dependency and a dependency on
 *   build order. We only need string literals, so a regex over the source text
 *   is the honest tool. The one place a regex cannot cope — finding where a JSX
 *   opening tag ends when an attribute contains `=>` — gets a ~15-line
 *   brace-aware scanner instead. A regex cannot count nesting; a scanner can.
 *
 * WHAT IT CHECKS
 *   Sources:  <Link to>  <NavLink to>  <Navigate to>  navigate("…")  <a href>
 *   Targets:  /absolute          → must match a <Route path> in src/App.tsx
 *             #fragment          → must match an id="…" in some src/**\/*.tsx
 *             http(s)/mailto/tel → "external": counted, never fetched
 *             {expr} / `tpl`     → "unchecked": cannot be resolved statically
 *
 * OUTPUT / EXIT CODES
 *   One line per target:   file:line  target  → status (detail)
 *   Exit 0: nothing dead.  Exit 1: at least one DEAD.  Exit 2: tool error
 *   (e.g. src/App.tsx not found). 1 vs 2 matters in CI — "the check failed"
 *   and "the checker is broken" call for different responses.
 *
 * ALLOWLIST
 *   KNOWN_PLACEHOLDERS below. A known-dead target stays *visible* in the report
 *   as `allowed (placeholder: …)` but does not fail the gate. Every entry
 *   carries a reason. Entries that stop matching anything are reported stale.
 *
 * USAGE
 *   pnpm --filter 1on1-frontend run check:links
 *   node scripts/check-links.mjs [frontendRoot]
 *     The optional root lets the checker run against ANY tree. That is how it
 *     was proven: pointed at a `git archive HEAD` snapshot that still carried
 *     the dead /dashboard link, it had to report DEAD and exit 1 before a
 *     passing run on the fixed tree meant anything.
 */

// Only Node built-ins, on purpose — see "WHY ZERO DEPENDENCIES" above.
import { existsSync, readdirSync, readFileSync } from "node:fs";
// `sep` is needed to normalise Windows backslashes out of the report.
import { dirname, join, relative, resolve, sep } from "node:path";
// import.meta.url is a file:// URL; this converts it back to a path we can join.
import { fileURLToPath } from "node:url";

// ─── Allowlist ──────────────────────────────────────────────────────────────
// A dead target we KNOW about and have decided to keep for now. Each entry
// needs a `reason` so the next reader can tell "deliberate placeholder" from
// "forgot to remove". Matching is by target + file, never by line number:
// line numbers shift every time someone edits above the link (this very run
// saw #reset move from Login.tsx:182 to :213 while a peer edited the file), and
// an allowlist that rots on every edit is one nobody trusts.
const KNOWN_PLACEHOLDERS = [
  {
    // The literal target text exactly as written in the source.
    target: "#reset",
    // Path relative to the frontend root, forward slashes — the same form the
    // report prints, so an entry can be copied straight from a failing line.
    file: "src/pages/Login.tsx",
    // The TODO on the lines directly above the link is the authority here.
    reason:
      "TODO above the link: /forgot-password is not built yet (needs the " +
      "backend to mail a single-use reset token); the anchor stays as a " +
      "visible placeholder until that route exists",
  },
];

// Anything the checker cannot resolve without executing code is truncated in
// the report to this width, so one long template literal cannot wreck the
// column alignment for every other row.
const TARGET_COLUMN_MAX = 40;

// ─── Locate the tree ────────────────────────────────────────────────────────
// Anchor on this file, not process.cwd(): `pnpm --filter` runs scripts from the
// package dir, a bare `node frontend/scripts/…` from the repo root does not,
// and CI may do either. import.meta.url is the one location that never moves.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// Optional positional override of the frontend root — the hook that makes the
// checker testable against a snapshot tree instead of only the live one.
const FRONTEND_ROOT = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(SCRIPT_DIR, "..");
// Everything routable lives under src/; scanning wider would pull in dist/.
const SRC_DIR = join(FRONTEND_ROOT, "src");
// App.tsx is the single source of truth for routes. If it is missing we are
// pointed at the wrong tree, and a "0 dead" result would be a lie.
const APP_FILE = join(SRC_DIR, "App.tsx");

// ─── Small helpers ──────────────────────────────────────────────────────────

/**
 * Report-style path: relative to the frontend root, forward slashes even on
 * Windows. Output must be byte-identical across machines so CI logs are
 * greppable and the allowlist `file` field can be matched by plain equality.
 */
function displayPath(absolutePath) {
  return relative(FRONTEND_ROOT, absolutePath).split(sep).join("/");
}

/**
 * 1-based line number of a character offset — the convention editors and
 * `file:line` links use. Counting newlines before the offset is O(n) per
 * call, which is fine for a tree of ~20 files and ~30 targets.
 */
function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

/**
 * Index of the `}` that closes the `{` at `open`.
 * Quote-aware so a `}` inside a string literal cannot end the expression
 * early; the backslash skip exists because `"\""` is a legal string in a JS
 * expression and a naive scan would treat the escaped quote as the closer.
 */
function matchingBrace(source, open) {
  // Nesting depth — starts at 0 and the `{` at `open` will take it to 1.
  let depth = 0;
  // The quote character we are inside, or null when in code.
  let quote = null;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      // Inside a string: only an unescaped matching quote gets us out.
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    // Template literals count as strings here: braces inside `${…}` belong to
    // the template, not to the JSX expression we are measuring.
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    // Pre-decrement so the `}` that returns depth to 0 is the one we report.
    else if (c === "}" && --depth === 0) return i;
  }
  // Unbalanced source: fall off the end rather than throw, so one malformed
  // file degrades to a bad row instead of killing the whole run.
  return source.length - 1;
}

/**
 * Index of the `>` that closes the JSX opening tag starting at `lt`.
 * A plain /<Link[^>]*>/ breaks on `onClick={() => …}` because the `>` of the
 * arrow ends the match early — and a comparison like `{n > 0}` does the same.
 * Skipping over every `{…}` with matchingBrace() makes those `>` invisible.
 * JSX attribute strings have no backslash escapes, so quotes are simpler here.
 */
function tagEnd(source, lt) {
  // Same role as in matchingBrace: which quote we are inside, or null.
  let quote = null;
  for (let i = lt; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    // Jump straight past a `{…}` expression — whatever `>` it contains is JS.
    else if (c === "{") i = matchingBrace(source, i);
    else if (c === ">") return i;
  }
  // Same degrade-don't-crash choice as matchingBrace.
  return source.length - 1;
}

/**
 * Read a JSX attribute value whose first character is at `i` (just after `=`).
 * Returns { raw, literal }: `raw` is what to print, `literal` is the resolved
 * string when it can be known statically and null when it cannot. Callers
 * branch on `literal === null` to report `unchecked` rather than guess.
 */
function readAttrValue(source, i) {
  const c = source[i];
  if (c === '"' || c === "'") {
    // Plain quoted string: the common case and the only fully checkable one.
    const close = source.indexOf(c, i + 1);
    const literal = source.slice(i + 1, close);
    return { raw: literal, literal };
  }
  if (c === "{") {
    // Expression container. Usually dynamic, but `to={"/x"}` is still a
    // literal wearing braces, so unwrap that case instead of calling it unchecked.
    const close = matchingBrace(source, i);
    const inner = source.slice(i + 1, close).trim();
    const quoted = /^(["'])(.*)\1$/s.exec(inner);
    if (quoted) return { raw: inner, literal: quoted[2] };
    // Keep the braces in `raw` so the report visibly says "this was an expression".
    return { raw: `{${inner}}`, literal: null };
  }
  // Bare `to` with no value, or syntax this scanner does not model.
  return { raw: "?", literal: null };
}

/**
 * Read the first argument of `navigate(…)` starting at `i` (just after `(`).
 * Same contract as readAttrValue. `navigate(-1)` and `navigate(path)` are
 * dynamic by nature; only a plain quoted string can be checked.
 */
function readCallArg(source, i) {
  const c = source[i];
  if (c === '"' || c === "'") {
    const close = source.indexOf(c, i + 1);
    const literal = source.slice(i + 1, close);
    return { raw: literal, literal };
  }
  // Show the expression up to the first comma or paren so the row is readable;
  // this is display only, so a comma inside a template literal is acceptable.
  const cut = source.slice(i).search(/[,)]/);
  const inner = source.slice(i, cut === -1 ? source.length : i + cut).trim();
  return { raw: inner, literal: null };
}

// ─── Routes: what the app actually serves ───────────────────────────────────

/**
 * Every `<Route path="…">` in App.tsx, found with the same tag scanner used for
 * links so an `element={…}` written before `path` cannot hide it. The `*`
 * catch-all is dropped deliberately: it matches everything, so keeping it
 * would make every link "valid" and the whole check meaningless — it is the
 * very thing that hid the original bug. Known limitation: nested relative
 * routes (`<Route path="settings">` inside `/account`) are not joined to their
 * parent; today there are none.
 */
function parseRoutes(appSource) {
  const routes = [];
  // `(?=[\s/>])` after the name stops `<Route` matching `<Routes>`.
  for (const m of appSource.matchAll(/<Route(?=[\s/>])/g)) {
    const tag = appSource.slice(m.index, tagEnd(appSource, m.index) + 1);
    // Leading whitespace is required so an attribute like `data-path=` is ignored.
    const p = /\spath=(?:"([^"]*)"|'([^']*)')/.exec(tag);
    // Index and layout routes have no `path`; nothing to register.
    if (!p) continue;
    const path = p[1] ?? p[2];
    if (path !== "*") routes.push(path);
  }
  return routes;
}

/**
 * Path → segments. "/" → [], "/login/" → ["login"]. React Router ignores a
 * trailing slash when matching, so the checker must too or `/login/` would be
 * a false DEAD.
 */
function segments(path) {
  return path.split("/").filter(Boolean);
}

/**
 * Does a declared route serve this pathname? Compared segment by segment: a
 * `:param` segment accepts anything, a trailing `*` splat accepts any
 * remainder. Every route is static today, but the first page ported from
 * 1on1_sb brings `/profile/:username`, and a checker that calls
 * `/profile/teja` dead on that day is a false positive that costs the tool
 * its credibility — so param support is built in now, tested on a fixture.
 */
function routeMatches(routePath, pathname) {
  const routeSegs = segments(routePath);
  const pathSegs = segments(pathname);
  // A splat route is "these fixed segments, then anything".
  const splat = routeSegs.at(-1) === "*";
  const fixed = splat ? routeSegs.slice(0, -1) : routeSegs;
  // Without a splat the lengths must agree exactly, or `/u/x/extra` would
  // match `/u/:id`; with one the path just has to be at least as long.
  if (splat ? pathSegs.length < fixed.length : pathSegs.length !== fixed.length) return false;
  return fixed.every((seg, i) => seg.startsWith(":") || seg === pathSegs[i]);
}

// ─── Fragment ids: what `#foo` can land on ──────────────────────────────────

/**
 * Every `id="…"` in src/**\/*.tsx, mapped to where it is defined so the report
 * can say "id in Landing.tsx:257" rather than a bare "ok". Only .tsx is
 * scanned because ids live in markup; an `id="` inside a .ts file is a string
 * in logic, not an anchor. Global scope is a known simplification — a `#loop`
 * link on the Login page would pass because Landing defines it, even though at
 * runtime it would scroll nowhere. Per-page scoping needs a route→component
 * map, which is a real parser's job, not this script's.
 */
function collectIds(files) {
  const ids = new Map();
  for (const file of files) {
    if (!file.endsWith(".tsx")) continue;
    const source = readFileSync(file, "utf8");
    // `\b` before `id` keeps `data-testid=` and `userId=` out of the map.
    for (const m of source.matchAll(/\bid=(?:"([^"]*)"|'([^']*)')/g)) {
      const id = m[1] ?? m[2];
      // First definition wins; a duplicate id is an a11y bug but not this tool's concern.
      if (!ids.has(id)) ids.set(id, `${displayPath(file)}:${lineAt(source, m.index)}`);
    }
  }
  return ids;
}

// ─── Navigation targets: what the app links to ──────────────────────────────

/**
 * Every navigation target in one file, in source order.
 *   • `<Link|NavLink|Navigate … to=…>` and `<a … href=…>`: locate the opening
 *     tag with the scanner, then read the one attribute we care about.
 *     `(?=[\s/>])` after the name stops `<a` matching `<article>`/`<aside>`
 *     and `<Link` matching a hypothetical `<LinkButton>`.
 *   • `navigate("…")` is the imperative form the auth pages use after a
 *     successful submit. `(?<!\w)` stops `useNavigate(` from matching — its
 *     `N` is capital anyway, but the lookbehind states the intent and survives
 *     a future lowercase wrapper.
 * The attribute regex demands whitespace before the name so `data-to=` or
 * `xlink:href=` can never be mistaken for the router prop.
 */
function extractTargets(file) {
  const source = readFileSync(file, "utf8");
  const rel = displayPath(file);
  const found = [];
  for (const m of source.matchAll(/<(Link|NavLink|Navigate|a)(?=[\s/>])/g)) {
    const tag = m[1];
    // The router components take `to`; the anchor element takes `href`.
    const attr = tag === "a" ? "href" : "to";
    const tagText = source.slice(m.index, tagEnd(source, m.index) + 1);
    const at = new RegExp(`\\s${attr}=`).exec(tagText);
    // An <a> with no href (a named anchor) or a <Link {...props}> has nothing to check.
    if (!at) continue;
    const value = readAttrValue(source, m.index + at.index + at[0].length);
    found.push({ file: rel, line: lineAt(source, m.index), via: `<${tag} ${attr}>`, ...value });
  }
  for (const m of source.matchAll(/(?<!\w)navigate\(\s*/g)) {
    const value = readCallArg(source, m.index + m[0].length);
    found.push({ file: rel, line: lineAt(source, m.index), via: "navigate()", ...value });
  }
  // Two passes produce two orderings; sort by line so the report reads
  // top-to-bottom like the file it describes.
  return found.sort((a, b) => a.line - b.line);
}

// ─── Classification ─────────────────────────────────────────────────────────

/**
 * Decide what one target is. Order matters: external first (a URL contains
 * `/` and may contain `#`), then fragment, then absolute path. The `?query`
 * and `#hash` of an absolute path are stripped before route matching because
 * the router matches on pathname alone — `/login?next=/x` must pass when
 * `/login` exists.
 */
function classify(target, routes, ids) {
  // No literal means an expression or template: the honest answer is "unchecked".
  if (target.literal === null) return { status: "unchecked", detail: `dynamic ${target.via}` };
  const value = target.literal;
  // `tel:` is not in the brief but is the same class of thing as `mailto:`.
  if (/^(https?:|mailto:|tel:)/i.test(value)) return { status: "external", detail: "" };
  if (value.startsWith("#")) {
    // `href="#"` yields an empty id and falls through to DEAD — that bare hash
    // is the most common placeholder of all, so failing it is the point.
    const definedAt = ids.get(value.slice(1));
    return definedAt
      ? { status: "ok", detail: `id in ${definedAt}` }
      : { status: "DEAD", detail: `no id="${value.slice(1)}" in src/**/*.tsx` };
  }
  if (value.startsWith("/")) {
    const pathname = value.split(/[?#]/)[0];
    const route = routes.find((r) => routeMatches(r, pathname));
    return route
      ? { status: "ok", detail: `route ${route}` }
      : { status: "DEAD", detail: "no <Route path> in src/App.tsx matches" };
  }
  // A relative `to="settings"` resolves against the CURRENT route, which a
  // static scan of one file does not know.
  return { status: "unchecked", detail: "relative target, depends on current route" };
}

/**
 * Apply the allowlist AFTER classification, not instead of it. Two payoffs:
 * an entry whose target has since been fixed shows up as redundant instead of
 * silently masking a real check forever, and the report still shows the
 * placeholder every run so it cannot be forgotten.
 */
function applyAllowlist(target, result) {
  const entry = KNOWN_PLACEHOLDERS.find(
    (e) => e.target === target.literal && e.file === target.file,
  );
  if (!entry) return result;
  // Marked so the stale-entry sweep in main() can tell which entries still earn their place.
  entry.used = true;
  if (result.status === "DEAD") return { status: "allowed", detail: `placeholder: ${entry.reason}` };
  return { ...result, detail: `${result.detail}; allowlist entry is now redundant, remove it` };
}

// ─── Run ────────────────────────────────────────────────────────────────────

/**
 * Returns the process exit code instead of calling process.exit() itself.
 * On Windows, stdout to a pipe is asynchronous, so process.exit() right after
 * console.log() can truncate the report — in CI, the one place it matters.
 * Setting process.exitCode and letting Node drain stdout avoids that.
 */
function main() {
  if (!existsSync(APP_FILE)) {
    // stderr, not stdout: CI keeps them separate and humans grep stdout for findings.
    console.error(`check-links: cannot find ${APP_FILE}; pass the frontend root as the first argument`);
    // 2, not 1: exit 1 means "found dead links"; a broken invocation must not look like a failed check.
    return 2;
  }

  // readdirSync `recursive` (Node 20+) replaces a hand-rolled walk or a glob
  // dependency. Sorted so the report order is deterministic — a CI diff of the
  // output must not churn because the filesystem enumerated differently.
  const sourceFiles = readdirSync(SRC_DIR, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.tsx?$/.test(d.name))
    .map((d) => join(d.parentPath, d.name))
    .sort();

  const routes = parseRoutes(readFileSync(APP_FILE, "utf8"));
  const ids = collectIds(sourceFiles);
  const rows = sourceFiles.flatMap(extractTargets).map((target) => {
    const { status, detail } = applyAllowlist(target, classify(target, routes, ids));
    return { where: `${target.file}:${target.line}`, target: target.raw, status, detail };
  });

  // Column widths come from the data so the arrows line up whatever the longest
  // path is; aligned columns are what make a 30-row report scannable at a glance.
  const whereWidth = Math.max(0, ...rows.map((r) => r.where.length));
  const targetWidth = Math.min(TARGET_COLUMN_MAX, Math.max(0, ...rows.map((r) => r.target.length)));
  for (const r of rows) {
    const shown =
      r.target.length > TARGET_COLUMN_MAX ? `${r.target.slice(0, TARGET_COLUMN_MAX - 1)}…` : r.target;
    const detail = r.detail ? ` (${r.detail})` : "";
    console.log(`${r.where.padEnd(whereWidth)}  ${shown.padEnd(targetWidth)}  → ${r.status}${detail}`);
  }

  // A stale entry is a warning, not a failure, to honour the exit-code contract
  // ("exit 1 only on a dead target"). Tightening this to exit 1 is the natural
  // next step once the allowlist grows past one entry.
  for (const e of KNOWN_PLACEHOLDERS) {
    if (!e.used) console.log(`warning: allowlist entry never matched: ${e.file} ${e.target} (remove it?)`);
  }

  const count = (status) => rows.filter((r) => r.status === status).length;
  const dead = count("DEAD");
  // Blank line separates the per-target rows from the summary, for eyes and for `tail -2`.
  console.log("");
  // Echo the routes so a reader can see what the targets were judged against.
  console.log(`routes (src/App.tsx): ${routes.join("  ")}`);
  console.log(
    `${rows.length} targets: ${count("ok")} ok, ${dead} dead, ${count("allowed")} allowed, ` +
      `${count("unchecked")} unchecked, ${count("external")} external`,
  );
  return dead > 0 ? 1 : 0;
}

process.exitCode = main();
