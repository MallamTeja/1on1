/**
 * Wire shapes, mirrored from the Node/Express API so the client and server
 * agree. This is the *auth subset* only — the shapes the login/register/refresh
 * flow needs. More DTOs get added here as features land; nothing goes in before
 * something imports it, so this file can't rot ahead of the backend.
 *
 *   AuthResponse   the login/register/refresh body. `user` is the one place the
 *                  client learns who is actually signed in, so it must be read
 *                  from here rather than assumed or cached from an earlier
 *                  session.
 *   UserResponse   the signed-in account itself.
 *
 * `T | null` versus `field?: T` is a real distinction: `T | null` means the
 * server declares the field and may send null (the key is always present),
 * `field?: T` means it may not arrive at all. Test with loose `!= null` rather
 * than `!== null` — that is the check that holds whichever shape shows up.
 */

export type AuthProvider = "LOCAL" | "GOOGLE";
export type VerificationStatus =
  | "UNVERIFIED"
  | "PENDING"
  | "VERIFIED"
  | "REJECTED";

/** The signed-in account itself — narrower than a public profile. */
export type UserResponse = {
  id: string;
  username: string;
  email: string;
  fullName: string;
  authProvider: AuthProvider;
  verificationStatus: VerificationStatus;
};

/** Login/register/refresh response body. The refresh token never appears here. */
export type AuthResponse = {
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
  user: UserResponse;
};
