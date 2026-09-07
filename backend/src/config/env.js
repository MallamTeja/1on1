/**
 * =============================================================================
 * backend/src/config/env.js — every environment variable, read in ONE place
 * =============================================================================
 *
 * WHY THIS FILE EXISTS
 *   Reading `process.env.FOO` scattered across ten modules is how config bugs
 *   happen: a typo'd key is `undefined` rather than an error, defaults drift
 *   apart between files, and nobody can answer "what do I need in my .env?"
 *   without grepping. So every variable is read here, exactly once, validated
 *   at boot, and exported as a frozen object. If the app starts, the config is
 *   good; if the config is bad, the app refuses to start instead of failing
 *   later on a user's login attempt.
 *
 *   This is the "fail fast at the boundary" pattern. The cost is one file; the
 *   payoff is that no code below this layer ever has to ask "is this set?".
 *
 * SECRETS DISCIPLINE
 *   Nothing in here is ever logged. The summary printed at boot deliberately
 *   prints only whether a secret is PRESENT, never its value — logs get shipped
 *   to CloudWatch, pasted into issues and screenshotted into chat.
 *
 * WHERE THE VALUES COME FROM
 *   backend/src/server.js calls dotenv.config() against the REPO-ROOT .env
 *   before importing this module, so `process.env` is already populated by the
 *   time anything here runs. See backend/.env.example for the full list.
 * =============================================================================
 */
import crypto from 'crypto';

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

/**
 * Read a required variable. In production a missing value is fatal — we throw
 * and the process exits, which is exactly what you want: a server running
 * without a JWT secret is worse than a server that did not start.
 */
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy backend/.env.example to the repo-root .env and fill it in.`
    );
  }
  return value;
}

/**
 * A secret that MUST be real in production, but may be auto-generated in
 * development so a fresh clone boots with no setup at all.
 *
 * The generated value is random per process, which has a deliberate and
 * visible consequence: restarting the server invalidates every issued token,
 * so you get logged out on each nodemon reload. That annoyance is the point —
 * it pushes you to set a real value in .env, and it guarantees this fallback
 * can never be mistaken for something shippable. In production it throws.
 */
function secretWithDevFallback(name) {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) return required(name);

  console.warn(
    `[config] ${name} is not set — generated a random one for this process only.\n` +
      `         Tokens will be invalidated on every restart. Set it in the repo-root .env.`
  );
  return crypto.randomBytes(48).toString('base64url');
}

/** process.env values are ALWAYS strings; coerce and validate rather than trust. */
function integer(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got "${raw}".`);
  }
  return parsed;
}

/** "a,b , c" -> ["a","b","c"]. Blank entries dropped so a trailing comma is harmless. */
function list(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const config = Object.freeze({
  nodeEnv: NODE_ENV,
  isProduction,
  port: integer('PORT', 5000),

  /**
   * Origins allowed to make credentialed browser calls to this API.
   *
   * This list is a SECURITY BOUNDARY, not a convenience setting. Because the
   * refresh token lives in a cookie the browser attaches automatically, any
   * origin on this list can make authenticated requests on a signed-in user's
   * behalf. `*` is not merely discouraged here — the browser flatly refuses to
   * combine a wildcard origin with `credentials: include`, which is the mode
   * every call in frontend/src/lib/api.ts uses.
   */
  corsAllowedOrigins: list('CORS_ALLOWED_ORIGINS', ['http://localhost:3000']),

  /** Where the Google callback sends the browser once the session cookie is set. */
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  accessTokenSecret: secretWithDevFallback('JWT_ACCESS_SECRET'),
  /** 15 minutes. Short on purpose — a stolen access token has a small window, and
   *  the refresh cookie is what provides continuity. */
  accessTokenTtlSeconds: integer('ACCESS_TOKEN_TTL_SECONDS', 900),
  refreshTokenTtlDays: integer('REFRESH_TOKEN_TTL_DAYS', 30),

  cookie: Object.freeze({
    /**
     * `Secure` means "only send over HTTPS". Mandatory in production; must be
     * off in local dev or the browser silently drops the cookie on http://.
     */
    secure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === 'true'
      : isProduction,
    /**
     * SameSite=Lax is right when the frontend and API share a site (the Vite
     * proxy in dev, or one domain in production). If the API is ever split onto
     * its own domain — api.example.com talking to app.example.com — this must
     * become 'none', and 'none' is only honoured together with Secure.
     */
    sameSite: process.env.COOKIE_SAMESITE || 'lax',
  }),

  google: Object.freeze({
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    /**
     * Must match a redirect URI registered in the Google Cloud console BYTE FOR
     * BYTE — Google compares it as an exact string, so a trailing slash or
     * http-vs-https difference is a redirect_uri_mismatch error.
     */
    redirectUri:
      process.env.GOOGLE_OAUTH_REDIRECT_URI ||
      'http://localhost:5000/api/auth/google/callback',
  }),
});

/**
 * Google sign-in is OPTIONAL and ADDITIVE (see docs/01-product-requirements.md):
 * email + password is the auth core and must keep working on its own. So a
 * missing client ID is not a boot failure — the two /api/auth/google routes
 * just answer 503 and everything else runs normally.
 */
export const isGoogleOAuthConfigured = Boolean(
  config.google.clientId && config.google.clientSecret
);

/** Boot summary. Presence only — never values. */
export function describeConfig() {
  return [
    `env=${config.nodeEnv}`,
    `port=${config.port}`,
    `cors=[${config.corsAllowedOrigins.join(', ')}]`,
    `cookies=${config.cookie.secure ? 'secure' : 'insecure'}/samesite-${config.cookie.sameSite}`,
    `google-oauth=${isGoogleOAuthConfigured ? 'configured' : 'NOT configured (routes return 503)'}`,
  ].join('  ');
}
