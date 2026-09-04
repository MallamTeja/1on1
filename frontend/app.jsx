/**
 * frontend/app.jsx
 * ================
 * THE ROOT COMPONENT of the React tree.
 *
 * Imported by : frontend/main.jsx (rendered inside <React.StrictMode>).
 * Imports     : frontend/src/pages/login.jsx.
 * Exports     : default `App` - a function component taking no props.
 * Renders     : a single <div> wrapper containing <Login />.
 *
 * STATUS: this is currently a PASS-THROUGH WRAPPER. It adds one plain <div>
 * (with no className, so login.css does not style it) and renders exactly one
 * child. Right now the entire application IS the login screen.
 *
 * Like main.jsx, this file sits at frontend/ root rather than frontend/src/,
 * which is why the import below has to reach down into './src/pages/'.
 */

// React must be in scope for JSX under the classic transform, and it is kept here
// for consistency with main.jsx. With the automatic JSX runtime that
// @vitejs/plugin-react enables, this exact import is not strictly required for the
// JSX below to compile - but it is harmless and conventional.
import React from 'react';

// The one and only screen. The path is relative to frontend/, so it resolves to
// frontend/src/pages/login.jsx. `Login` is that file's DEFAULT export, which is why
// no braces are needed and why the local name could be anything.
import Login from './src/pages/login.jsx';

/*
 * App
 * ---
 * A function component: a plain JS function returning JSX (a description of UI)
 * that React turns into real DOM. It receives no props and holds no state, so it
 * re-renders only when main.jsx re-renders it - effectively once.
 *
 * THIS IS WHERE THE APP GROWS.
 * When frontend/src/pages/landingpage.jsx and register.jsx get filled in (both are
 * currently 0-byte EMPTY files), this component is the natural home for:
 *
 *   1. A ROUTER, e.g. react-router-dom:
 *
 *        <BrowserRouter>
 *          <Routes>
 *            <Route path="/"         element={<LandingPage />} />
 *            <Route path="/login"    element={<Login />} />
 *            <Route path="/register" element={<Register />} />
 *          </Routes>
 *        </BrowserRouter>
 *
 *      With a router in place, the register UI would move out of login.jsx's
 *      isLogin=false branch and into its own route/page. Note that a hard refresh
 *      on /login needs a history-API fallback: Vite's dev server provides one, but
 *      a production deploy must be configured to serve index.html for unknown paths.
 *
 *   2. GLOBAL PROVIDERS that must sit above every route - an <AuthProvider> holding
 *      the signed-in user and token, a theme context, a react-query
 *      <QueryClientProvider>, an <ErrorBoundary>. Providers wrap the router;
 *      the router wraps the pages.
 *
 * Until then, keeping App as a wrapper is fine and costs one extra DOM node.
 */
function App() {
  return (
    // A bare wrapper div. It carries no className, so no CSS rule targets it. It
    // exists only because a component must return a single root element - a
    // fragment would do the same job while emitting no DOM node at all.
    <div>
      {/* The login/register screen. No props: Login owns all of its own state. */}
      <Login />
    </div>
  );
}

/*
 * `export default App` marks App as this module's DEFAULT export - the single
 * "main thing" the file provides. Consumers import it without braces and may name
 * it whatever they like: in main.jsx, `import App from './app.jsx'` and
 * `import Root from './app.jsx'` are equivalent.
 *
 * Contrast with a NAMED export (export function App() {...}), which must be
 * imported with braces and the exact same name: import { App } from './app.jsx'.
 * A module may have many named exports but at most one default export.
 */
export default App;
