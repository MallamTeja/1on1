/**
 * frontend/vite.config.js
 * =======================
 * Configuration for Vite - the dev server + build tool for the frontend.
 *
 * Loaded by  : the `vite` CLI, automatically, from the project root. The project
 *              root is `frontend/` because that is the directory pnpm runs the
 *              scripts in (frontend/package.json -> "dev": "vite").
 * Exports    : one default config object.
 * Applies to : `pnpm dev:frontend` (vite), `vite build`, `vite preview`.
 *
 * This file is BUILD TOOLING that runs in Node. It is never shipped to the browser.
 */

// `defineConfig` is, at runtime, an IDENTITY FUNCTION - it returns the object you
// hand it, completely unchanged. Its only purpose is TYPING: it is declared as
// (config: UserConfig) => UserConfig, so editors and TypeScript can autocomplete
// every key below and flag typos. Without it the object literal would be untyped
// and a mistake like `serverr: { ... }` would be silently ignored.
import { defineConfig } from 'vite';

// The official React plugin. It does two jobs:
//   1. JSX TRANSFORM - hands .jsx files to esbuild/Babel so `<App />` compiles to a
//      `jsx(App)` call. Without this plugin Vite would not know how to parse the
//      JSX in main.jsx, app.jsx or login.jsx at all, and every file would fail.
//   2. FAST REFRESH - hot-swaps an edited component in the running page while
//      PRESERVING its useState values, so `isLogin` / `showPassword` survive a save
//      instead of resetting on every keystroke of development.
import react from '@vitejs/plugin-react';

export default defineConfig({
  // WHERE VITE LOOKS FOR .env FILES.
  // Default is the project root (`frontend/`). Setting '../' points one level up,
  // to the REPO ROOT, so frontend and backend read from ONE shared .env file.
  // This is deliberate and mirrors the backend: backend/src/server.js calls
  //     dotenv.config({ path: path.join(__dirname, '../../.env') })
  // which resolves to that exact same repo-root .env. One file, two consumers,
  // no drift between them. (.env is gitignored at the repo root.)
  //
  // SECURITY - THE `VITE_` PREFIX RULE:
  // Vite exposes ONLY variables whose name starts with `VITE_` to client code, as
  // `import.meta.env.VITE_FOO`. Every other key in that .env - DB_URI, JWT_SECRET,
  // GEMINI_API_KEY, SMTP passwords - is filtered out and never reaches the browser.
  // The reason is that the frontend bundle is PUBLIC: anything inlined into it is
  // readable by anyone through View Source or devtools, and minification is not
  // obfuscation. The prefix is an explicit opt-in that says "I accept this value
  // is public". The corollary is the important half: NEVER name a secret
  // VITE_SOMETHING, because that single rename is all it takes to publish it.
  envDir: '../',

  // Plugin list. `react()` is called (not just referenced) because the plugin is a
  // factory that returns the actual plugin object(s); calling it with no arguments
  // takes all defaults.
  plugins: [react()],

  // Dev-server-only settings. Everything under `server` is ignored by `vite build`.
  server: {
    // Serve the app on http://localhost:3000 instead of Vite's default 5173.
    // 3000 keeps the frontend and the backend's 5000 clearly separated, and the
    // proxy target below assumes this split.
    port: 3000,

    /*
     * DEV PROXY - the reason this app needs no CORS handling in development.
     *
     * How it works: the browser is only ever talking to ONE origin,
     * http://localhost:3000. When page code calls `fetch('/api/health')`, the
     * browser resolves that relative URL against the current origin and sends the
     * request to localhost:3000/api/health. The Vite dev server matches the '/api'
     * prefix below, and instead of trying to serve a file it forwards the request
     * server-to-server to http://localhost:5000/api/health, then streams the
     * response back. The path is preserved as-is (there is no `rewrite` here, so
     * '/api' is NOT stripped - which is correct, because Express registers the
     * route as app.get('/api/health', ...)).
     *
     * WHY THAT MATTERS FOR CORS:
     * Because the browser only ever sees localhost:3000, there is NO cross-origin
     * request in dev at all - no preflight OPTIONS, no Access-Control-Allow-Origin
     * check. The hop from Vite to Express happens in Node, and the same-origin
     * policy is a browser rule, not a network rule.
     * Consequence: `app.use(cors())` in backend/src/server.js is REDUNDANT for
     * traffic that goes through this proxy. It is still needed for:
     *   - hitting http://localhost:5000/api/... directly from the browser, another
     *     port, Postman-in-browser, or a second frontend;
     *   - any production deploy where the API lives on a different origin
     *     (api.example.com vs app.example.com) - a split-origin setup where the
     *     browser really does make a cross-origin request.
     *
     * changeOrigin: true
     *   Rewrites the outgoing HTTP `Host` header from `localhost:3000` to the
     *   target's host (`localhost:5000`). Locally this changes nothing that
     *   Express cares about, but it is the setting that makes the proxy work
     *   against virtual-hosted targets (a Vercel/Heroku/nginx backend that routes
     *   by Host header, or an https API that also checks SNI). Leaving it off is a
     *   classic source of 404s and TLS errors once the target is not localhost.
     *
     * !! THIS PROXY IS DEVELOPMENT-ONLY !!
     * `vite build` emits static HTML/JS/CSS into dist/ - there is no Vite server
     * left to proxy anything. In production a relative fetch('/api/health') hits
     * whatever static host serves dist/ and 404s. Production therefore needs one
     * of:
     *   - a real reverse proxy (nginx / Caddy / a platform rewrite rule) that maps
     *     /api -> the Node service, keeping one origin and still no CORS; or
     *   - an absolute API base URL baked in at build time via an env var, e.g.
     *     import.meta.env.VITE_API_URL - which DOES make the calls cross-origin
     *     and so does require the backend's cors() to be configured with an
     *     explicit allowed origin.
     */
    proxy: {
      // Match any request path that starts with '/api'. A bare string key like
      // this is a prefix match; regex keys and a `rewrite` function are also
      // supported if the prefix ever needs stripping.
      '/api': {
        // Where matched requests are forwarded. Must match the Express PORT in
        // backend/src/server.js (process.env.PORT || 5000).
        target: 'http://localhost:5000',
        // Rewrite the Host header to the target's host - see the note above.
        changeOrigin: true
      }
    }
  }
});
