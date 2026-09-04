/**
 * frontend/src/pages/login.jsx
 * ============================
 * THE ONLY SCREEN THIS APP CURRENTLY RENDERS.
 *
 * Imported by : frontend/app.jsx  (App -> <Login />)
 * Exports     : default `Login` - a React function component, takes NO props.
 * Styles      : ./login.css - plain global CSS, sibling file, imported below.
 * Renders     : a centred white card split into a form column and (>= 768px only)
 *               a green SVG illustration column.
 *
 * DUAL-MODE BY DESIGN: this single component renders EITHER the "Sign in" view or
 * the "Create an account" view, switched by the `isLogin` boolean. There is no
 * separate register page - frontend/src/pages/register.jsx and
 * frontend/src/pages/landingpage.jsx both exist on disk but are EMPTY (0 bytes),
 * so registration is handled right here by the `isLogin === false` branch.
 *
 * !! MAIN GAP !! This is UI only. Nothing is submitted anywhere: the inputs are
 * uncontrolled (no value / no onChange), the submit handler calls
 * preventDefault() and stops, and there is not a single fetch() in the file.
 * See the <form> comment below and docs/code/04-frontend.md.
 */

// `useState` is the hook that gives a function component local, re-render-triggering
// state. React is imported for the same reason as in app.jsx (consistency; the
// automatic JSX runtime means the bare `React` identifier is not strictly required).
import React, { useState } from 'react';

// Importing CSS from JavaScript is a bundler feature, not a browser one. In dev
// Vite injects these rules into a <style> tag and hot-reloads them on save; in
// `vite build` they are extracted into a hashed .css file that index.html links.
// NOTE: this stylesheet is GLOBAL, not scoped - it contains bare `*` and `body`
// selectors, so importing it anywhere styles the whole document. A CSS Module
// (login.module.css) would scope the class names instead.
import './login.css';

// `export default` = this is the module's single main export, so app.jsx can write
// `import Login from './src/pages/login.jsx'` with no braces. Declaring the
// function inline with the export is just a compact form of
// `function Login() {...}` followed by `export default Login;`.
export default function Login() {
  /*
   * STATE - two independent booleans, nothing else.
   *
   * useState(initialValue) returns a 2-element array that is destructured into
   * [currentValue, setterFunction]. Calling the setter schedules a re-render of
   * this component; the value itself is never mutated in place.
   *
   * `isLogin` - which MODE the card is in.
   *     true  (initial) -> "Sign in" view: no Name field, shows Remember me +
   *                        Forgot password, submit button reads "Sign in".
   *     false           -> "Create an account" view: Name field appears, the
   *                        Remember me / Forgot password row disappears, submit
   *                        button reads "Register".
   * This one flag is what lets a single component serve both sign-in and register.
   */
  const [isLogin, setIsLogin] = useState(true);
  /*
   * `showPassword` - whether the password characters are visible.
   *     false (initial) -> <input type="password">, characters masked as dots.
   *     true            -> <input type="text">, characters readable.
   * It also selects which of the two eye icons the toggle button draws.
   */
  const [showPassword, setShowPassword] = useState(false);

  /*
   * EVENT HANDLERS.
   *
   * Both are defined with `const fn = () => ...` inside the component body, so a
   * brand-new function object is allocated on every render. That is fine here
   * (they are passed to plain DOM elements, which do not care about identity); it
   * would only matter if they were passed to a React.memo child or listed in a
   * hook dependency array, where `useCallback` would be the answer.
   *
   * !! STALE-STATE CAVEAT (comment only - do NOT change the code) !!
   * `setIsLogin(!isLogin)` reads `isLogin` from the CLOSURE of the render that
   * created this function. React 18 batches every state update inside an event
   * handler into a single re-render, so if this were called twice in one tick -
   * or from an async callback, a setTimeout, or a handler captured earlier - both
   * calls would read the SAME old `isLogin` and the second would just repeat the
   * first (net effect: one toggle, not two).
   * The safe idiom is the FUNCTIONAL UPDATER, which receives the latest queued
   * value rather than the closed-over one:
   *
   *     const toggleMode = () => setIsLogin(v => !v);
   *     const togglePasswordVisibility = () => setShowPassword(v => !v);
   *
   * With a single click handler and no async work, the current form happens to
   * behave correctly - which is exactly why this bug class is easy to miss.
   */
  const toggleMode = () => setIsLogin(!isLogin);
  const togglePasswordVisibility = () => setShowPassword(!showPassword);

  /*
   * ==========================================================================
   * `Illustration` - THE DECORATIVE SVG ARTWORK (right-hand green panel).
   * ==========================================================================
   *
   * !! ANTI-PATTERN (comment only - do NOT move the code) !!
   * This component is DEFINED INSIDE `Login`. Every time Login re-renders (which
   * happens on every toggle of isLogin or showPassword), the
   * `const Illustration = () => ...` line executes again and produces a
   * BRAND-NEW function object. React identifies element types by reference, so
   * `<Illustration />` from render N and render N+1 look like two DIFFERENT
   * component types. React therefore cannot reconcile them: it UNMOUNTS the
   * entire previous subtree - all ~35 SVG nodes - and MOUNTS a fresh one from
   * scratch. Any state, refs, DOM focus, CSS transition or animation inside that
   * subtree is destroyed each time. Here the SVG is static, so the only cost is
   * wasted DOM work on every toggle; in a subtree containing inputs it would
   * silently blow away whatever the user had typed.
   *
   * THE FIX (not applied): hoist it to module scope - move
   * `const Illustration = () => (...)` (or `function Illustration() {...}`) above
   * `export default function Login()`. It closes over nothing from Login, so the
   * move is purely mechanical. Better still, give it its own file.
   *
   * --------------------------------------------------------------------------
   * SVG PRIMER - the concepts used throughout the markup below, explained once.
   * --------------------------------------------------------------------------
   * viewBox="0 0 400 500"
   *     Defines the INTERNAL coordinate system: "min-x min-y width height". Every
   *     number in every child below is expressed in these 400x500 user units, not
   *     in pixels. The outer width="100%" height="100%" then scales that virtual
   *     canvas to fill whatever size the parent `.login-illustration-section` is.
   *     That is what makes the artwork resolution-independent: the same numbers
   *     draw the same picture at 300px or 3000px wide. The viewBox is 4:5 while
   *     the panel is not, so the default preserveAspectRatio ("xMidYMid meet")
   *     letterboxes the drawing and centres it.
   *
   * <path d="..."> - the general-purpose shape. `d` is a mini-language:
   *     M x,y   MOVETO      - lift the pen and jump to (x,y). Starts a subpath.
   *     L x,y   LINETO      - draw a straight line to (x,y).
   *     C x1,y1 x2,y2 x,y   CUBIC BEZIER - curve from the current point to (x,y),
   *                          bending toward control points (x1,y1) then (x2,y2).
   *                          The controls are magnets the curve leans into; the
   *                          curve does not pass through them.
   *     Z       CLOSEPATH   - draw a straight line back to the subpath's start,
   *                          sealing the outline so a `fill` has a defined inside.
   *     Uppercase letters are ABSOLUTE coordinates; lowercase would be relative to
   *     the current point. Everything in this file is absolute except the two
   *     lowercase `a` arc segments in the Heroicons eye icons further down.
   *
   * fill vs stroke
   *     `fill`   paints the INTERIOR of a shape. fill="none" means hollow - which
   *              every open path here sets explicitly, because SVG's default fill
   *              is BLACK and an unfilled open curve would otherwise render as an
   *              ugly black blob closed off by an implicit straight line.
   *     `stroke` paints the OUTLINE along the path. `strokeWidth` is its thickness
   *              in user units, so it scales with the viewBox like everything else.
   *
   * strokeLinecap / strokeLinejoin ("round")
   *     Cap = how a stroke ENDS (butt / round / square); join = how two segments
   *     MEET at a corner (miter / round / bevel). The character-2 legs use
   *     round + round with strokeWidth 12, which turns two thin line segments into
   *     a smooth tubular limb instead of a chopped-off bar.
   *
   * <g transform="translate(x,y)">
   *     A GROUP. Two purposes: (1) shared attributes cascade to all children - see
   *     the sparkle groups, where stroke and strokeWidth are declared once on the
   *     <g> and inherited by four <line>s; (2) `transform` establishes a LOCAL
   *     COORDINATE ORIGIN. Inside `translate(130, 200)`, the point (0,0) means
   *     (130,200) on the parent canvas, so the character is authored around its
   *     own centre with small numbers like cy="-30", and the whole figure moves by
   *     editing ONE pair of numbers. `scale(0.5)` on the sparkles multiplies every
   *     child coordinate, shrinking the same reusable four-line asterisk.
   *
   * SYNTAX REMINDER: inside JSX these are React props, so hyphenated SVG
   * attributes become camelCase (stroke-width -> strokeWidth), and a comment must
   * be a block comment wrapped in an expression container (brace, slash-star, text,
   * star-slash, brace). A bare // inside a JSX tree would render as visible text.
   *
   * ACCESSIBILITY: this SVG is purely decorative but has no <title>, no
   * role="img", and no aria-hidden="true". Adding aria-hidden="true" would
   * correctly hide it from screen readers.
   */
  const Illustration = () => (
    // width/height 100% plus absolute positioning make the SVG fill its parent
    // panel (.login-illustration-section is position:relative in login.css). The
    // inline `style` object is the JSX form of a style attribute: a JS object with
    // camelCased CSS properties, hence the double braces {{...}}.
    <svg width="100%" height="100%" viewBox="0 0 400 500" fill="none" xmlns="http://www.w3.org/2000/svg" style={{position: 'absolute', top: 0, left: 0}}>
      {/*
        GROUP 1 - BACKGROUND SWIRLS AND DOTS.
        Three long cubic-bezier curves plus three circles, all white at partial
        opacity so they read as faint texture over the green panel. The coordinates
        deliberately start negative (M -50,300) and end past 400 (450,250): the
        curves run OFF the canvas on both sides, so no start or end point is
        visible and the lines look like they continue beyond the panel.
        <circle> takes cx/cy (centre) and r (radius) instead of a `d` path.
      */}
      <path d="M -50,300 C 100,400 300,100 450,250" stroke="#ffffff" strokeWidth="1.5" fill="none" opacity="0.6"/>
      <path d="M -50,400 C 150,450 250,250 450,150" stroke="#ffffff" strokeWidth="1" fill="none" opacity="0.4"/>
      <path d="M 50,-50 C 150,150 250,-50 450,150" stroke="#ffffff" strokeWidth="1" fill="none" opacity="0.5"/>
      <circle cx="280" cy="320" r="40" stroke="#ffffff" strokeWidth="1" fill="none" opacity="0.6" />
      <circle cx="250" cy="80" r="4" stroke="#ffffff" strokeWidth="1.5" fill="none" />
      <circle cx="150" cy="420" r="3" fill="#ffffff" />

      {/*
        GROUP 2 - ABSTRACT ACCENT TRIANGLES.
        <polygon points="x1,y1 x2,y2 x3,y3"> is shorthand for a closed path: the
        last point is joined back to the first automatically, so `fill` always has
        a well-defined interior and no Z is needed. Two amber (#FBBF24), one white.
      */}
      <polygon points="280,100 290,110 270,110" fill="#FBBF24" />
      <polygon points="210,400 220,380 200,380" fill="#FBBF24" />
      <polygon points="120,250 110,260 110,240" fill="#ffffff" />

      {/*
        GROUP 3 - CHARACTER 1 (left figure, white + amber, holding a laptop).
        The <g transform="translate(130, 200)"> below moves this figure's local
        origin to (130,200) on the 400x500 canvas. Every coordinate inside the
        group is therefore RELATIVE to the figure's own hip point: negative y is up
        (head at cy="-30"), positive y is down (feet at y="80"). Reposition the
        whole character by editing only the translate() numbers.
      */}
      <g transform="translate(130, 200)">
        {/* Head: a filled white circle 30 units above the local origin, plus an
            open bezier for the hair sweep (fill="none", stroke only). */}
        <circle cx="0" cy="-30" r="15" fill="#ffffff" />
        <path d="M -10,-45 C -20,-30 5,-15 10,-35" stroke="#ffffff" strokeWidth="2" fill="none" />
        {/* Body: a CLOSED path (note the trailing Z) so the amber fill has an
            interior, with a white stroke outlining it. It curves up from the left
            hip, over the shoulders, down to the right hip, then Z straight back. */}
        <path d="M -20,0 C -10,-20 10,-20 20,0 Z" fill="#FBBF24" stroke="#ffffff" strokeWidth="1.5" />
        {/* Arm 1: two straight LINETO segments = shoulder -> elbow -> hand. */}
        <path d="M -15,-5 L -30,10 L -15,15" stroke="#ffffff" strokeWidth="2" fill="none" />
        {/* Arm 2: reaches right, ending at x=45 where the laptop sits. */}
        <path d="M 15,-5 L 30,5 L 45,0" stroke="#ffffff" strokeWidth="2" fill="none" />
        {/* Laptop / box: <rect> takes a top-left x/y plus width/height; rx="2"
            rounds the corners by 2 user units. */}
        <rect x="35" y="-15" width="18" height="25" rx="2" fill="#ffffff" />
        {/* Legs: hip -> knee -> ankle, again pure LINETO strokes. */}
        <path d="M -10,0 L -15,40 L -20,80" stroke="#ffffff" strokeWidth="2" fill="none" />
        <path d="M 5,0 L 15,35 L 5,75" stroke="#ffffff" strokeWidth="2" fill="none" />
        {/* Feet: two small amber rectangles at the ends of the legs. */}
        <rect x="-25" y="80" width="10" height="8" fill="#FBBF24" />
        <rect x="0" y="75" width="10" height="8" fill="#FBBF24" />
      </g>

      {/*
        GROUP 4 - CHARACTER 2 (right figure, red torso + blue legs).
        Same technique, local origin at (280,250). The interesting part is the
        legs: instead of a thin outline they use strokeWidth="12" with
        strokeLinecap="round" and strokeLinejoin="round", which turns a
        two-segment polyline into a thick tube with rounded ends and a rounded
        knee - a cheap way to draw a limb without authoring an outline path.
      */}
      <g transform="translate(280, 250)">
        {/* Head + hair sweep, same pattern as character 1. */}
        <circle cx="0" cy="-40" r="14" fill="#ffffff" />
        <path d="M -12,-55 C 0,-60 15,-50 12,-40" stroke="#ffffff" strokeWidth="2" fill="none" />
        {/* Body: a closed (Z) red shape. The second path is an open white triangle
            drawn ON TOP as a collar detail - fill="none", so the red underneath
            still shows through. SVG has no z-index: paint order is document order,
            so later siblings draw over earlier ones. */}
        <path d="M -22,-10 C -15,-35 15,-35 22,-10 Z" fill="#EF4444" stroke="#ffffff" strokeWidth="1.5" />
        <path d="M -15,-10 L 15,-10 L 0,10 Z" fill="none" stroke="#ffffff" strokeWidth="1.5" />
        {/* Arm 1: raised up and to the left (negative y = upward). */}
        <path d="M -18,-20 L -40,-40 L -50,-35" stroke="#ffffff" strokeWidth="2" fill="none" />
        {/* Arm 2: down and to the right. */}
        <path d="M 18,-20 L 30,-5 L 25,15" stroke="#ffffff" strokeWidth="2" fill="none" />
        {/* Legs: the thick rounded-stroke trick described above, blue #3B82F6. */}
        <path d="M -10,-10 L -25,20 L -10,50" stroke="#3B82F6" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M 10,-10 L 5,20 L 35,30" stroke="#3B82F6" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
        {/* Feet: red rectangles at the two ankle positions. */}
        <rect x="-15" y="55" width="10" height="8" fill="#EF4444" />
        <rect x="40" y="30" width="10" height="8" fill="#EF4444" />
      </g>

      {/*
        GROUP 5 - SPARKLES.
        The same four-line asterisk twice: a vertical line, a horizontal line and
        the two diagonals, each drawn from -10 to +10 around a local (0,0).
        `stroke` and `strokeWidth` are set ONCE on the <g> and INHERITED by all
        four <line> children - the attribute-cascade half of what a group is for.
        transform="translate(x,y) scale(n)" applies right-to-left: scale first,
        then translate. scale(0.5) and scale(0.4) give two different sizes from
        identical markup. <line> takes x1,y1 -> x2,y2 and is stroke-only by nature.
      */}
      <g transform="translate(90, 80) scale(0.5)" stroke="#ffffff" strokeWidth="2">
        <line x1="0" y1="-10" x2="0" y2="10" />
        <line x1="-10" y1="0" x2="10" y2="0" />
        <line x1="-7" y1="-7" x2="7" y2="7" />
        <line x1="-7" y1="7" x2="7" y2="-7" />
      </g>
      <g transform="translate(340, 110) scale(0.4)" stroke="#ffffff" strokeWidth="2">
        <line x1="0" y1="-10" x2="0" y2="10" />
        <line x1="-10" y1="0" x2="10" y2="0" />
        <line x1="-7" y1="-7" x2="7" y2="7" />
        <line x1="-7" y1="7" x2="7" y2="-7" />
      </g>
    </svg>
  );

  /*
   * THE RENDER OUTPUT.
   *
   * A component must return a single root element. Everything below is one tree:
   *   .login-container                full-viewport dark backdrop, flex-centres
   *     .login-card                   white rounded card, flex row
   *       .login-form-section         left column - the actual form
   *       .login-illustration-section right column - green panel + <Illustration/>
   *                                   (display:none until the 768px media query in
   *                                    login.css turns it into display:flex)
   *
   * `className` rather than `class`, because `class` is a reserved word in JS.
   */
  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-form-section">
          {/*
            TERNARY RENDERING: {condition ? a : b}.
            Anything inside single braces in JSX is a JS EXPRESSION whose result is
            rendered. A ternary is used (not if/else) because statements are not
            expressions and cannot appear here. The heading is the first of four
            things that flip with the mode.
          */}
          <h2 className="login-title">{isLogin ? 'Sign in' : 'Create an account'}</h2>

          {/*
            THE FORM.
            onSubmit fires when the submit button is clicked OR when Enter is
            pressed in any field. `e.preventDefault()` cancels the browser's
            DEFAULT behaviour, which for a <form> with no action attribute is a
            full-page GET back to the current URL - a hard navigation that would
            wipe React state and make the whole app flash and reload. Every SPA
            form needs this.

            !! THIS IS THE MAIN GAP IN THE FRONTEND !!
            The handler ONLY calls preventDefault. Concretely:
              - NO DATA IS READ. The inputs below are UNCONTROLLED: none has a
                `value` prop or an `onChange` handler, so React never sees what the
                user typed. The text lives only in the browser's DOM nodes.
              - NO DATA IS SENT. There is no fetch('/api/...'), no axios, no
                action= attribute. Submitting does literally nothing observable.
              - No validation, no loading state, no error message, no success path.
            Wiring it up means either adding value/onChange state per field (the
            controlled pattern) or reading the DOM via refs / new FormData(e.target),
            then POSTing to the backend - which today exposes only GET /api/health.
          */}
          <form onSubmit={(e) => e.preventDefault()}>
            {/*
              CONDITIONAL RENDERING WITH && (SHORT-CIRCUIT).
              `{cond && <jsx/>}` works because JS's && returns the RIGHT operand
              when the left is truthy, and the LEFT operand when it is falsy. So
              when !isLogin is true the element is returned and rendered; when it
              is false the expression evaluates to `false`, and React renders
              nothing at all for booleans, null and undefined.
              CAVEAT: the trick is only safe with real booleans. With a number,
              `{items.length && <List/>}` renders a literal "0" on screen, because
              0 is falsy but IS a renderable value. Prefer `cond ? x : null` when
              the left side is not guaranteed to be a boolean.

              Here: the Name field exists ONLY in register mode (isLogin === false).
            */}
            {!isLogin && (
              <div className="input-group">
                {/* A11Y: this <label> has no htmlFor and the <input> has no id, so
                    the two are not programmatically associated. A screen reader
                    announces the field as unlabelled, and clicking the label text
                    does not focus the input. Fix: id="name" + htmlFor="name" (JSX
                    uses htmlFor because `for` is a reserved word), or nest the
                    input inside the label. The Email and Password groups below
                    have exactly the same problem. */}
                <label className="input-label">Name</label>
                {/* .input-wrapper is position:relative - it is the positioning
                    context that the absolutely-positioned password toggle needs.
                    It is kept on all three groups for consistent markup. */}
                <div className="input-wrapper">
                  {/* Uncontrolled input: no value, no onChange, no name attribute.
                      `placeholder` is a hint that disappears on typing - it is not
                      a substitute for a label. */}
                  <input type="text" className="input-field" placeholder="John Doe" />
                </div>
              </div>
            )}

            {/* EMAIL - rendered in BOTH modes, so no conditional wrapper.
                type="email" gives mobile keyboards an @ key and enables the
                browser's built-in email validation... which never runs, because
                submission is cancelled before validation would matter. Same
                missing htmlFor/id association as above. */}
            <div className="input-group">
              <label className="input-label">Email</label>
              <div className="input-wrapper">
                <input type="email" className="input-field" placeholder="example.email@gmail.com" />
              </div>
            </div>

            {/* PASSWORD - rendered in both modes. This group holds the only
                genuinely interactive UI in the file. */}
            <div className="input-group">
              <label className="input-label">Password</label>
              <div className="input-wrapper">
                {/*
                  THE SHOW/HIDE SWAP.
                  `type` is driven by state: showPassword ? "text" : "password".
                  Changing the type attribute is all that is needed - the browser
                  redraws the same element unmasked, and because React patches the
                  attribute in place rather than replacing the node, the typed
                  value and the caret position survive the switch.
                  (The input is still uncontrolled - only `type` is reactive.)
                */}
                <input
                  type={showPassword ? "text" : "password"}
                  className="input-field"
                  placeholder="Enter at least 8+ characters"
                />
                {/*
                  type="button" is ESSENTIAL here. Inside a <form>, a <button> with
                  no type defaults to type="submit", so omitting it would make this
                  eye icon submit the form on every click.
                  A11Y: no aria-label, so a screen reader announces this as an empty
                  button. It needs something like
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  plus aria-pressed, and the inner SVG should be aria-hidden.
                */}
                <button type="button" className="password-toggle" onClick={togglePasswordVisibility}>
                  {/*
                    Ternary again, this time returning whole ELEMENTS rather than
                    strings - JSX values are first-class expressions. The
                    parentheses around each branch are only for readability.

                    Both icons are HEROICONS OUTLINE (24x24) paths: the "eye" when
                    the password is visible, the "eye-slash" when it is hidden.
                    stroke="currentColor" is the important attribute - it makes the
                    icon inherit the CSS `color` of its nearest styled ancestor,
                    which is `.password-toggle { color: #9ca3af }` in login.css.
                    Change that one CSS value (or add a :hover colour) and the icon
                    follows automatically; no SVG edit needed.
                    strokeWidth={1.5} uses braces because it is a NUMBER prop, not a
                    string. strokeLinecap/strokeLinejoin "round" soften the ends.
                  */}
                  {showPassword ? (
                    /* EYE (visible state): an outer almond/lens outline drawn from
                       two mirrored cubic beziers, plus a small closed path for the
                       pupil. fill="none" throughout - these are outline icons. */
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="20" height="20">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                  ) : (
                    /* EYE-SLASH (hidden state): the same eye broken into fragments
                       with a diagonal stroke through it. Note the lowercase `a`
                       commands in these `d` strings - ARC segments
                       (rx ry rotation large-arc-flag sweep-flag x y), used to draw
                       the round pupil; lowercase means relative to the current
                       point. */
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="20" height="20">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/*
              SIGN-IN-ONLY ROW: "Remember me" + "Forgot password?".
              The mirror image of the Name field above - && short-circuit again,
              but on `isLogin` instead of `!isLogin`, so this block exists only in
              sign-in mode and vanishes in register mode.

              Two issues here:
                - the checkbox is uncontrolled and never read; "Remember me" does
                  nothing at all.
                - href="#" is a DEAD LINK. It jumps to the top of the page and adds
                  a "#" to the URL. Until a real route or handler exists this should
                  be a <button> styled as a link (a control that does nothing yet is
                  not a hyperlink), or point at /forgot-password.
              Note the checkbox IS correctly associated with its label, because the
              input is NESTED INSIDE the <label> - implicit association, no id
              required. That is the pattern the three text fields above are missing.
            */}
            {isLogin && (
              <div className="form-options">
                <label className="checkbox-label">
                  <input type="checkbox" className="checkbox-input" />
                  Remember me
                </label>
                <a href="#" className="forgot-password">Forgot password?</a>
              </div>
            )}

            {/* THE SUBMIT BUTTON. type="submit" means clicking it fires the form's
                onSubmit above - which, as noted, cancels and does nothing else.
                Its label is the third thing driven by `isLogin`. */}
            <button type="submit" className="submit-btn">{isLogin ? 'Sign in' : 'Register'}</button>
          </form>

          {/* Separator text. The horizontal rules either side of it are pure CSS
              (.divider::before / ::after in login.css), not markup. The wording
              follows the mode too. Keeping the text on ONE line matters: JSX
              collapses whitespace around newlines, so splitting it would change
              the spacing around the interpolated word. */}
          <div className="divider">Or {isLogin ? 'sign in' : 'register'} with</div>

          <div className="social-login">
            {/*
              SOCIAL SIGN-IN BUTTON - decorative only. No onClick, no OAuth flow.
              type="button" again prevents accidental form submission.
              A11Y: no aria-label and no text content, so it announces as an empty
              button. It needs aria-label="Sign in with Google".
            */}
            <button type="button" className="social-btn google-btn">
              {/*
                GOOGLE "G" LOGO - four <path> segments, one per arc of the mark.
                In document order below: the right arm, the bottom arc, the left
                arc, and the top arc.

                !! BUG (flagged, deliberately NOT fixed) !!
                All FOUR paths are hardcoded fill="#EA4335" - Google red - so the
                logo renders as a flat single-colour glyph instead of the official
                four-colour mark. The correct brand colours, in the order the paths
                appear here, are:
                    path 1 (right arm) -> #4285F4  blue
                    path 2 (bottom arc) -> #34A853  green
                    path 3 (left arc)   -> #FBBC05  yellow
                    path 4 (top arc)    -> #EA4335  red   (this one is correct)
                Shipping a recoloured Google mark also breaches Google's brand
                guidelines, so this is a correctness issue, not just cosmetics.
                It is partly camouflaged by .social-btn's pink #fef2f2 background.
              */}
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#EA4335"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#EA4335"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#EA4335"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            </button>
          </div>

          {/*
            MODE SWITCHER - the only control in this file that actually changes
            anything. The prompt text flips with a ternary and the button label
            flips the opposite way, so the pair always reads sensibly:
              sign-in  : "Don't have an account?  Register"
              register : "Already have an account?  Sign in"
            onClick={toggleMode} passes the FUNCTION REFERENCE. Writing
            onClick={toggleMode()} would call it during render instead, setting
            state on every render - an infinite re-render loop.
            The gap between the text and the button comes from
            .toggle-mode-btn { margin-left: 0.25rem }, not from markup whitespace
            (JSX drops whitespace-only text that spans a newline).
          */}
          <div className="toggle-mode">
            {isLogin ? "Don't have an account?" : "Already have an account?"}
            <button type="button" className="toggle-mode-btn" onClick={toggleMode}>
              {isLogin ? 'Register' : 'Sign in'}
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN - the green artwork panel. It is display:none by default
            and only becomes display:flex at >= 768px (see the @media rule in
            login.css), so on phones the card is a single form column. The
            <Illustration/> subtree is still CREATED on small screens - it is
            hidden by CSS, not skipped by JS. */}
        <div className="login-illustration-section">
          <Illustration />
        </div>
      </div>
    </div>
  );
}
