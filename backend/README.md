# 1on1 backend — authentication

Node 24 · Express 4 (ESM) · pnpm workspace package `1on1-backend`

Email + password is the auth core. Google sign-in is **optional and additive** —
the server runs fully without any Google credentials configured, and the two
Google routes answer `503` in that state.

> **Google OAuth is not GCP hosting.** Google is used here purely as an identity
> provider: two HTTPS calls to public endpoints at `accounts.google.com`, then
> this server issues its own tokens for its own user records. There is no
> `@google-cloud/*` package, no Firebase, and no Google client library in this
> backend. Infrastructure stays AWS-only.

---

## Run it

```bash
pnpm --filter 1on1-backend run dev     # nodemon
pnpm --filter 1on1-backend start       # plain node
```

Boots with no `.env` at all. It prints a one-line config summary naming which
secrets are present (never their values) and warns loudly when it has generated
a throwaway JWT secret.

---

## Endpoints

| Method | Path | Success | Failure |
|---|---|---|---|
| `GET`  | `/api/health` | `200` | — |
| `POST` | `/api/auth/register` | `201` `AuthResponse` | `400` invalid · **`409` email taken** |
| `POST` | `/api/auth/login` | `200` `AuthResponse` | `400` invalid · **`401` bad credentials** |
| `POST` | `/api/auth/refresh` | `200` `AuthResponse` | `401` missing/stale cookie |
| `POST` | `/api/auth/logout` | `204` | — (never fails) |
| `GET`  | `/api/auth/me` | `200` `UserResponse` | `401` |
| `GET`  | `/api/auth/google` | `302` → Google | `503` not configured |
| `GET`  | `/api/auth/google/callback` | `302` → frontend | `302` → `/login?error=…` |

The **409** and **401** are a contract, not a preference: `Register.tsx` branches
on 409 and `Login.tsx` on 401. Every error body is
`{ "message": "..." }`, because `frontend/src/lib/api.ts` reads `.message` off it.

`googleAuthorizeUrl()` in the frontend already returns `/api/auth/google`, which
matches exactly — **no frontend change is required** to light up the button.

### Google callback error codes

Redirects to `${FRONTEND_URL}/login?error=<code>` with one of
`google_failed`, `google_cancelled`, `google_email_unverified`,
`google_unavailable`. Codes are deliberately coarse so they cannot be used to
probe which accounts exist. The frontend currently ignores `?error=` — rendering
a message for it is an optional follow-up owned by the frontend workstream.

---

## Token model

| | Access token | Refresh token |
|---|---|---|
| Format | JWT, HS256 | opaque, 32 random bytes |
| Lifetime | 15 min | 30 days |
| Travels in | response **body** | **HTTP-only cookie** |
| Stored server-side | not at all | only as a SHA-256 hash |
| Revocable | no (hence short) | yes, instantly |
| Rotation | — | **single-use**, rotates on every refresh |

The client holds the access token in memory only — never `localStorage`. The
refresh cookie is `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` in production.

Because refresh is single-use, it must never be fired twice concurrently. The
frontend already handles this with the `started` ref in `lib/auth.tsx`.

**Google sign-in ends in the same place as password login:** the callback sets
the same refresh cookie and redirects to the frontend root. `AuthProvider` calls
`refreshSession()` once on mount and picks the session up from there. No token
ever appears in a URL.

---

## Environment variables

Full annotated list with defaults: [`.env.example`](.env.example). Copy it to
the **repo root** as `.env` (one `.env` for the whole monorepo — the frontend's
`vite.config.js` sets `envDir: '../'` to read the same file).

Nothing is required to boot. In practice you want:

| Variable | Why |
|---|---|
| `JWT_ACCESS_SECRET` | Otherwise regenerated per process → logged out on every restart |
| `GOOGLE_OAUTH_CLIENT_ID` | Required for the Google button |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Required for the Google button |
| `GOOGLE_OAUTH_REDIRECT_URI` | Must match the Google console **byte for byte** |
| `CORS_ALLOWED_ORIGINS` | Must list the real frontend domain before deploying |

`CORS_ALLOWED_ORIGINS` cannot be `*`. Browsers refuse to combine a wildcard
origin with credentialed requests, and every call in `api.ts` uses
`credentials: "include"` — so `*` would be broken, not merely insecure.

---

## The database seam — read before touching persistence

**`src/repositories/userRepository.js` is an in-memory `Map`. All data is lost on
every restart, and it refuses to load when `NODE_ENV=production`.**

This exists because the AWS database service is still an open decision in
`docs/02-technology-stack.md §1`. Rather than block auth on it, every
persistence call in the app goes through that file's eight functions and nothing
else — no route, service or middleware builds a query, names a table, or imports
a driver.

To swap in the real database: write one new module exporting the same eight
functions, change the import in the files that use it, delete the old one.
Nothing else in the codebase changes. Its header documents the required indexes
and the two places a real implementation must be **atomic** (username assignment
and refresh-token consumption).

---

## Security decisions worth knowing

**Account linking (`routes/googleAuth.js`).** If a Google email matches an
existing password account, the accounts are linked — but **only when Google
reports `email_verified: true`**. Linking on the email alone is a known account
takeover: `email_verified: false` means Google is passing along an address it
has *not* confirmed, so an attacker could set that address on their own account
and be handed the real user's. When Google reports unverified, sign-in is refused
outright and no account is created either — creating one would squat on an
unproven address and lock the real owner out at registration.

*Remaining gap:* linking happens silently. Best practice is to email the owner
when a provider is added. Needs an email pipeline the app does not have yet.

**Google identities are matched on `sub`, never on email.** An email can be
changed by its owner, and a Workspace address can be reassigned to a different
employee; `sub` is permanent and never reused.

**User enumeration.** Login runs bcrypt against a dummy hash when the email is
unknown, so both paths take comparable time and cannot be told apart with a
stopwatch. Every login failure returns one identical message. Registration
*does* disclose that an email is taken — a deliberate tradeoff for a usable
signup form, resolved properly once email verification exists.

**Errors never leak.** Stack traces go in a response only for a genuine `500`,
and only outside production. The malformed-JSON handler logs a single line
*without* the error object, because `body-parser` attaches the raw request body
to its `SyntaxError` — which on a login attempt is the user's cleartext password.

**PKCE + `state`.** `state` is the CSRF defence and is verified with a
constant-time comparison. PKCE is not strictly required for a confidential
client, but is included to close authorization-code injection. Both values live
in short-lived `SameSite=Lax` HttpOnly cookies rather than server memory, so a
handshake survives a restart and works across multiple instances.

---

## Dependencies added

| Package | Why |
|---|---|
| `jose` | Signs our HS256 access tokens **and** verifies Google's RS256 ID tokens against Google's rotating JWKS. Replaces both `jsonwebtoken` and `jwks-rsa`; zero dependencies. |
| `bcryptjs` | Same algorithm and hash format as `bcrypt`, pure JS. Native `bcrypt` cannot work here — the repo's `.npmrc` pins `only-built-dependencies=["esbuild"]`, so pnpm will not run its install script and the binding would be missing. Swapping to native later is a one-line import change; stored hashes stay valid. |
| `cookie-parser` | Parses the `Cookie` header into `req.cookies`. Refresh and the Google callback both need it. |

No Passport, no auth SaaS, no Google SDK.

---

## Tests

```bash
pnpm --filter 1on1-backend test        # 87 tests, ~14s, exits non-zero on failure
pnpm --filter 1on1-backend test:watch
```

`node:test` + `node:assert` — both built into Node 24. **No test framework
dependency**; the suite adds zero packages to the tree.

| File | Covers |
|---|---|
| `tests/smoke.test.js` | the server boots, and every router is *mounted* not merely imported |
| `tests/auth.test.js` | register/login/refresh/logout/me, status codes, cookie flags, rotation |
| `tests/security.test.js` | the two regressions below, CORS allowlist, production guard |
| `tests/google.test.js` | the whole OAuth flow, offline |
| `tests/helpers/` | server process harness + the Google stub |

Each test starts a **real server as a child process** on a free port. That is
slower than importing the app, but it is the only way to test the three things
that matter most: what the server writes to **stdout** (the canary below),
whether it **boots at all**, and behaviour that depends on env read at load time.

**Google is tested entirely offline.** `tests/helpers/googleStub.js` is loaded
with Node's `--import` flag before the app starts and replaces `globalThis.fetch`,
serving a JWKS whose keys it controls. The real verification path therefore runs
for real — signature, issuer, audience and expiry are all genuinely checked —
while nothing leaves the machine. The stub throws on any unexpected outbound
request, so a test that starts depending on the internet fails rather than
passing slowly. **No production code was modified to make this testable**; in
particular the Google endpoint URLs stay hardcoded, since a configurable token
URL is where the client secret gets sent and is not worth making injectable.

### The two regression tests that matter most

Both pin bugs that were real in this codebase on 2026-09-06:

1. **Stack traces on client errors.** A malformed-JSON `400` was returning
   `err.stack`, exposing absolute paths and dependency versions to an
   unauthenticated caller.
2. **The password canary.** `body-parser` attaches the raw request body to its
   `SyntaxError`, so `console.error(msg, err)` wrote the user's **cleartext
   password to stdout** on a malformed login. The test sends a distinctive
   password, captures the server's output, and asserts the string appears
   nowhere — while also asserting the request *was* logged, so it cannot pass by
   looking at an empty buffer.

> Do not "simplify" `middleware/errorHandler.js` by passing `err` to the logger
> on the malformed-JSON path. That reintroduces the leak.

### Proof the suite actually bites

Assertions that never run are worse than no tests. Both bugs above were
**deliberately reintroduced** and the suite was re-run:

| Mutation | Result |
|---|---|
| `console.warn(..., err)` in `errorHandler.js` | ✖ `a malformed login body does not write the password to stdout/stderr` |
| removed the `delete` in `consumeRefreshToken` | ✖ `SINGLE USE: replaying a consumed refresh cookie returns 401` |

Both files were then restored and verified byte-identical, and the full suite
returned to 87/87.

One test was **rewritten because it was wrong**, not because the code was: it
asserted the server makes an authorization code single-use. It does not and
cannot — the code is Google's, and Google is what refuses to redeem it twice.
The test now asserts what this codebase actually guarantees (the callback clears
the handshake cookies); handling Google's `invalid_grant` is covered separately.

### Not covered

- Real Google credentials against the live consent screen. The protocol is fully
  exercised against the stub, but nobody has clicked the real button yet.
- Timing-attack resistance on login. The dummy-hash comparison is in place, but
  asserting on wall-clock timing produces flaky tests; it is verified by reading
  the code, not by the suite.
- Concurrency on refresh rotation. Single-use is enforced per request, but the
  in-memory `consumeRefreshToken` is not atomic — that is a property of the real
  database implementation and is flagged in `userRepository.js`.

---

## Manual verification (pre-suite)

The suite above supersedes this, but the original manual curl run against a
running server also passed:

- register `201` → duplicate `409` (including a **different-case email**, which
  proves normalization) → wrong password `401` → login `200`
- `Set-Cookie` confirmed `HttpOnly; SameSite=Lax`; confirmed in the cookie jar
- refresh rotates the cookie to a new value; **replaying the old cookie → `401`**
- `/me` `200` with a token, `401` without one and with a malformed one
- logout `204`, clears the cookie, and refresh afterwards → `401`
- validation `400`s with specific messages; malformed JSON `400` with no stack
  and no password in the response *or* the log (checked with a canary string)
- unknown route → **JSON** `404`, not Express's HTML
- CORS: allowed origin echoed with `credentials: true`; disallowed origin gets
  no `Access-Control-Allow-Origin`; preflight `204`
- `NODE_ENV=production` refuses to boot (in-memory store guard)
- Google: authorize redirect carries correct `client_id`, `redirect_uri`,
  `scope=openid email profile`, `state`, `code_challenge` + `S256`,
  `prompt=select_account`; handshake cookies set `HttpOnly`, 10-minute expiry,
  scoped to `/api/auth/google`
- Google callback rejections all redirect (never `500`): no cookies, mismatched
  state, **same-length** mismatched state (constant-time compare does not throw),
  user cancelled, and a valid-state/bad-code exchange against Google's **real**
  token endpoint

**Not tested — needs real credentials:** the actual consent screen, a successful
code exchange, ID-token signature verification against live Google JWKS, and
therefore find-or-create, account linking, and the final redirect with a session.
Those paths are written but have never executed end to end.
