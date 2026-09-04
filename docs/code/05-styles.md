# 05 — Styles: how `login.css` works, rule by rule

> Scope: [`frontend/src/pages/login.css`](../../frontend/src/pages/login.css) — the
> only stylesheet that exists in this repo — plus the colours that live inline in
> [`frontend/src/pages/login.jsx`](../../frontend/src/pages/login.jsx).
> Every claim below was checked against the working tree.

---

## 1. How styling works in this project today

**One plain global CSS file, imported from a component, injected by the bundler.**
That is the whole system. There is no Tailwind, no CSS Modules, no
styled-components, no Sass, no PostCSS config, no design-token package.

Two independent sources confirm it:

| Source | What it says |
| --- | --- |
| [`docs/02-technology-stack.md`](../02-technology-stack.md) | Under **Frontend** it lists `React, TypeScript, HTML, CSS, anime.js, D3.js`, and under **Programming Languages** it lists `HTML` and `CSS` again. The words *Tailwind*, *CSS Modules*, *styled-components* and *Sass* do not appear anywhere in that document. Plain CSS is the documented intent. |
| `frontend/package.json` | Dependencies are `react` and `react-dom`. Dev dependencies are Vite, the React plugin, and ESLint. **Zero styling packages.** Plain CSS is also the actual state. |

> Two smaller mismatches worth knowing while you are here: the stack doc lists
> TypeScript, but the frontend is `.jsx` with no TypeScript configured, and it lists
> `anime.js` and `D3.js`, neither of which is installed. Those belong to
> [`08-gaps-and-findings.md`](08-gaps-and-findings.md), not to this document.

### The load path

```
frontend/index.html
  └─ <script type="module" src="/main.jsx">
       └─ main.jsx  ──imports──▶  app.jsx  ──imports──▶  src/pages/login.jsx
                                                            │
                                                            └─ import './login.css'
```

Note what is **not** in that chain: `index.html` never contains a
`<link rel="stylesheet">`. The CSS is discovered only because a JavaScript module
imports it.

| Mode | What Vite does with `import './login.css'` |
| --- | --- |
| `pnpm dev` | Rewrites the import into a tiny JS module that creates a `<style>` element, fills it with the file's text, and appends it to `<head>`. Editing the file hot-swaps that one `<style>` tag with no page reload. |
| `pnpm build` | Extracts the CSS out of the JS graph entirely and emits `dist/assets/index-<hash>.css`, linked from the built `dist/index.html`. |

Either way the result is the same for authoring purposes: **a global stylesheet**.
The class names in the file are the literal class names in the DOM. Nothing is
hashed, prefixed or scoped.

---

## 2. What "global" actually costs you

The stylesheet is evaluated as soon as the `Login` module is evaluated — which is at
app startup, because `app.jsx` imports it statically — and it is never unloaded.
So these rules are live on **every** screen the app will ever have, not just while
the login route is on screen.

**The two rules that leak hardest:**

```css
* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
```

`*` rewrites the box model for every element in the document. `body` sets the page's
margin and typeface. Both are *good* defaults — most projects want exactly this —
but they are being set by a page component, which means:

- deleting the login page, or lazy-loading it behind a route, silently removes the
  app-wide reset and the font;
- a reader looking for "where is the global reset?" has no reason to look in
  `pages/login.css`;
- these are decisions about the whole application being made in a leaf file.

**The collision that is coming.** The class names here are generic. The moment a
second page ships its own stylesheet, both are in the same global namespace and the
later import wins on equal specificity:

| Class in `login.css` | A second page will plausibly want it too |
| --- | --- |
| `.input-field`, `.input-label`, `.input-group`, `.input-wrapper` | any form |
| `.submit-btn` | any form |
| `.divider` | any "or" separator |
| `.social-btn`, `.social-login` | `register.jsx` — which is an empty file today |
| `.toggle-mode`, `.form-options` | the register flow |

Note that `register.jsx` and `landingpage.jsx` exist as 0-byte files. Whoever fills
them in hits this on day one. Section 9 lists the two standard ways out.

---

## 3. Design tokens

There is no token layer — every value below is a literal typed directly into a
declaration. This table *is* the token system, reverse-engineered.

### 3.1 Colours in `login.css`

| Hex | Name (Tailwind ramp) | Role | Uses | Where |
| --- | --- | --- | ---: | --- |
| `#22c55e` | green-500 | **Brand.** The single most repeated colour in the file. | **6** | `.login-illustration-section` bg, `.input-field:focus` border, `.checkbox-input` accent, `.forgot-password` text, `.submit-btn` bg, `.toggle-mode-btn` text |
| `#16a34a` | green-600 | Brand hover — one stop darker | 1 | `.submit-btn:hover` bg |
| `#111827` | grey-900 | Heading text | 1 | `.login-title` |
| `#1f2937` | grey-800 | Typed input value | 1 | `.input-field` |
| `#4b5563` | grey-600 | Secondary body text | 2 | `.checkbox-label`, `.toggle-mode` |
| `#6b7280` | grey-500 | Field labels, divider text | 2 | `.input-label`, `.divider` |
| `#9ca3af` | grey-400 | Placeholder + icon | 2 | `.input-field::placeholder`, `.password-toggle` |
| `#e5e7eb` | grey-200 | Hairline rule | 1 | `.divider::before` / `::after` border |
| `#f3f4f6` | grey-100 | Input resting background | 1 | `.input-field` |
| `#ffffff` | white | Card surface, focused field | 2 | `.login-card` bg, `.input-field:focus` bg |
| `white` | *keyword* | Submit button label | 1 | `.submit-btn` — the same colour written a second way |
| `#1a1a1c` | — (custom near-black) | Page backdrop | 1 | `.login-container` |
| `#fef2f2` | red-50 | Google button resting bg | 1 | `.social-btn` |
| `#fee2e2` | red-100 | Google button hover bg | 1 | `.social-btn:hover` |
| `rgba(0,0,0,0.2)` | — | Card drop shadow | 1 | `.login-card` |

**Total: 24 colour literals across 33 rules.** The green + grey system alone accounts
for 17 of them. None is named; a rebrand means 17 find-and-replaces, and a dark theme
is not expressible at all.

Note `#ffffff` and `white` are the same colour written two ways — a small symptom of
having no token layer to normalise against.

### 3.2 Colours that exist only in `login.jsx`

The illustration and the Google mark are inline SVG, so their colours never reach the
stylesheet. They cannot be themed, overridden or dark-moded from CSS.

| Hex | Name | Role | Uses |
| --- | --- | --- | ---: |
| `#FFFFFF` | white | Every line, circle and stroke in the illustration | 23 |
| `#FBBF24` | amber-400 | Character 1's body, feet and the two small triangles | 5 |
| `#EA4335` | Google red | All four paths of the Google logo | 4 |
| `#EF4444` | red-500 | Character 2's body and feet | 3 |
| `#3B82F6` | blue-500 | Character 2's legs | 2 |

Two things to flag:

1. **The Google mark is wrong.** All four of its paths are `fill="#EA4335"`. The real
   logo is red / green / yellow / blue (`#EA4335`, `#34A853`, `#FBBC05`, `#4285F4`).
   Today it renders as a solid red blob.
2. The illustration's `#FFFFFF` strokes are chosen to sit on `#22c55e`. Change the
   brand green in the CSS and the SVG contrast changes with it, in the other file.

### 3.3 The rest of the scale

| Kind | Values in use |
| --- | --- |
| Radii | `4px` (checkbox — see §8), `8px` (input, submit), `12px` (card), `24px` (social pill) |
| Font sizes | `0.85rem`, `0.875rem`, `1rem`, `1.875rem` |
| Font weights | `500`, `600`, `700` |
| Spacing | `0.25 / 0.4 / 0.5 / 1 / 1.25 / 1.5 / 2 / 3.5 / 4` rem |
| Transition | `0.2s`, three times, always on named properties |
| Breakpoint | `768px`, once |

**Why `rem` and not `px`.** `1rem` equals the **root** font size — whatever the user
set in their browser, 16px by default but larger for anyone who raised it for
readability. `font-size: 0.875rem` honours that preference; `font-size: 14px` would
silently override it and cap the text at 14px no matter what the user asked for.
Only genuinely fixed, non-textual values are left in `px` here: border widths, corner
radii, shadow offsets and the fixed 60×40 social button.

---

## 4. Layout anatomy

```
+-- .login-container ------------------------------------------------------+
| display:flex | min-height:100vh | padding:2rem | bg:#1a1a1c              |
| justify-content: center  -> centres the card on the MAIN axis (x)        |
| align-items: center      -> centres the card on the CROSS axis (y)       |
|                                                                          |
| +-- .login-card -------------------------------------------------------+ |
| | display:flex (row) | width:100% | max-width:960px | min-height:600px | |
| | border-radius:12px | box-shadow: 0 10px 25px rgba(0,0,0,.2)          | |
| | overflow:hidden  <- clips children to the 12px rounded corners       | |
| |                                                                      | |
| | +-- .login-form-section ---+  +-- .login-illustration-section -----+ | |
| | | flex: 1                  |  | flex: 1                            | | |
| | |  = grow 1 / shrink 1     |  |  = grow 1 / shrink 1               | | |
| | |    basis 0%  ==> 50%     |  |    basis 0%  ==> 50%               | | |
| | |                          |  |                                    | | |
| | | display: flex            |  | display: none  <- BASE (mobile)    | | |
| | | flex-direction: column   |  | display: flex  <- @media >=768px   | | |
| | | justify-content:center   |  | position: relative                 | | |
| | |  -> main axis is now Y   |  |  <- positioning ancestor for       | | |
| | | padding: 4rem 3.5rem     |  |     the SVG in login.jsx           | | |
| | |                          |  | background-color: #22c55e          | | |
| | | h2.login-title           |  | overflow: hidden                   | | |
| | | .input-group (x2 or x3)  |  |                                    | | |
| | |   .input-label           |  | +----------------------------+     | | |
| | |   .input-wrapper         |  | | <svg> inlined in login.jsx |     | | |
| | |     position: relative   |  | | position: absolute         |     | | |
| | |     .input-field         |  | | top: 0; left: 0            |     | | |
| | |     .password-toggle     |  | | width=100%  height=100%    |     | | |
| | |       position:absolute  |  | +----------------------------+     | | |
| | | .form-options            |  |                                    | | |
| | | .submit-btn              |  |                                    | | |
| | | .divider ::before/after  |  |                                    | | |
| | | .social-login            |  |                                    | | |
| | |   .social-btn            |  |                                    | | |
| | | .toggle-mode             |  |                                    | | |
| | +--------------------------+  +------------------------------------+ | |
| |      50% of the card                    50% of the card              | |
| +----------------------------------------------------------------------+ |
+--------------------------------------------------------------------------+
```

Three nested flex containers, each with a different job:

1. **`.login-container`** — row direction. Centres one child in the viewport.
2. **`.login-card`** — row direction. Splits into two equal columns.
3. **`.login-form-section`** — **column** direction. Stacks the form rows and centres
   the stack vertically. Because the direction flipped, `justify-content: center`
   means something different here than it does two levels up.

---

## 5. Rule-by-rule walkthrough

### 5.1 Reset

```css
* {
  box-sizing: border-box;
}
```

The default is `content-box`, where `width` describes only the content area and
padding + border are added on top. A content-box element with `width: 100%` and
`padding: 1rem` therefore measures `100% + 2rem` and overflows its parent.
`border-box` redefines `width` as the whole painted box.

This is not decoration — `.input-field` sets `width: 100%` **and**
`padding: 0.85rem 1rem`. Without this reset, every input would overflow the form
column by 32px. The universal selector has specificity `0,0,0`, the lowest possible,
so anything overrides it.

```css
body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
```

`margin: 0` kills the user-agent stylesheet's default 8px body margin. Left in, it
would show as a dark gutter and would push the `min-height: 100vh` container 16px
past the viewport, producing a permanent scrollbar. (`padding: 0` is already the UA
default; it is stated for clarity, not effect.)

The **system font stack** requests a face the OS already ships rather than
downloading a webfont — text paints on the first frame with no flash of unstyled text
and no layout shift. First match wins:

| Entry | Resolves to |
| --- | --- |
| `-apple-system` | San Francisco on macOS/iOS (Safari, Firefox) |
| `BlinkMacSystemFont` | the same San Francisco, spelled the way Chrome-on-macOS wants it |
| `"Segoe UI"` | Windows — quoted because the family name contains a space |
| `Roboto` | Android, Chrome OS |
| `Helvetica`, `Arial` | older macOS / older Windows |
| `sans-serif` | the generic family; last resort, always resolves |

### 5.2 Layout container

```css
.login-container {
  display: flex;
  min-height: 100vh;
  background-color: #1a1a1c;
  justify-content: center;
  align-items: center;
  padding: 2rem;
}
```

Row-direction flex, so the **main** axis is horizontal and the **cross** axis is
vertical — which is exactly what makes `justify-content: center` centre horizontally
and `align-items: center` centre vertically. Two declarations replace the old
`position: absolute; top: 50%; transform: translate(-50%,-50%)` recipe.

`min-height: 100vh` rather than `height: 100vh` is the important choice. `100vh` is
exactly one viewport tall; as a hard `height` it would **clip** the card, which itself
demands 600px plus this 2rem of padding. `min-height` reads as "at least a full
viewport, taller if the content needs it", so a short window scrolls instead of
cutting the form off.

Thanks to the `border-box` reset, the 2rem padding is subtracted from the 100vh
rather than added to it.

### 5.3 Card

```css
.login-card {
  display: flex;
  width: 100%;
  max-width: 960px;
  background-color: #ffffff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  min-height: 600px;
}
```

- `width: 100%` + `max-width: 960px` — fluid below the cap, fixed above it, so line
  lengths stay readable on a wide monitor.
- **`overflow: hidden` is load-bearing.** `border-radius` rounds the card, but the
  green `.login-illustration-section` paints right up to the card's edge and would
  cover those rounded corners, squaring off the right-hand side. Clipping descendants
  to the rounded shape is what keeps the green panel's corners curved. Delete this
  line and the bug appears on the right side only, which makes it confusing to
  diagnose.
- `min-height: 600px` stops the card resizing when `login.jsx` toggles between sign-in
  (shorter) and register (an extra Name field, no options row). Without a floor, the
  whole card would jump every time the user flips modes.

### 5.4 Form section

```css
.login-form-section {
  flex: 1;
  padding: 4rem 3.5rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
```

`flex: 1` expands to `flex-grow: 1; flex-shrink: 1; flex-basis: 0%`. **The `0%` basis
is the part that matters.** Each panel starts from zero width, then all of the card's
width is handed out in equal 1:1 grow shares — a true 50/50 split regardless of
content. Compare `flex: auto` (basis `auto`), which starts each panel at its natural
content width and produces a lopsided split. The illustration panel declares the same
`flex: 1`; that pairing is what makes the halves equal.

This panel is *also* a flex container, but `flex-direction: column`, so its main axis
runs vertically — which is why `justify-content: center` here centres the form rows
**vertically** inside the 600px card. Cross-axis alignment is left at `stretch`, so
each row still spans the full column width.

### 5.5 Illustration section

```css
.login-illustration-section {
  flex: 1;
  background-color: #22c55e;
  position: relative;
  display: none;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

@media (min-width: 768px) {
  .login-illustration-section {
    display: flex;
  }
}
```

**Mobile-first.** The base rule is the *phone* rule: `display: none` removes the
illustration from the layout entirely, so a narrow screen shows the form column alone
at full width. The `@media (min-width: 768px)` block is the **desktop enhancement**
that switches it back on. Base = small screen, media query = larger screen, written
with `min-width` — that is the definition of mobile-first. The desktop-first inverse
would set `display: flex` here and use `max-width` queries to take things away.

A media query adds **no specificity**. Both selectors are a single class (`0,1,0`), so
the override wins purely on **source order**. Move the `@media` block above the base
rule and the panel would never appear.

**`position: relative` couples this file to `login.jsx`.** The `<Illustration/>`
component renders its `<svg>` with an inline
`style={{position: 'absolute', top: 0, left: 0}}`. An absolutely positioned element
is laid out against its nearest **positioned ancestor** — the closest ancestor whose
`position` is anything but `static`. This rule is that ancestor. Remove it and the
SVG escapes to the initial containing block and lands in the top-left corner of the
*page*, over the form. Neither file can be changed safely in ignorance of the other.

`overflow: hidden` clips the artwork, whose paths deliberately run outside the
`0 0 400 500` viewBox (`M -50,300 …`).

> **Dead declarations:** `align-items` and `justify-content` do nothing here. They
> are obviously inert while `display: none` holds, but they stay inert after the
> media query restores `display: flex` too — the panel's only child is absolutely
> positioned, therefore out of flow, therefore not a flex item.

### 5.6 Typography

```css
.login-title {
  font-size: 1.875rem;
  font-weight: 700;
  color: #111827;
  margin-bottom: 2rem;
  text-align: center;
}
```

`1.875rem` = 30px at the default root size (Tailwind's `text-3xl` step), in `rem` so
it grows with the user's browser setting. `#111827` is near-black rather than pure
`#000`, which reads harsh on white. Only `margin-bottom` is set, so the `<h2>`'s UA
top margin survives — harmless here, because the parent column centres its content
vertically anyway.

### 5.7 Inputs

```css
.input-group  { margin-bottom: 1.25rem; }

.input-label {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: #6b7280;
  margin-bottom: 0.4rem;
}

.input-wrapper { position: relative; }
```

`.input-group` supplies the 20px vertical rhythm — `margin-bottom` rather than
`margin-top` so the first field sits tight under the heading and spacing never
doubles.

A `<label>` is `display: inline` by default, which would drop it beside the field and
would ignore vertical margins entirely. `display: block` fixes both. The label is
`#6b7280` (grey-500), deliberately quieter than the value the user types (`#1f2937`).

`.input-wrapper` is `position: relative` with **no offsets**, so it moves nothing —
it exists purely to become the positioning ancestor for `.password-toggle` (§5.8). It
wraps every field, not only the password one, so all rows stay structurally identical
in the JSX.

```css
.input-field {
  width: 100%;
  padding: 0.85rem 1rem;
  background-color: #f3f4f6;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 0.875rem;
  color: #1f2937;
  outline: none;
  transition: border-color 0.2s, background-color 0.2s;
}

.input-field:focus {
  border-color: #22c55e;
  background-color: #ffffff;
}

.input-field::placeholder {
  color: #9ca3af;
}
```

**`border: 1px solid transparent`, not `border: none`.** The 1px border box is
reserved up front and simply invisible, so `:focus` changes only its *colour* and
nothing reflows. Declaring `border: none` and adding a border on focus would nudge
the whole form by a pixel every time focus moved.

**`outline: none` is an accessibility regression** — see §8.1. It is flagged in the
stylesheet and deliberately left unchanged.

**`transition: border-color 0.2s, background-color 0.2s`** animates precisely the two
properties `:focus` changes, over 200ms. The properties are named rather than using
`transition: all` because `all` would animate every animatable property, including
layout-triggering ones (`width`, `height`, `padding`, `font-size`) added to the rule
months later — expensive on every frame — and because with `all` you can no longer
tell from the CSS what is supposed to move.

`:focus` is a **pseudo-class** (single colon): the same element, matched only while
it is in a state. Its specificity is `0,2,0` against `.input-field`'s `0,1,0`, so it
wins while the state holds and falls back the instant focus leaves — no JavaScript.

`::placeholder` is a **pseudo-element** (double colon): it styles a fragment the
browser generates internally, the greyed hint text, which has no DOM node you could
select. `#9ca3af` is lighter than the typed-value colour so a placeholder is never
mistaken for real content. Placeholders are hints, not labels — they vanish on the
first keystroke, which is why `login.jsx` also renders a real `<label>` per field.

### 5.8 Password toggle

```css
.password-toggle {
  position: absolute;
  right: 1rem;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
}
```

The "button parked inside an input" trick, in two halves:

1. `.input-wrapper` is `position: relative` → it becomes the positioning ancestor.
2. this button is `position: absolute` → it leaves normal flow (so the input still
   spans the full width, unaffected) and positions against that wrapper's box.

`right: 1rem` pins it 16px in from the wrapper's right edge, floating over the
input's own right padding.

**The vertical-centring idiom.** These two lines only work as a pair:

| Line | Effect |
| --- | --- |
| `top: 50%` | puts the element's **top edge** at the wrapper's midpoint — which leaves it sitting too *low* by half its own height |
| `transform: translateY(-50%)` | pulls it back up by 50% **of its own height** |

A percentage inside `transform` resolves against the element's own box — that is the
whole point, since nothing has to know how tall the icon is. Transform also only
moves the painted result, so nothing reflows. (`align-items: center` on the wrapper
cannot substitute: an absolutely positioned child is out of flow and is not a flex
item.)

The rest strips the `<button>` back to a bare icon. `display: flex; align-items:
center` removes the inline descender gap under the 20×20 SVG. The `color: #9ca3af`
reaches the icon through `stroke="currentColor"` in `login.jsx` — another coupling
between the two files.

### 5.9 Form options

```css
.form-options {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  font-size: 0.85rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  color: #4b5563;
  cursor: pointer;
  font-weight: 500;
}

.checkbox-input {
  margin-right: 0.5rem;
  accent-color: #22c55e;
  width: 1rem;
  height: 1rem;
  border-radius: 4px;
}

.forgot-password { color: #22c55e; text-decoration: none; font-weight: 600; }
.forgot-password:hover { text-decoration: underline; }
```

`justify-content: space-between` is the two-ends row: first item flush left, last
flush right, all leftover space dumped in the middle. No floats, no width arithmetic,
and it stays correct when the label text is translated.

`.checkbox-label` is itself a flex row so the native checkbox and its text share a
vertical centre. `cursor: pointer` is honest here — the `<input>` is nested *inside*
the `<label>` in the JSX (implicit label association), so clicking the words really
does toggle the box, no `for`/`id` needed.

**`accent-color`** is the modern one-line way to theme a *native* control: the browser
tints the checked state with the brand green and picks a readable tick colour itself.
The same property works on radios, `<input type=range>` and `<progress>`. Before it
existed the only route was to hide the real input and rebuild the box from a
pseudo-element, silently discarding keyboard behaviour, the indeterminate state and
screen-reader semantics.

**`border-radius: 4px` on the checkbox is a no-op** — see §8.6.

`text-decoration: none` on the link trades the underline for colour + weight; the
`:hover` rule brings the underline back, because colour alone is a weak affordance
(and hover does not exist on touch at all).

### 5.10 Submit button

```css
.submit-btn {
  width: 100%;
  padding: 0.85rem;
  background-color: #22c55e;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s;
}

.submit-btn:hover { background-color: #16a34a; }
```

Full-bleed primary action. `width: 100%` plus `border-box` means the padding stays
inside that width, so the button's edges line up exactly with the `.input-field`
boxes above. The 8px radius is copied from the inputs so the button reads as part of
the same stack. White on `#22c55e` is the highest-emphasis pairing on the card — which
is what a single primary action should be.

`#16a34a` is green-600, one stop darker than the green-500 resting colour: the
conventional "hover = one shade darker" move, taken from the ramp rather than
invented, which is what keeps the palette coherent. Only `background-color` is
transitioned, because it is the only property that changes.

### 5.11 Divider

```css
.divider {
  display: flex;
  align-items: center;
  text-align: center;
  margin: 1.5rem 0;
  color: #6b7280;
  font-size: 0.85rem;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  border-bottom: 1px solid #e5e7eb;
}

.divider::before { margin-right: 1rem; }
.divider::after  { margin-left: 1rem; }
```

In the JSX this element contains nothing but a text node. Both hairlines are
generated entirely in CSS, so the markup stays clean. The container is a flex row
holding three items: the `::before` line, an anonymous flex item wrapping the text,
and the `::after` line.

The "line — text — line" pattern needs exactly three things:

| Declaration | Why it is required |
| --- | --- |
| `content: ''` | **Mandatory.** A pseudo-element whose `content` is unset is *not generated at all* — the box does not exist and every other declaration in the rule is ignored. The empty string is what brings the box into being. |
| `flex: 1` | each side grows into whatever space the text does not use; two equal `1` shares keep the text centred whatever its length (`"Or sign in with"` vs `"Or register with"`, which the JSX swaps between) |
| `border-bottom` | the visible rule. The generated box has no content and therefore no height, so its bottom border *is* the line. |

`::before` is inserted as the first child and `::after` as the last, which is exactly
the order needed to bracket the text. The margins are split into two rules so each
line gets space on its **inner** edge only, leaving the outer edges flush.

> `text-align: center` on `.divider` is inert once flexbox is laying out the children
> — the text item is sized to its content, so there is no spare inline space to align
> within.

### 5.12 Social login

```css
.social-login {
  display: flex;
  justify-content: center;
  gap: 1rem;
}

.social-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 1rem;
  background-color: #fef2f2;
  border: none;
  border-radius: 24px;
  cursor: pointer;
  transition: background-color 0.2s;
  width: 60px;
  height: 40px;
}

.social-btn:hover { background-color: #fee2e2; }
```

`gap` is flexbox's own spacing property: it puts 1rem *between* items with no outer
margin, so adding a second provider later needs no `:last-child { margin: 0 }`
clean-up. Today only the Google button renders, so `justify-content: center` simply
centres it.

**`border-radius: 24px` on a 40px-tall box is a pill, not a 24px rounded rectangle.**
Any radius at or above half the height (20px here) is clamped by the browser to
exactly half, turning the short sides into perfect semicircles. Deliberately
over-stating the number — `24px`, or the common `999px` — is the standard shorthand
for "fully rounded, whatever the height turns out to be", so the shape survives a
change in height.

With the fixed 60×40 size and both centring properties in place, the `padding` no
longer positions anything; it only guarantees an inner gutter if the fixed dimensions
are ever removed.

> `login.jsx` puts `className="social-btn google-btn"` on this button, but
> **`.google-btn` is not defined anywhere in the stylesheet.** It is a dead class —
> either a leftover, or a hook someone intended to use for per-provider theming.

### 5.13 Toggle mode

```css
.toggle-mode {
  margin-top: 1.5rem;
  text-align: center;
  font-size: 0.875rem;
  color: #4b5563;
}

.toggle-mode-btn {
  background: none;
  border: none;
  color: #22c55e;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  margin-left: 0.25rem;
}

.toggle-mode-btn:hover { text-decoration: underline; }
```

A real `<button>` styled to look like a link — and that is the *correct* choice, not
a compromise. The control performs an in-page action (flipping React state between
sign-in and register) rather than navigating to a URL, so it belongs on `<button>`
for keyboard and screen-reader semantics while *looking* like the inline link the
sentence needs. The brand green at weight 600 matches `.forgot-password`, so the two
read as one family; the `0.25rem` left margin is the word space after "Don't have an
account?".

Worth contrasting with §5.7: nothing here removes the outline, so this button keeps
its native focus ring and is fully visible to keyboard users. The text inputs are the
only controls carrying the regression.

---

## 6. Responsive behaviour

There is exactly **one** breakpoint in the entire stylesheet:
`@media (min-width: 768px)`, and it changes exactly **one** declaration.

| | `< 768px` (base / mobile) | `>= 768px` (enhancement) |
| --- | --- | --- |
| `.login-illustration-section` | `display: none` — removed from the layout | `display: flex` — visible |
| Card layout | one column | two columns |
| Form column width | 100% of the card | 50% of the card (`flex: 1` on both) |
| Green panel + SVG | not rendered at all | rendered, clipped to the card's radius |
| Card `max-width` | 960px (never reached below 1024px viewport) | 960px, reached at a 1024px viewport |
| `min-height: 600px` | applies | applies |
| Container padding | `2rem` | `2rem` |
| Form padding | `4rem 3.5rem` | `4rem 3.5rem` |
| Font sizes | unchanged | unchanged |

### The arithmetic, which exposes a real problem

The last three rows never change, and that hurts at both ends of the range:

| Viewport | Card width | Form column | Usable content width |
| ---: | ---: | ---: | ---: |
| 360px (phone) | 296px | 296px | **184px** |
| 767px (just below the breakpoint) | 703px | 703px | 591px |
| 768px (at the breakpoint) | 704px | 352px | **240px** |
| 1024px+ (capped) | 960px | 480px | 368px |

*(card = viewport − 2 × 2rem container padding, capped at 960; content = column −
2 × 3.5rem form padding.)*

Two things fall out of that table:

1. **On a 360px phone the form has 184px of usable width** — 112px of the 296px card
   is horizontal padding. The email placeholder `example.email@gmail.com` will not
   fit.
2. **The form column gets *narrower* as the screen gets wider.** Crossing 768px takes
   the usable width from 591px down to 240px in a single pixel, because the
   illustration claims half the card while the padding stays fixed. It is the
   narrowest the form ever is.

Neither is caused by the mobile-first pattern itself — the pattern is right. The fix
would be to scale `.login-form-section`'s padding at the breakpoints too, e.g. a
smaller base padding with the generous `4rem 3.5rem` moved into a `min-width: 960px`
query. Recorded here, not applied.

---

## 7. CSS concepts primer, demonstrated by this file

Each concept below is anchored to a real line you can go and read.

### Box model / `border-box`
Every element is content + padding + border + margin. `box-sizing` decides which of
those `width` refers to. `content-box` (the default) = content only; `border-box` =
content + padding + border.
**Here:** `* { box-sizing: border-box }` is what lets `.input-field` set
`width: 100%` *and* `padding: 0.85rem 1rem` without overflowing.

### Flexbox: main axis vs cross axis
`display: flex` creates a container whose children become flex items laid out along a
**main** axis; the perpendicular one is the **cross** axis. `flex-direction` decides
which is which, and *that decides what `justify-content` and `align-items` mean*.
**Here:** `.login-container` is `row`, so `justify-content: center` centres
horizontally. `.login-form-section` is `column`, so the *same* declaration centres
vertically. Same property, opposite effect, because the direction changed.

### The `flex` shorthand
`flex: 1` = `flex-grow: 1; flex-shrink: 1; flex-basis: 0%`.
**Here:** both card panels declare `flex: 1`, and the `0%` basis is what makes the
split exactly 50/50 rather than proportional to their content.

### Absolute positioning + the positioning ancestor
An absolutely positioned element leaves normal flow and is placed against its nearest
ancestor whose `position` is not `static`.
**Here:** `.input-wrapper { position: relative }` is the ancestor for
`.password-toggle { position: absolute }`; `.login-illustration-section
{ position: relative }` is the ancestor for the SVG's inline `position: absolute`.

### Pseudo-elements (`::`)
A box the browser generates that has no node in the DOM.
**Here:** `.divider::before` / `::after` are the two hairlines, and
`.input-field::placeholder` styles the browser-generated hint text.
`content: ''` is what makes a generated box exist at all.

### Pseudo-classes (`:`)
A conditional match on the *same* element based on its state.
**Here:** `:focus` (`.input-field:focus`) and `:hover`
(`.submit-btn:hover`, `.social-btn:hover`, `.forgot-password:hover`,
`.toggle-mode-btn:hover`). No JavaScript, no class toggling.

### Transitions
Interpolate a property between its old and new computed values over a duration.
**Here:** three declarations, all naming their properties explicitly:
`.input-field` (border-color + background-color), `.submit-btn` and `.social-btn`
(background-color). Never `all` — see §5.7.

### Media queries
Apply a block only when a condition about the viewport holds. `min-width` = "this
width or wider" (mobile-first); `max-width` = "this width or narrower"
(desktop-first).
**Here:** the single `@media (min-width: 768px)` block that reveals the illustration.

### Specificity
When two rules set the same property, the more specific selector wins, scored as
(ids, classes/attributes/pseudo-classes, elements).
**Here:** `*` = `0,0,0`. `.input-field` = `0,1,0`. `.input-field:focus` = `0,2,0` —
which is why the focus state overrides the resting state. Nothing in this file uses
an id selector or `!important`, which is a good sign.

### The cascade
When specificity ties, the rule that appears **later in the source** wins. Media
queries add no specificity of their own.
**Here:** `@media (min-width: 768px) { .login-illustration-section { display: flex } }`
beats the base `display: none` on source order alone (`0,1,0` vs `0,1,0`). Move the
media block above the base rule and the illustration never appears — a genuinely
confusing bug if you do not know this rule.

---

## 8. Known issues

### 8.1 `outline: none` — accessibility regression
`.input-field` removes the browser's focus ring. That ring is how keyboard users
(Tab), switch-device users and screen-magnifier users know where they are; removing it
is a **WCAG 2.4.7 "Focus Visible"** failure.

It is *partially* compensated — `:focus` repaints the border green and the background
white, which is a real visible change — but a 1px green hairline is a weak indicator,
and `#22c55e` on `#ffffff` is roughly 2:1 contrast, under the 3:1 minimum WCAG asks of
a non-text focus indicator.

The correct approach keeps a ring on `:focus-visible`, which fires for keyboard focus
but not mouse clicks:

```css
.input-field:focus-visible {
  outline: 2px solid #16a34a;
  outline-offset: 2px;
}
```

Flagged in the stylesheet, deliberately not applied.

### 8.2 Hardcoded colours, no custom properties
24 colour literals, none named (§3.1). A rebrand is 17 find-and-replaces across the
green + grey system alone, and `#ffffff` / `white` already disagree on spelling.

### 8.3 Global scope
`*` and `body` are set from a page-level file, and every class name sits in one shared
namespace (§2). `register.jsx` will collide on `.input-field`, `.submit-btn`,
`.divider` and `.social-btn` the moment it ships a stylesheet.

### 8.4 No dark mode
There is no `@media (prefers-color-scheme: dark)` block anywhere. The card is
hardcoded `#ffffff`, the page `#1a1a1c`, and the SVG's colours are baked into the JSX
where CSS cannot reach them. Dark mode is not currently expressible without §8.2 being
fixed first.

### 8.5 No `prefers-reduced-motion` guard
Three `transition` declarations animate unconditionally. At 200ms on colour changes
the risk is genuinely low, but there is no opt-out for users who ask their OS for
reduced motion. The standard guard:

```css
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
```

### 8.6 `border-radius` on a native checkbox is a no-op
`.checkbox-input { border-radius: 4px }` does nothing in most browsers — a checkbox is
painted as a native widget and ignores the property. Rounding one actually requires
`appearance: none` and rebuilding the control by hand, which would also throw away the
`accent-color` win directly above it. Harmless, but misleading to read.

### 8.7 Dead declarations and classes
| What | Where | Why it is dead |
| --- | --- | --- |
| `align-items`, `justify-content` | `.login-illustration-section` | its only child is out of flow, so it is not a flex item |
| `text-align: center` | `.divider` | flexbox sizes the text item to its content; no spare inline space |
| `padding: 0.5rem 1rem` | `.social-btn` | fixed 60×40 plus both centring properties make it inert |
| `.google-btn` | applied in `login.jsx`, never defined in the CSS | no matching rule exists |

### 8.8 Fixed padding at every viewport
See §6: 184px of usable form width on a 360px phone, and the form column is at its
*narrowest* immediately after the 768px breakpoint.

### 8.9 Adjacent, in `login.jsx` (not this file's fault, but it touches `.input-label`)
The Name / Email / Password `<label class="input-label">` elements have no `htmlFor`
and their inputs have no `id`, so they are not programmatically associated — clicking
a label does not focus its field, and a screen reader may not announce it. Only
`.checkbox-label` is correct, because it nests its input. Already annotated in
`login.jsx`.

---

## 9. If you want to refactor later

Both options below are presented as options. **Neither has been applied.**

### Option A — CSS custom properties on `:root`

The smallest change with the biggest payoff. It fixes §8.2 and unlocks §8.4 without
touching a single line of JSX, because the class names stay identical.

**Before**

```css
.submit-btn        { background-color: #22c55e; }
.submit-btn:hover  { background-color: #16a34a; }
.forgot-password   { color: #22c55e; }
.input-field       { background-color: #f3f4f6; color: #1f2937; }
```

**After**

```css
:root {
  --brand:        #22c55e;
  --brand-hover:  #16a34a;
  --surface:      #ffffff;
  --surface-sunk: #f3f4f6;
  --text:         #1f2937;
}

.submit-btn        { background-color: var(--brand); }
.submit-btn:hover  { background-color: var(--brand-hover); }
.forgot-password   { color: var(--brand); }
.input-field       { background-color: var(--surface-sunk); color: var(--text); }
```

Dark mode then becomes an override block rather than a rewrite:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --surface:      #1f2937;
    --surface-sunk: #111827;
    --text:         #f3f4f6;
  }
}
```

Custom properties are inherited and resolved at runtime, so a `:root` change repaints
everything. Note the SVG colours in `login.jsx` would still need doing separately —
`fill="currentColor"` or `fill="var(--brand-accent)"` on those paths.

### Option B — CSS Modules

Fixes §8.3, the global namespace, and is supported by Vite out of the box: rename the
file to `*.module.css` and it is scoped automatically. No plugin, no config.

**Before** — `login.css`, global, literal class names

```css
/* login.css */
.submit-btn { background-color: #22c55e; }
```

```jsx
// login.jsx
import './login.css';
<button className="submit-btn">Sign in</button>
```

**After** — `login.module.css`, scoped, hashed class names

```css
/* login.module.css */
.submitBtn { background-color: #22c55e; }
```

```jsx
// login.jsx
import styles from './login.module.css';
<button className={styles.submitBtn}>Sign in</button>
```

Vite compiles `.submitBtn` to something like `_submitBtn_1a2b3_7`, so a `.submitBtn`
in `register.module.css` is a *different* class and cannot collide. Two consequences
to plan for:

- **Class names become camelCase**, because `styles.submit-btn` is not valid
  JavaScript. (`styles['submit-btn']` works but is ugly.)
- **The `*` and `body` rules must move out** — a module is the wrong home for
  app-wide resets. They belong in a real global file imported once from `main.jsx`,
  e.g. `frontend/src/styles/global.css`. That is the right move regardless of which
  option you pick.

The two options are complementary, not alternatives: tokens on `:root` in the global
file, scoped component styles in modules that consume them.
