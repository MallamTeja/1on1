import { useRef, useState } from "react";
// useSearchParams is the router's own read of the query string. Reading
// window.location.search would work today, but it bypasses the router, so a
// future client-side navigation to /login?error=... could render stale state.
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell } from "../components/AuthShell";
import { SlotBlock } from "../components/SlotBlock";
import { TextField } from "../components/TextField";
import { useAuth } from "../lib/auth";
import {
  ApiError,
  NetworkError,
  loginWithPassword,
  refreshSession,
} from "../lib/api";
import {
  LIMITS,
  anyInvalid,
  validateEmail,
  validateExistingPassword,
  type FieldError,
} from "../lib/validate";

type Fields = { email: string; password: string };
type Errors = Partial<Record<keyof Fields, FieldError>>;

function check(values: Fields): Errors {
  return {
    email: validateEmail(values.email),
    password: validateExistingPassword(values.password),
  };
}

/**
 * Google sign-in cannot fail with a JSON body — the browser is mid-navigation,
 * so backend/src/routes/googleAuth.js sends it back to /login?error=<code>.
 * These are the only four codes it emits (failRedirect call sites in that
 * file); the messages are deliberately vaguer than the server log, because a
 * precise one would let someone probing with their own Google account learn
 * which of our users exist.
 */
// Keyed by plain string, not a union of the four codes: the key arrives from
// the URL, so anything can show up, and a union type would promise otherwise.
const OAUTH_REASONS: Record<string, string> = {
  // The person closed Google's consent screen themselves, so no error tone —
  // confirm what happened and name both ways forward.
  google_cancelled:
    "Google sign-in was cancelled. You can try again, or use your email and password.",
  // One message for four server-side branches: missing handshake cookies, a
  // state mismatch, a failed code exchange or id_token check, and an id_token
  // with no email. Collapsing them is deliberate — telling a prober which step
  // broke hands them a map of the handshake. The server log keeps the detail.
  google_failed:
    "Google didn't complete the sign-in. Starting again usually clears it.",
  // Points at Google, not us, because only Google can verify a Google address.
  // We refuse unverified emails so nobody can sign in as an address they merely
  // typed into a Google account.
  google_email_unverified:
    "Google hasn't verified that account's email address. Verify it with Google, or log in with your email and password.",
  // Server-side misconfiguration (the backend answers 503), nothing the person
  // did. The second sentence is the additive-auth contract made visible:
  // Google being down never blocks password login.
  google_unavailable:
    "Google sign-in isn't available on this server right now. Your email and password still work.",
};

// Returns null rather than "" so the caller can seed formError directly — the
// JSX already treats null as "no banner", and this keeps that contract intact.
function oauthReason(code: string | null): string | null {
  // No ?error= at all is the normal case: a plain visit to /login.
  if (!code) return null;
  // An unknown code means the backend grew a new failure before this map
  // learned it. A generic line beats silently dropping a real error.
  return OAUTH_REASONS[code] ?? "Google sign-in didn't work. Try again, or use your email and password.";
}

export default function Login() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [values, setValues] = useState<Fields>({ email: "", password: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof Fields, boolean>>>(
    {},
  );
  // Only the getter is destructured: this page reads the URL and never writes
  // it, so there is nothing to strip — see the initialiser note below.
  const [params] = useSearchParams();
  // Seeded once, on mount: a bounced Google handshake is the reason this page
  // is being shown, so it belongs in the same banner a failed password login
  // uses. handleSubmit's setFormError(null) clears it, which is right — a new
  // attempt supersedes the old failure.
  // The arrow makes this a lazy initialiser: React runs it on the first render
  // only, so ?error= cannot resurrect the banner after a submit has cleared
  // it, and no useEffect is needed to scrub the param from the URL.
  const [formError, setFormError] = useState<string | null>(() =>
    oauthReason(params.get("error")),
  );
  const [pending, setPending] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function edit(field: keyof Fields) {
    return (next: string) => {
      const updated = { ...values, [field]: next };
      setValues(updated);
      // Only correct someone while they type if they have already left the
      // field once — otherwise the first keystroke gets shouted at.
      if (touched[field]) {
        setErrors((prev) => ({ ...prev, [field]: check(updated)[field] }));
      }
    };
  }

  function leave(field: keyof Fields) {
    return () => {
      setTouched((prev) => ({ ...prev, [field]: true }));
      setErrors((prev) => ({ ...prev, [field]: check(values)[field] }));
    };
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const found = check(values);
    setErrors(found);
    setTouched({ email: true, password: true });
    setFormError(null);

    if (anyInvalid(found)) {
      (found.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setPending(true);
    try {
      await loginWithPassword(values.email.trim(), values.password);
      // The login response sets the HTTP-only refresh cookie. Trade it for an
      // access token through the same call session restore uses, so there is
      // exactly one way a session starts — and its `user` is what goes into
      // auth state, not anything cached from before this sign-in.
      setSession(await refreshSession());
      // TODO: point at /dashboard once that route exists.
      navigate("/");
    } catch (problem) {
      if (problem instanceof NetworkError) {
        // No API is deployed alongside this build yet; keep the UI walkable.
        // TODO: point at /dashboard once that route exists.
        navigate("/");
        return;
      }
      setFormError(
        problem instanceof ApiError && problem.status === 401
          ? "That email and password don't match."
          : problem instanceof ApiError
            ? problem.message
            : "Logging in failed. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Log in"
      title="Welcome back."
      sub="Pick up where you left off — your feed, your requests, and whatever you have booked this week."
      panelFine="Email and password only. 1on1 never asks for a phone number."
      panel={
        <>
          <p className="ui-label au-panel__label">Waiting for you</p>
          <h2 className="au-panel__title">
            One session confirmed, one still to answer.
          </h2>
          <div className="au-panel__slots">
            <SlotBlock
              variant="dark"
              time="19:00"
              duration="60 min"
              title="React Architecture Review"
              meta="With Ananya Rao · today"
            />
            <SlotBlock
              variant="dark"
              time="11:30"
              duration="30 min"
              title="Career Discussion"
              meta="Rahul Menon requested Saturday"
            />
          </div>
          <p className="au-panel__lede">
            Sessions live on the server, so the state you see is the state
            everyone sees.
          </p>
        </>
      }
      footer={
        <>
          First time here? <Link to="/register">Create your profile</Link>
        </>
      }
    >
      <form className="au-form" onSubmit={handleSubmit} noValidate>
        {formError ? (
          <p className="au-error" role="alert">
            {formError}
          </p>
        ) : null}

        <TextField
          id="login-email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@work.com"
          maxLength={LIMITS.emailMax}
          value={values.email}
          error={errors.email}
          onChange={edit("email")}
          onBlur={leave("email")}
          inputRef={emailRef}
        />

        <TextField
          id="login-password"
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={values.password}
          error={errors.password}
          onChange={edit("password")}
          onBlur={leave("password")}
          inputRef={passwordRef}
          trailing={
            /* TODO: /forgot-password — posts the email, backend mails a
               single-use reset token. */
            <a className="au-forgot" href="#reset">
              Forgot it?
            </a>
          }
        />

        <button
          className="ui-btn ui-btn--block au-submit"
          type="submit"
          disabled={pending}
        >
          {pending ? "Logging in…" : "Log in"}
        </button>
      </form>
    </AuthShell>
  );
}
