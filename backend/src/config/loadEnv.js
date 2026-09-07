/**
 * backend/src/config/loadEnv.js — populate process.env from the repo-root .env.
 *
 * WHY THIS IS ITS OWN FILE, AND WHY IT IS IMPORTED FIRST
 *   This logic used to sit in the body of server.js, which worked while nothing
 *   else read process.env at import time. It stopped working the moment
 *   config/env.js appeared, because of an ESM rule that has no CommonJS
 *   equivalent:
 *
 *     ES MODULE IMPORTS ARE HOISTED. Every `import` in a file is resolved and
 *     the imported module is fully EXECUTED before the first line of the
 *     importing file's own body runs.
 *
 *   So in a file written like this:
 *
 *       import { config } from './config/env.js';   // <- runs FIRST
 *       dotenv.config({ path: ... });               // <- runs SECOND
 *
 *   env.js reads process.env before dotenv has put anything in it. Every
 *   variable is undefined, every default silently applies, and the .env file
 *   appears to be ignored. Nothing errors — you just get a server that quietly
 *   runs on the wrong configuration. With `require()` this bug does not exist,
 *   because require() executes where you write it.
 *
 *   The fix is to make the load itself an import, and to place it above the
 *   others. Static imports are evaluated in source order, so
 *
 *       import './config/loadEnv.js';               // side effect: fills process.env
 *       import { config } from './config/env.js';   // now reads real values
 *
 *   is guaranteed to run in that order. An import with no bindings, kept solely
 *   for its side effect, is a legitimate and named ESM pattern — but it is also
 *   exactly the kind of line a tidy-up commit deletes for looking useless, so:
 *
 *   !! DO NOT REORDER OR REMOVE THE loadEnv IMPORT IN server.js !!
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// In CommonJS, Node injected `__filename` and `__dirname` into every module. ES
// modules are a language standard rather than a Node one, so those Node-only
// globals DO NOT EXIST here — referencing __dirname directly throws
// "ReferenceError: __dirname is not defined in ES module scope".
//
// The replacement is `import.meta.url`, a STRING holding this module's absolute
// file:// URL, e.g. on Windows:
//     "file:///C:/Users/tejam/OneDrive/myproj/1on1/backend/src/config/loadEnv.js"
// That is a URL, not a path, and cannot be handed to `fs` or `path` as-is: it
// carries the "file://" scheme, percent-encodes spaces and non-ASCII characters
// ("My%20Docs"), and on Windows puts a leading slash before the drive letter.
// fileURLToPath() handles all three. (This repo lives under a OneDrive path —
// exactly the kind of location where an encoded character shows up, so the
// conversion is not academic.)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Walking the path from here (= backend/src/config):
//     backend/src/config  --  ".."   -->  backend/src
//     backend/src         --  ".."   -->  backend
//     backend             --  ".."   -->  <repo root>
//     <repo root>         --  ".env" -->  <repo root>/.env
// ONE .env for the whole monorepo, next to package.json and
// pnpm-workspace.yaml — not one per package. This deliberately matches the
// frontend: frontend/vite.config.js sets `envDir: '../'` so Vite reads the same
// file. One source of configuration truth, no drift between the two.
//
// An explicit path (rather than dotenv's default of process.cwd()) is what
// makes this correct no matter which directory the server was started from.
//
// This MUTATES the global process.env as a side effect. If the file does not
// exist dotenv does not throw — process.env is simply left as it was, which is
// why the app still boots on a fresh clone with no .env at all.
dotenv.config({ path: path.join(__dirname, '../../../.env') });
