/**
 * Client-side validation, mirroring the Node API's request validation so the
 * two never disagree about what is acceptable.
 *
 *   POST /api/auth/register
 *     email     required, email-shaped, max 255
 *     password  required, min 8, max 100
 *     fullName  required, max 120
 *
 *   POST /api/auth/login
 *     email     required, email-shaped
 *     password  required            <- deliberately no minimum
 *
 * The server stays the authority; this only spares the user a round trip.
 */
export const LIMITS = {
  emailMax: 255,
  passwordMin: 8,
  passwordMax: 100,
  fullNameMax: 120,
} as const;

/** Practical shape check: one @, no spaces, a dot in the domain. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldError = string | undefined;

export function validateEmail(raw: string): FieldError {
  const value = raw.trim();
  if (!value) return "Enter your email address.";
  if (!EMAIL_SHAPE.test(value)) return "This needs to look like name@company.com.";
  if (value.length > LIMITS.emailMax)
    return `Use ${LIMITS.emailMax} characters or fewer.`;
  return undefined;
}

/** For a password being chosen — the server's min/max applies. */
export function validateNewPassword(value: string): FieldError {
  if (!value) return "Choose a password.";
  if (value.length < LIMITS.passwordMin)
    return `Use at least ${LIMITS.passwordMin} characters.`;
  if (value.length > LIMITS.passwordMax)
    return `Use ${LIMITS.passwordMax} characters or fewer.`;
  return undefined;
}

/**
 * For a password being typed to log in. The server only requires it to be
 * non-blank here, so applying today's minimum would lock out an account whose
 * password predates it.
 */
export function validateExistingPassword(value: string): FieldError {
  if (!value) return "Enter your password.";
  return undefined;
}

export function validateFullName(raw: string): FieldError {
  const value = raw.trim();
  if (!value) return "Enter your name.";
  if (value.length > LIMITS.fullNameMax)
    return `Use ${LIMITS.fullNameMax} characters or fewer.`;
  return undefined;
}

export function anyInvalid(errors: Record<string, FieldError>): boolean {
  return Object.values(errors).some(Boolean);
}
