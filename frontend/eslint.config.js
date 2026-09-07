/**
 * ESLint flat config (ESLint 10).
 *
 * Flat config replaced .eslintrc: there is no `env`, no `extends` string, and
 * no cascading lookup up the directory tree. This one file IS the whole
 * configuration, and config objects apply in array order — later entries win.
 *
 * The frontend is TypeScript-only; `tsc -b --noEmit` (pnpm run typecheck) is
 * still the authority on types. ESLint's job here is the class of problem the
 * compiler does not model: hook call order, effect dependencies, and the
 * correctness rules that are legal TypeScript but still bugs.
 */
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // Build output, deps, and the two config files that run in Node rather than
  // the browser — linting them against browser globals is noise, not signal.
  globalIgnores(["dist", "node_modules", "eslint.config.js", "vite.config.js"]),

  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      // Non-type-checked on purpose. The type-aware preset needs a TS Program
      // per lint run, which is slow, and `pnpm run typecheck` already covers
      // what it would add. Worth revisiting if async bugs start slipping past.
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      // Flat config has no `env: { browser: true }` — globals are explicit now.
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...reactRefresh.configs.vite.rules,
    },
  },

  {
    // A context provider legitimately colocates the provider component with
    // its consumer hook — src/lib/auth.tsx exports AuthProvider AND useAuth,
    // which is the shape React's own context docs recommend. Fast Refresh
    // genuinely degrades for such a file; splitting them to satisfy the rule
    // would be worse code for a dev-only convenience, so the rule is scoped
    // off here rather than the file being reshaped around it.
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: { "react-refresh/only-export-components": "off" },
  },
]);
