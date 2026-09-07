import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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

export default function Login() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [values, setValues] = useState<Fields>({ email: "", password: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof Fields, boolean>>>(
    {},
  );
  const [formError, setFormError] = useState<string | null>(null);
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
