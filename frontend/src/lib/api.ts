/**
 * Thin wrapper over the 1on1 Node/Express API.
 *
 * The one rule that shapes everything here: no token ever travels in a URL.
 * The backend sets an HTTP-only refresh cookie and every call opts into
 * sending it with `credentials: "include"`; the short-lived access token comes
 * back in a response body and is held in memory only.
 *
 * Scope: this is the auth surface only. More calls get added as features land.
 *
 * NOTE: `1on1/backend` currently exposes only `GET /api/health` — none of the
 * endpoints below exist yet. That is expected; the frontend lands first and the
 * pages stay walkable through the NetworkError path.
 */
import type { AuthResponse } from "./types";

/**
 * Empty default is correct: `vite.config.js` proxies `/api` to
 * http://localhost:5000 in dev, so same-origin relative paths just work.
 */
const API_BASE: string = import.meta.env.VITE_API_BASE_URL ?? "";

/**
 * The short-lived access token, held in memory only (see the file header).
 * Every request reads it from here rather than from React state, since these
 * functions are plain async calls, not hooks — ./auth.tsx calls
 * `setAccessToken` whenever a login/register/refresh response resolves.
 *
 * Deliberately NOT localStorage/sessionStorage: anything readable by script is
 * readable by injected script, and the refresh token stays in an HTTP-only
 * cookie for the same reason.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

function authHeader(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

/**
 * The server answered, and said no. A runtime class, not a type alias — the
 * pages branch on `instanceof` and read `.status` (Login on 401, Register on
 * 409), so this has to survive to runtime.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** The server never answered — not deployed, offline, CORS, DNS. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

async function post(path: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...authHeader(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new NetworkError(`${path} could not be reached`);
  }

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload?.message) message = payload.message;
    } catch {
      /* a non-JSON error body is fine — keep the status line */
    }
    throw new ApiError(response.status, message);
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Exchange the HTTP-only refresh cookie for a fresh access token. The body
 * carries `user` too — every caller should read the signed-in user from
 * *this* response rather than from anything left over from a previous
 * session, since it is the only place that is guaranteed current.
 *
 * The refresh cookie is single-use and rotates on every call, so this must
 * never be fired twice concurrently — see the `started` ref in ./auth.tsx.
 */
export function refreshSession() {
  return post("/api/auth/refresh") as Promise<AuthResponse>;
}

export function loginWithPassword(email: string, password: string) {
  return post("/api/auth/login", { email, password }) as Promise<AuthResponse>;
}

/**
 * Field names match the register endpoint's expected body exactly — the name
 * field is `fullName`, and a `name` key would arrive as a blank fullName and
 * fail validation.
 */
export function registerAccount(input: {
  fullName: string;
  email: string;
  password: string;
}) {
  return post("/api/auth/register", input) as Promise<AuthResponse>;
}

/**
 * The OAuth entry point. Hitting it is a full-page navigation, not a fetch —
 * Google has to see the browser. The backend would finish by redirecting back
 * to this origin with the refresh cookie set and no token in the URL.
 *
 * TODO: not implemented on the Node backend yet — 1on1/backend currently
 * exposes only GET /api/health. Google OAuth is documented as optional/additive
 * and must not replace email+password auth.
 */
export function googleAuthorizeUrl(): string {
  return `${API_BASE}/api/auth/google`;
}
