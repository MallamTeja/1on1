/**
 * Who is signed in, for the lifetime of the tab.
 *
 * The access token is deliberately memory-only (see the note at the top of
 * ./api.ts), so the user record that rides along with it lives here in the
 * same way — a plain React state value, never localStorage/sessionStorage.
 * That is what makes a fresh registration or login show up immediately: the
 * only source for "who is this" is the AuthResponse each auth call just
 * returned, not anything left over from a previous session in this browser.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { refreshSession, setAccessToken } from "./api";
import type { AuthResponse, UserResponse } from "./types";

type AuthState = {
  /** Signed-in user, or null once restoration has finished and found none. */
  user: UserResponse | null;
  /** True until the initial session-restore call below has settled. */
  loading: boolean;
  /**
   * Login/register/refresh all resolve an AuthResponse — hand the whole
   * thing here, not just `user`. This is also what puts the access token
   * into api.ts's in-memory holder, so every subsequent request carries it;
   * pass null to clear both (e.g. a failed/absent session).
   */
  setSession: (session: AuthResponse | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserResponse | null>(null);
  const [loading, setLoading] = useState(true);

  function setSession(session: AuthResponse | null) {
    setAccessToken(session?.accessToken ?? null);
    setUser(session?.user ?? null);
  }
  // refreshSession() rotates the single-use refresh cookie (see the comment
  // on it in ./api.ts), so it is not safe to fire twice concurrently — the
  // second call would invalidate the cookie the first call just rotated in.
  // React 18 StrictMode's dev-only mount→cleanup→remount runs this effect
  // twice regardless, so a plain "cancelled" flag isn't enough: it only
  // decides which response to keep, and here it can end up keeping the
  // failed one. This ref makes the network call itself fire exactly once per
  // real mount.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // A hard refresh loses the in-memory access token, so the only way back
    // to "who is this" is trading the HTTP-only refresh cookie for a new one
    // — the same call Login/Register make right after authenticating. No
    // cookie, or the API being unreachable, just means signed out; the app
    // stays walkable per the pattern used elsewhere.
    refreshSession()
      .then((response) => setSession(response))
      .catch(() => {
        /* not signed in — nothing to restore */
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, setSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used inside <AuthProvider>.");
  return ctx;
}
