/**
 * frontend/main.jsx
 * =================
 * THE REACT BOOTSTRAP FILE - the bridge between static HTML and the React tree.
 *
 * Loaded by : frontend/index.html via <script type="module" src="/main.jsx">.
 *             Nothing imports this file; it is a side-effect-only entry module.
 * Imports   : frontend/app.jsx (the root component).
 * Exports   : nothing. It runs once, for its side effect of mounting React.
 * Renders   : <React.StrictMode><App /></React.StrictMode> into <div id="root">.
 *
 * Note the unusual location: this file lives at frontend/ root, not frontend/src/.
 * That is fine because index.html points at "/main.jsx" - Vite resolves the path
 * from the project root, wherever the file happens to sit.
 * See docs/code/04-frontend.md for the full render chain.
 */

// React itself. Needed here for the `React.StrictMode` component reference below.
// (With the modern JSX transform that @vitejs/plugin-react enables, React does NOT
// have to be in scope just to write JSX - but it does have to be imported to use
// `React.something` explicitly, as we do on the StrictMode line.)
import React from 'react'

// `react-dom/client` is the React 18+ entry point that exposes `createRoot`.
// The old package path `react-dom` still exports the legacy `ReactDOM.render`,
// but importing from `/client` is what opts this app into the concurrent renderer.
import ReactDOM from 'react-dom/client'

// The root component of the whole UI. `./app.jsx` is relative to THIS file, so it
// resolves to frontend/app.jsx. The explicit `.jsx` extension is required because
// Vite does not add `.jsx` to its default resolve.extensions list the way
// Webpack/create-react-app did.
import App from './app.jsx'

/*
 * createRoot(container).render(element)
 * ------------------------------------
 * React 18's CONCURRENT ROOT API. Two things happen on the next line:
 *
 *   1. `document.getElementById('root')` reaches into the DOM built by
 *      index.html and grabs `<div id="root"></div>`. This is the single point
 *      where the HTML file and the React app are wired together - change the id
 *      in one place and you must change it in the other, or React throws
 *      "Target container is not a DOM element".
 *
 *   2. `ReactDOM.createRoot(container)` creates a concurrent root, and
 *      `.render(...)` tells that root what tree to draw inside the container.
 *
 * Why not the legacy `ReactDOM.render(<App />, container)`?
 *   - Legacy `render` is a synchronous, blocking, single-pass renderer: once React
 *     starts committing an update it cannot be interrupted.
 *   - `createRoot` enables the concurrent renderer. React can start rendering an
 *     update, pause it to handle a higher-priority event (like typing in the
 *     password field), then resume or discard the work. It is the prerequisite for
 *     automatic batching of state updates, useTransition, useDeferredValue and
 *     streaming SSR.
 *   - Calling legacy `ReactDOM.render` under React 18 still works but logs a
 *     deprecation warning and silently drops back to legacy (non-concurrent) mode.
 *
 * The root object returned by `createRoot` is discarded here. That is normal for an
 * app that never unmounts; keeping a reference would let you call `root.unmount()`.
 *
 * The trailing comma after the closing `)` argument is just style - legal in
 * modern JavaScript.
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  /*
   * <React.StrictMode> - A DEVELOPMENT-ONLY CORRECTNESS CHECKER.
   *
   * It renders NO DOM of its own (no wrapper element, no styles, zero visual
   * effect) and it is stripped entirely from the production build - in `vite build`
   * output it costs nothing and does nothing.
   *
   * In dev it deliberately DOUBLE-INVOKES things that are supposed to be pure:
   *   - component function bodies are called twice per render;
   *   - useState / useMemo / useReducer initialisers run twice;
   *   - every useEffect mounts, immediately cleans up, then mounts again.
   * If a component keeps a counter outside state, mutates props, or forgets an
   * effect cleanup, the doubled run surfaces the bug now rather than in production.
   * This is also why a console.log can appear twice in dev - not a bug.
   *
   * It additionally warns about legacy APIs: string refs, findDOMNode, the old
   * context API, and deprecated lifecycle methods.
   *
   * Practical consequence here: Login has no effects and no side effects in its
   * body, so the double render is invisible today. The moment a
   * `fetch('/api/login')` lands inside a useEffect, expect it to fire twice in dev.
   */
  <React.StrictMode>
    {/* The single child: the root component from app.jsx. It takes no props. */}
    <App />
  </React.StrictMode>,
)
