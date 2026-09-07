# 05 — Styles: the token system, the three stylesheets, and the techniques in them

Code-level documentation for the CSS. Every claim was verified against the working
tree.

> **RE-DERIVED 2026-09-06.** This file previously walked `frontend/src/pages/login.css`
> rule by rule. **That file was deleted** when the TypeScript port was mounted, along
> with the `login.jsx` it styled. The design system that replaced it is a different
> thing entirely — tokenised, namespaced, and split across three files.
>
> The old approach is **not** erased: §9 keeps it as history, because "why we moved to
> tokens" only makes sense if you can still see what we moved *from*. If you are
> looking for `.login-card`, `.input-field`, `.password-toggle` or the `#22c55e`
> brand green, that is where they went.

---

## 1. How styling works in this project today

Three plain, global CSS files. **No CSS Modules, no Tailwind, no CSS-in-JS.** The
scoping strategy is a naming convention, enforced by review rather than by tooling.

| File | Lines | Namespace | Owns |
| --- | --- | --- | --- |
| `src/index.css` | 565 | `ui-` (+ `brand*`) | The design tokens, the reset, and every shared primitive |
| `src/pages/landing.css` | 1054 | `.ld-` | The landing page, and nothing else |
| `src/components/authShell.css` | 310 | `.au-` | The login/register shell, and nothing else |

### The load path

```
src/main.tsx
  └─ import "./index.css"          ← tokens + reset + primitives, FIRST
  └─ import App from "./App"
       └─ pages/Landing.tsx
            └─ import "./landing.css"           ← .ld-
       └─ pages/Login.tsx  →  components/AuthShell.tsx
            └─ import "./authShell.css"         ← .au-
```

CSS reaches the browser through the **JavaScript module graph**, not through `<link>`
tags. Vite sees `import "./index.css"`, injects it as a `<style>` in dev, and extracts
it into one hashed `.css` file at build time. That is why `index.html` `<link>`s no
stylesheet of its own — only the Google Fonts sheet, which is genuinely external.

> **The import order in `main.tsx` is load-bearing.** `index.css` must come before
> `./App`, because the shared primitives and the page rules have identical
> specificity and the cascade therefore resolves them by source order. This is
> documented once, in **[`04-frontend.md` §4.2](04-frontend.md)** — go there for the
> full reasoning rather than trusting a summary.

---

## 2. What "global" costs, and how the convention pays it back

Every rule in all three files lands in one flat global namespace. Nothing is scoped
by tooling; `.ld-nav` is as reachable from the auth shell as from the landing page.

That is a real cost, and the previous stylesheet paid it in full: `login.css` declared
bare `*` and `body` rules plus generic class names like `.input-field`, `.divider` and
`.submit-btn`. Any second screen importing its own CSS would have collided on sight.

The current system pays it back with **one rule, applied without exception**:

> **Every class is prefixed by the file that owns it.** `ui-` for anything shared,
> `.ld-` for landing, `.au-` for the auth shell.

Two consequences worth internalising:

1. **Collisions become impossible by construction**, not by luck. `.au-panel` and
   `.ld-panel` are different classes. No tooling is required to guarantee it, which is
   why the convention has to be honoured on every new file — it is the entire
   mechanism.
2. **The prefix tells you which file to open.** Seeing `.ld-week__grid` in devtools
   tells you the rule is in `landing.css`, before you search anything.

The naming inside a namespace is loosely BEM: `.ui-slot` is the block,
`.ui-slot__time` an element, `.ui-slot--dark` a modifier.

**This is a deliberate trade, not an oversight.** CSS Modules would make collisions
structurally impossible, at the cost of generated class names that are unreadable in
devtools and a build step between you and your styles. At three stylesheets the
convention is cheaper. At thirty it will not be — see §10.

---

## 3. Design tokens

**All ~34 tokens live in one `:root` block at the top of `index.css`. The two page
stylesheets define exactly zero** — verified. There is therefore precisely one place
in the project where a colour, a type step or a radius is defined.

> **Never inline a colour.** If the token you need does not exist, add it to `:root`.
> A hex literal in a page stylesheet is invisible to every other screen, invisible to
> any future dark mode, and impossible to grep for meaningfully.

### 3.1 Ground and ink — the neutrals

Biased slightly green-cool. Never pure grey, which is what stops the UI reading as a
default bootstrap page.

| Token | Value | Used for |
| --- | --- | --- |
| `--ground` | `#f1f4f2` | The page background |
| `--ground-sunk` | `#e7ebe9` | Recessed areas |
| `--surface` | `#ffffff` | Cards, inputs, anything raised |
| `--surface-2` | `#f7f9f8` | Hover state for surfaces |
| `--line` | `#d2dad7` | Ordinary borders |
| `--line-soft` | `#e3e9e6` | Hairlines — see the `gap: 1px` trick in §5.1 |
| `--ink` | `#121716` | Body text |
| `--ink-2` | `#4d5a57` | Secondary text |
| `--ink-3` | `#7d8985` | Tertiary text, placeholders |

### 3.2 Accents

Spruce is the brand **and** the confirmed state — the good state is the brand colour,
which is why nothing else may claim it.

| Token | Value | Meaning |
| --- | --- | --- |
| `--spruce` | `#14564a` | Brand, primary action, confirmed |
| `--spruce-deep` | `#0d3f36` | The dark marketing panel |
| `--spruce-lift` | `#1c6f5f` | Hover on spruce |
| `--spruce-tint` | `#dfeae6` | Focus rings, tinted backgrounds |
| `--spruce-glow` | `#8fd3c1` | Accents *on* dark spruce |
| `--clay` / `--clay-tint` | `#97591f` / `#f3e7d8` | Pending, awaiting-response |
| `--brick` / `--brick-tint` | `#8c3a2e` / `#f5e2de` | Errors, destructive |
| `--on-dark` / `--on-dark-2` | `#eaf1ee` / `#9db8b0` | Text on spruce panels |

The three-state colour language — **spruce = confirmed, clay = pending, brick = wrong**
— is applied consistently across `.ui-pill`, `.ui-slot` and the form error states.
Learn it once and every status in the UI is readable without a legend.

### 3.3 Type

| Token | Value |
| --- | --- |
| `--display` | `"Archivo", "Helvetica Neue", Arial, sans-serif` |
| `--body` | `"Instrument Sans", "Helvetica Neue", Arial, sans-serif` |
| `--mono` | `"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace` |

The scale is **fluid at the top, fixed at the bottom**:

| Token | Value | Note |
| --- | --- | --- |
| `--step-display` | `clamp(2.6rem, 4.4vw, 4rem)` | Hero |
| `--step-h2` | `clamp(1.9rem, 2.6vw, 2.5rem)` | Section heads |
| `--step-h3` | `1.4rem` | |
| `--step-title` | `1.0625rem` | |
| `--step-body` | `0.9375rem` | |
| `--step-small` | `0.8125rem` | |
| `--step-label` | `0.6875rem` | The uppercase mono label |

**Why `clamp()` on the two largest steps only.** `clamp(min, preferred, max)` lets the
headline scale with the viewport between two hard stops, so it never needs a media
query and never becomes either unreadably small or absurdly large. Body text is
deliberately *not* fluid: a body size that changes with window width makes line length
unpredictable and is worse to read, not better.

### 3.4 Rhythm

`--r-sm: 3px`, `--r-md: 5px`, `--r-lg: 8px`, `--shell: 1240px`, on a 4px base. The
comment in the source explains the intent better than a table can: *"Radii stay tight;
this is a calendar, not a bubble."*

---

## 4. Layout anatomy

### 4.1 The landing page (`.ld-`)

A single scrolling column, constrained by `.ui-shell` (`max-width: var(--shell)`,
auto margins). Sections stack: nav → hero → week grid → loop → rooms → footer.

The **week grid** is the centrepiece and the most interesting layout in the project:
a 7-column CSS grid of days, each holding availability chips.

```css
.ld-week__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 1px;
  background: var(--line-soft);   /* ← this is the divider. See §5.1 */
}
```

`minmax(0, 1fr)` rather than plain `1fr` is deliberate: a bare `1fr` has an automatic
minimum of `min-content`, so one long unbreakable word in a cell can force the whole
grid wider than its container. `minmax(0, …)` removes that floor. This is the single
most common cause of a CSS grid that mysteriously overflows.

### 4.2 The auth shell (`.au-`)

A two-column grid — marketing panel left, form right:

```css
.au { grid-template-columns: minmax(0, 0.86fr) minmax(0, 1fr); }
```

The form column is deliberately the wider of the two. The panel carries a faint
gridline field drawn with two repeating `linear-gradient`s at `background-size: 64px
64px` — a calendar showing faintly through the brand panel, with no image asset.

---

## 5. Techniques worth learning

These are the non-obvious moves in this design. Each looks like a mistake until you
know what it is doing.

### 5.1 `gap: 1px` over a background — hairlines without borders

Used in three places: `.ld-week__grid`, `.ld-loop__list` and `.ld-room__list`.

```css
.ld-loop__list {
  display: grid;
  gap: 1px;
  background: var(--line-soft);   /* container */
}
.ld-step {
  background: var(--surface);     /* every child */
}
```

The container is painted `--line-soft`; every child is painted `--surface`; the 1px
gap between them lets exactly 1px of the container show through. **That sliver is the
divider.** No `border` anywhere.

Why bother, when borders exist? Because borders double up. Give every cell
`border: 1px` and adjacent cells contribute 2px between them, and the outer edges get
a border the grid may not want. The classic fixes — `border-right` on all but the last
child, or negative margins — need `:last-child` rules that break the moment the grid
reflows to a different column count. The `gap` approach produces exactly one hairline
between any two cells, at any column count, with no edge cases. It reflows for free.

The cost: **children must be opaque.** A child with a transparent background shows the
divider colour across its whole box, which reads as a stray grey block. If a cell ever
looks wrong here, that is the first thing to check.

> Note that `gap: 1px` on `.ld-day__head` and `.ld-chip` is *not* this trick — those
> are flex containers using 1px as ordinary tight spacing. The trick only applies
> where the container paints a contrasting background.

### 5.2 `color-mix(in oklab, …)` — deriving colours from tokens

Nine usages across the three files, all of the same shape:

```css
border-color: color-mix(in oklab, var(--spruce) 30%, var(--line));
```

This blends 30% spruce into the ordinary line colour, producing a border that is
recognisably "spruce-flavoured" without introducing a new token for every tint.

**Why `oklab` rather than the default sRGB.** Mixing in sRGB interpolates the raw
channel numbers, which do not correspond to how the eye perceives lightness. Blends
pass through muddy, desaturated middles — the notorious grey halfway point between
blue and yellow. `oklab` is a perceptually uniform space: equal numeric steps look
like equal visual steps, so a 30% mix actually looks 30% of the way there. For a
design deriving many tints from a handful of tokens, that difference is visible.

`color-mix()` is Baseline across current browsers. It has no fallback here, so on a
browser without it those borders fall back to the browser's invalid-value handling —
an acceptable trade for a project targeting modern browsers, but worth knowing it is a
trade.

### 5.3 `font-stretch` on Archivo's variable `wdth` axis

Six declarations across the three files, at **112%, 115%, 116% and 118%** — on `h1`–
`h4` in `index.css`, and on the panel and page titles.

This works **only** because `index.html` requests the variable width axis:

```
family=Archivo:wdth,wght@100..125,400..800
        ^^^^
```

Drop the `wdth,` from that URL — or let the font fail to load so a fallback takes
over — and every one of those declarations becomes a silent no-op. Nothing errors, no
warning appears; the headlines simply render at normal width and the design flattens.

**It is the least visible way to break this UI**, which is why it is called out in
`index.html`, in `04-frontend.md` §4.3, and again here.

### 5.4 `order: -1` — putting the form above the marketing panel on mobile

```css
@media (max-width: 900px) {
  .au { grid-template-columns: minmax(0, 1fr); }
  .au-main { order: -1; }
}
```

In source order the marketing panel comes first, which is correct on desktop where it
sits on the left. Collapsed to one column it would sit *on top* — so somebody arriving
at `/login` on a phone would scroll past marketing copy to reach the password field.

`order: -1` on the form pulls it in front. **The DOM is untouched**, so tab order and
screen-reader order still follow the source. That is worth noting as a caveat as much
as a technique: `order` changes only the visual sequence, and using it to reorder
*interactive* content can desynchronise what a sighted user sees from what a keyboard
user traverses. It is safe here precisely because the panel it jumps is
non-interactive.

### 5.5 The 560px week-grid transformation

The most aggressive responsive move in the project. Below 560px, seven columns cannot
work, so the grid stops being a grid:

```css
.ld-week__grid { display: flex; flex-direction: column; }
```

Each day becomes a full-width row. The source comments explain the rest, and are worth
quoting exactly:

```css
/* One row per day: label on the left, that day's slots flowing beside it. */

/* The day label is taken out of flow and the row is padded past it, so a
   third slot wraps into line with the first two instead of sliding back
   under the label. */
.ld-day {
  position: relative;
  flex-wrap: wrap;
  padding: 8px 14px 8px 92px;   /* ← 92px reserves the label column */
}
.ld-day__head {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
}
```

The `92px` left padding and the absolutely positioned label are **one mechanism, not
two**. If the label stayed in flow, wrapped chips would flow back underneath it and
the rows would lose their left alignment. Taking it out of flow and reserving its
width with padding keeps every chip in a clean column no matter how many wrap.

`top: 50% + translateY(-50%)` is the standard vertical centring idiom for an absolute
box of unknown height: `top: 50%` puts its *top edge* at the middle, then the
transform pulls it back up by half its own height.

---

## 6. Responsive behaviour

All three files are **desktop-first** — every query is `max-width`, overriding a base
rule written for the widest case.

| Breakpoint | `index.css` | `landing.css` | `authShell.css` |
| --- | :---: | :---: | :---: |
| 1040px | | ✓ | |
| 900px | | ✓ | ✓ |
| 720px | ✓ | ✓ | ✓ |
| 560px | | ✓ | |
| 520px | | | ✓ |
| 380px | | ✓ | |

> **A real inconsistency:** `landing.css` breaks at **560px** and `authShell.css` at
> **520px**, for the same "narrow phone" case. 900px and 720px are shared, so the
> divergence is almost certainly accidental rather than intentional. Nothing is broken
> — the two files style disjoint pages — but a shared breakpoint set (ideally as
> tokens) would stop the two drifting further. Logged in §8.

Media queries **add no specificity**. `@media (max-width: 900px) { .au-main { … } }` is
still `(0,1,0)` and beats the base rule purely because it appears later in the file.
Move a media block above the rule it overrides and it silently stops working — one of
the most confusing CSS bugs there is, and the same source-order mechanism that governs
the `index.css`-first import rule.

---

## 7. CSS concepts primer, demonstrated by this codebase

Each concept is anchored to a real rule you can go and read.

### Box model / `border-box`
Every element is content + padding + border + margin; `box-sizing` decides which of
those `width` refers to. `content-box` (the default) = content only; `border-box` =
content + padding + border.
**Here:** `*, *::before, *::after { box-sizing: border-box }` at the top of
`index.css` is what lets `.ui-field__input` carry `padding: 0 14px` and a 1px border
inside a full-width field without overflowing its column.

### Flexbox: main axis vs cross axis
`display: flex` lays children along a **main** axis; the perpendicular one is the
**cross** axis. `flex-direction` decides which is which — *and that decides what
`justify-content` and `align-items` mean*.
**Here:** `.ui-slot` is a row, so `align-items` controls vertical alignment.
`.au-panel` is a column, so the same property controls horizontal alignment. Same
declaration, perpendicular effect, because the direction changed.

### The `flex` shorthand
`flex: 1` = `flex-grow: 1; flex-shrink: 1; flex-basis: 0%`.
**Here:** `.au-or::before` and `::after` are both `flex: 1`, and the `0%` basis is
what makes the two hairlines beside the word "or" exactly equal, rather than
proportional to any content.

### Grid: `minmax(0, 1fr)`
**Here:** every grid track in the project uses `minmax(0, 1fr)` rather than `1fr`. A
bare `1fr` has an automatic minimum of `min-content`, so one long unbreakable string
can push the whole grid wider than its container. See §4.1.

### Absolute positioning + the positioning ancestor
An absolutely positioned element leaves normal flow and is placed against its nearest
ancestor whose `position` is not `static`.
**Here:** `.ld-day { position: relative }` is the ancestor for
`.ld-day__head { position: absolute }` in the 560px block (§5.5). Remove the
`relative` and the label flies to the top-left of the page.

### Pseudo-elements (`::`)
A box the browser generates that has no node in the DOM. `content: ''` is what makes
it exist at all.
**Here:** `.au-or::before` / `::after` are the two divider hairlines,
`.ui-pill::before` is the status dot, and `.ui-field__input::placeholder` styles
browser-generated text.

### Pseudo-classes (`:`)
A conditional match on the *same* element, based on its state.
**Here:** `:hover` (`.ui-btn`, `.au-google`), `:focus` (`.ui-field__input`),
`:focus-visible` (the global ring), `:last-child` (`.au-steps li`). No JavaScript, no
class toggling.

### Transitions
Interpolate a property between old and new computed values over a duration.
**Here:** `.ui-field__input` transitions `border-color, box-shadow`; `.au-google`
transitions `border-color, background`. **Never `all`** — `all` animates properties
you did not intend, including ones added later, and forces the browser to check every
property on every change.

### Media queries
Apply a block only when a viewport condition holds. `min-width` = "this width or
wider" (mobile-first); `max-width` = "this width or narrower" (desktop-first).
**Here:** all three files are desktop-first — see §6.

### Specificity
Scored as (ids, classes/attributes/pseudo-classes, elements). The higher score wins.
**Here, with a consequence worth understanding:**

```css
:focus-visible          { outline: 2px solid var(--spruce); }  /* (0,1,0) */
.ui-field__input:focus  { outline: none; box-shadow: 0 0 0 3px var(--spruce-tint); }
                                                               /* (0,2,0) */
```

Both match when you tab into a text input, and the **second wins** — a class plus a
pseudo-class outscores a lone pseudo-class. So text inputs never receive the global
outline; their focus indicator is the 3px `box-shadow` ring instead. That is
deliberate and it is a genuine, visible indicator — but it is why you cannot find the
outline in devtools when you go looking for it. See §8.

### The cascade
When specificity ties, the rule appearing **later in source order** wins.
**Here:** this single mechanism explains three separate things in this project — why
`index.css` must be imported before page CSS (§1), why media queries must sit below
the rules they override (§6), and why the namespace convention matters (§2). Nothing
in these files uses an id selector or `!important` except the
`prefers-reduced-motion` guard, where `!important` is correct.

---

## 8. Known issues

| # | Issue | Where | Detail |
| --- | --- | --- | --- |
| 1 | **Divergent narrow breakpoints** | `landing.css` 560px vs `authShell.css` 520px | Same "narrow phone" case, two numbers, almost certainly accidental. Nothing breaks today because the files style disjoint pages. Breakpoints as tokens would prevent drift. |
| 2 | **Focus ring is invisible in forced-colors mode** | `index.css:470` | `.ui-field__input:focus` sets `outline: none` and substitutes a `box-shadow` ring. That is a real, visible indicator in normal rendering — but Windows High Contrast / `forced-colors` mode discards `box-shadow` while preserving `outline`, so text inputs lose their focus indicator entirely there. Fix is a `@media (forced-colors: active)` block restoring an outline. |
| 3 | **Focus ring does not distinguish keyboard from pointer** | `index.css:470` | The input rule keys off `:focus`, not `:focus-visible`, so the ring also appears on mouse click. Cosmetic, and arguably desirable on form fields; noted for consistency with the rest of the system, which uses `:focus-visible`. |
| 4 | **Icons are mostly not marked decorative** | `components/Icons.tsx` | Not a CSS issue but it lands here: `Brand.tsx` sets `aria-hidden="true"` + `focusable="false"`, and 3 of ~28 icons in `Icons.tsx` do. All are decorative and should be hidden from assistive tech. |
| 5 | **No dark mode** | all three files | Every token is a light value; there is no `prefers-color-scheme` block. Because all colour flows from one `:root`, adding it later is a contained change — which is most of the argument for the token system. |
| 6 | **`color-mix()` has no fallback** | 9 usages | Baseline in current browsers; on one without support those borders take the browser's invalid-value path. An acceptable trade, but a deliberate one. |

### Findings that are now closed

Both were listed as open in `08-gaps-and-findings.md` before this pass and are
**corrected there as of 2026-09-06**:

- **`outline: none` losing the focus ring (A1).** The old `login.css` removed the
  outline and compensated with only a border/background tint. `index.css` now ships a
  global `:focus-visible { outline: 2px solid var(--spruce); outline-offset: 2px }`,
  and the one place that still sets `outline: none` immediately replaces it with a 3px
  `box-shadow` ring. The residual is the forced-colors case in row 2 above — much
  narrower than the original finding.
- **No `prefers-reduced-motion` guard (A7).** `index.css:557` ships the standard
  universal guard, clamping `animation-duration`, `animation-iteration-count` and
  `transition-duration` to `0.01ms !important` across `*, *::before, *::after`.
  Because it is universal, the page stylesheets correctly do not repeat it.

---

## 9. Historical: what `login.css` did, and why it was replaced

`frontend/src/pages/login.css` was deleted on 2026-09-06. It is described here because
the current system is best understood as a set of answers to its specific problems.

| What `login.css` did | Why it was a problem | What replaced it |
| --- | --- | --- |
| Hardcoded colour literals throughout — `#22c55e` brand green, `#9ca3af` on `.password-toggle`, and others | The same green appeared in several files with no single definition. Changing the brand meant grepping hex codes, and any missed one was invisible until someone noticed. | ~34 tokens in one `:root`; page stylesheets define zero |
| Bare `*` and `body` rules inside a *page* stylesheet | Importing one page's CSS restyled the entire document. Two pages could not coexist. | The reset lives in `index.css`, which is global on purpose; page files style only their own namespace |
| Generic class names — `.input-field`, `.divider`, `.submit-btn`, `.login-card` | A flat global namespace with no prefixes. The second screen was guaranteed to collide. | `ui-` / `.ld-` / `.au-` prefixes (§2) |
| `outline: none` on `.input-field` with only a border tint to compensate | Keyboard users effectively lost the focus indicator. | Global `:focus-visible` ring + an explicit 3px `box-shadow` ring on inputs (§8) |
| No `prefers-reduced-motion` guard | Vestibular-sensitive users got every transition regardless. | The universal guard at `index.css:557` |
| One `@media (min-width: 768px)` block, mobile-first | Not wrong, but inconsistent with everything written since. | Desktop-first `max-width` queries throughout (§6) |
| `border-radius` on a native checkbox (a no-op), and dead declarations | Accumulated cruft nobody had cause to revisit. | Gone with the file |

**The lesson worth keeping:** none of those were mistakes at the time. They are what a
single-screen stylesheet looks like. They became problems at exactly the moment a
second screen existed — which is the general shape of CSS debt. It is invisible until
the thing it prevents is the thing you need to do next.

---

## 10. When to revisit this approach

The convention-based scoping is right for three stylesheets. Two signals that it has
stopped being right:

1. **A prefix collision, or a near miss in review.** The convention has no enforcement,
   so the first time it fails is the day it stops being sufficient.
2. **Page stylesheets past ~1000 lines each.** `landing.css` is already at 1054.

The migration path, in increasing order of disruption:

- **Keep global CSS, add a lint rule.** `stylelint` with `selector-class-pattern` can
  enforce the prefix per file mechanically. Cheapest by far, and it turns the
  convention into a real constraint. This is the recommended next step.
- **CSS Modules** (`*.module.css`). Vite supports them with zero configuration.
  Collisions become structurally impossible; the cost is unreadable generated class
  names in devtools. Tokens in `:root` are unaffected — they are plain custom
  properties and keep working exactly as they do now.
- **A utility framework.** Would replace the token system rather than complement it.
  Not recommended here: the token vocabulary *is* the design system, and it is the
  part of this codebase most worth keeping.

---

## Related documents

| Document | Covers |
| --- | --- |
| `CLAUDE.md` (repo root) | The frontend conventions, stated as decided rules |
| [`04-frontend.md`](04-frontend.md) | The components these styles dress, and the cascade contract in §4 |
| [`08-gaps-and-findings.md`](08-gaps-and-findings.md) | Open/closed findings, including the a11y items above |
| [`09-stack-correction-2026-09-05.md`](09-stack-correction-2026-09-05.md) | The migration record |
