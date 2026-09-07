import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthShell } from "../components/AuthShell";
import { TextField } from "../components/TextField";
import { useAuth } from "../lib/auth";
import {
  ApiError,
  NetworkError,
  refreshSession,
  registerAccount,
} from "../lib/api";
import {
  LIMITS,
  anyInvalid,
  validateEmail,
  validateFullName,
  validateNewPassword,
  type FieldError,
} from "../lib/validate";

const steps = [
  {
    verb: "Follow",
    body: "No connection request, no mutual approval. Follow anyone whose work you want to see.",
  },
  {
    verb: "Engage",
    body: "Posts, code snippets and polls from the people you follow — comment before you ask.",
  },
  {
    verb: "Request a session",
    body: "Pick a published slot, free or paid, one to one or in a group.",
  },
  {
    verb: "Meet",
    body: "The room opens in the browser, and the recap is written for you afterwards.",
  },
];

type Fields = { fullName: string; email: string; password: string };
type Errors = Partial<Record<keyof Fields, FieldError>>;

function check(values: Fields): Errors {
  return {
    fullName: validateFullName(values.fullName),
    email: validateEmail(values.email),
    password: validateNewPassword(values.password),
  };
}

export default function Register() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [values, setValues] = useState<Fields>({
    fullName: "",
    email: "",
    password: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof Fields, boolean>>>(
    {},
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function focusFirstInvalid(found: Errors) {
    if (found.fullName) nameRef.current?.focus();
    else if (found.email) emailRef.current?.focus();
    else if (found.password) passwordRef.current?.focus();
  }

  function edit(field: keyof Fields) {
    return (next: string) => {
      const updated = { ...values, [field]: next };
      setValues(updated);
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
    setTouched({ fullName: true, email: true, password: true });
    setFormError(null);

    if (anyInvalid(found)) {
      focusFirstInvalid(found);
      return;
    }

    setPending(true);
    try {
      // The password is hashed server-side; the account starts unverified
      // until the emailed link is opened.
      await registerAccount({
        fullName: values.fullName.trim(),
        email: values.email.trim(),
        password: values.password,
      });
      // refreshSession's response is the freshest read of who is signed in —
      // push it into auth state before navigating so the next screen never has
      // a moment to render with no user, or an earlier one, in place.
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
      if (problem instanceof ApiError && problem.status === 409) {
        setErrors((prev) => ({
          ...prev,
          email: "An account already uses this email.",
        }));
        emailRef.current?.focus();
        return;
      }
      setFormError(
        problem instanceof ApiError
          ? problem.message
          : "Creating your profile failed. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Create your profile"
      title="Three fields, then you're in."
      sub="Name, email, password. Everything else — skills, experience, availability — you can add once you're looking at your own profile."
      panelFine="Becoming a provider is optional. You never have to publish availability to use 1on1."
      panel={
        <>
          <p className="ui-label au-panel__label">What you're joining</p>
          <h2 className="au-panel__title">
            An open professional network with sessions at the centre.
          </h2>
          <ol className="au-steps">
            {steps.map((s, i) => (
              <li key={s.verb}>
                <span className="au-steps__n">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="au-steps__verb">{s.verb}</span>
                <span className="au-steps__body">{s.body}</span>
              </li>
            ))}
          </ol>
        </>
      }
      footer={
        <>
          Already have an account? <Link to="/login">Log in</Link>
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
          id="reg-name"
          label="Full name"
          autoComplete="name"
          placeholder="Tej Mallam"
          maxLength={LIMITS.fullNameMax}
          value={values.fullName}
          error={errors.fullName}
          onChange={edit("fullName")}
          onBlur={leave("fullName")}
          inputRef={nameRef}
        />

        <TextField
          id="reg-email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@work.com"
          maxLength={LIMITS.emailMax}
          hint="This is your identity on 1on1. You can add Google sign-in later."
          value={values.email}
          error={errors.email}
          onChange={edit("email")}
          onBlur={leave("email")}
          inputRef={emailRef}
        />

        <TextField
          id="reg-password"
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          maxLength={LIMITS.passwordMax}
          hint={`${LIMITS.passwordMin} characters or more.`}
          value={values.password}
          error={errors.password}
          onChange={edit("password")}
          onBlur={leave("password")}
          inputRef={passwordRef}
        />

        <button
          className="ui-btn ui-btn--block au-submit"
          type="submit"
          disabled={pending}
        >
          {pending ? "Creating your profile…" : "Create profile"}
        </button>
      </form>
    </AuthShell>
  );
}
