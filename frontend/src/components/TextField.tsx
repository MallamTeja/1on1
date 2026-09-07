import type { ReactNode } from "react";

/**
 * One field, one job: label, input, and either its hint or its error. Both auth
 * forms use it so a validation message looks the same wherever it appears.
 */
export function TextField({
  id,
  label,
  type = "text",
  value,
  onChange,
  onBlur,
  error,
  hint,
  placeholder,
  autoComplete,
  maxLength,
  trailing,
  inputRef,
}: {
  id: string;
  label: string;
  type?: "text" | "email" | "password";
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  autoComplete?: string;
  maxLength?: number;
  /** Sits on the label row, right-aligned — e.g. a "Forgot it?" link. */
  trailing?: ReactNode;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const showHint = hint && !error;

  return (
    <div className="ui-field">
      <div className="ui-field__top">
        <label className="ui-field__label" htmlFor={id}>
          {label}
        </label>
        {trailing}
      </div>

      <input
        className={`ui-field__input${error ? " ui-field__input--invalid" : ""}`}
        id={id}
        name={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : showHint ? hintId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        ref={inputRef}
      />

      {error ? (
        <span className="ui-field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : showHint ? (
        <span className="ui-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
