/**
 * =============================================================================
 * !!  TEMPORARY IN-MEMORY STORE — MUST NOT REACH PRODUCTION  !!
 * =============================================================================
 *
 *   Every user and every session in this file lives in two plain JavaScript
 *   Maps on the heap. That means:
 *
 *     * ALL DATA IS LOST ON RESTART. nodemon restarts on every save, so you
 *       will be logged out and your test account will be gone several times a
 *       minute while developing. That is expected, not a bug.
 *     * IT DOES NOT WORK ON MORE THAN ONE INSTANCE. Two Node processes behind a
 *       load balancer would each have their own separate set of users.
 *     * IT IS NOT BOUNDED. Nothing is ever evicted, so it leaks memory forever.
 *
 *   Deploying this would mean an app where accounts silently vanish. There is a
 *   deliberate guard at the bottom of this file that throws if NODE_ENV is
 *   "production", so it cannot ship by accident.
 *
 * WHY IT EXISTS AT ALL — THE POINT OF THIS FILE
 *   The database is genuinely not chosen yet: docs/02-technology-stack.md has
 *   the AWS service (RDS / Aurora / DynamoDB / DocumentDB) as an open TODO, and
 *   that call is not this workstream's to make.
 *
 *   Rather than block auth on a pending infrastructure decision, every
 *   persistence call in the app goes through the function signatures below and
 *   through nothing else. No route, service or middleware constructs a query,
 *   knows a table name, or imports a driver. This is the REPOSITORY PATTERN,
 *   and its whole value is right here: when the DB is picked, you write one new
 *   file exporting these same functions, change the import in
 *   backend/src/server.js, and delete this one. Nothing else in the codebase
 *   changes.
 *
 *   The signatures are intentionally shaped to be implementable on BOTH a SQL
 *   database and a key-value store: every read is by a single indexed key
 *   (id, email, googleId, token hash), so nothing here assumes joins or
 *   transactions that DynamoDB could not provide.
 *
 * THE INTERFACE ANY REAL IMPLEMENTATION MUST PROVIDE
 *   findById(id)                     -> user | null
 *   findByEmail(email)               -> user | null    (email is pre-lowercased)
 *   findByGoogleId(googleId)         -> user | null
 *   createUser(input)                -> user
 *   linkGoogleAccount(id, googleId)  -> user
 *   saveRefreshToken(userId, hash, expiresAt)
 *   consumeRefreshToken(hash)        -> { userId } | null   (SINGLE USE)
 *   revokeRefreshTokensForUser(id)
 *
 *   Indexes the real schema will need: unique on email, unique on googleId
 *   (nullable), unique on username, and one on the refresh-token hash with a
 *   TTL/expiry sweep.
 * =============================================================================
 */
import crypto from 'crypto';

/** userId -> user record. */
const usersById = new Map();
/** lowercased email -> userId. A stand-in for a unique index on email. */
const userIdByEmail = new Map();
/** Google's stable subject id -> userId. Stand-in for a unique index on googleId. */
const userIdByGoogleId = new Map();
/** sha256(refresh token) -> { userId, expiresAt }. Never the raw token. */
const refreshTokensByHash = new Map();

/**
 * Records are cloned on the way out so a caller cannot reach into the store and
 * mutate it by accident — `user.email = 'x'` in a route would otherwise
 * silently corrupt the "database". A real driver gives you a detached row for
 * free; the in-memory version has to do it by hand, and skipping it would let
 * bugs hide here that would not reproduce once a real DB is wired in.
 */
function detach(user) {
  return user ? { ...user } : null;
}

export async function findById(id) {
  return detach(usersById.get(id));
}

export async function findByEmail(email) {
  const id = userIdByEmail.get(email);
  return id ? detach(usersById.get(id)) : null;
}

export async function findByGoogleId(googleId) {
  const id = userIdByGoogleId.get(googleId);
  return id ? detach(usersById.get(id)) : null;
}

/**
 * The frontend's UserResponse type requires a `username`, but the registration
 * form only collects fullName / email / password — so one has to be derived.
 * Local part of the email, stripped to a safe character set, with a numeric
 * suffix on collision.
 *
 * The loop is a placeholder for a real uniqueness strategy: against a real DB
 * this must be an INSERT against a unique index with a retry on violation, not
 * a check-then-write, because between the check and the write another request
 * can take the name. That race cannot happen here (single-threaded, no await
 * inside the loop) which is exactly why it is worth flagging now.
 */
function deriveUsername(email) {
  const base = email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 30) || 'user';
  let candidate = base;
  let suffix = 1;
  while ([...usersById.values()].some((user) => user.username === candidate)) {
    candidate = `${base}${suffix++}`;
  }
  return candidate;
}

/**
 * @param {object} input
 * @param {string}      input.email        already lowercased by the caller
 * @param {string}      input.fullName
 * @param {string|null} input.passwordHash null for a Google-only account
 * @param {string|null} input.googleId
 * @param {'LOCAL'|'GOOGLE'}  input.authProvider
 * @param {'UNVERIFIED'|'PENDING'|'VERIFIED'|'REJECTED'} input.verificationStatus
 */
export async function createUser(input) {
  const user = {
    id: crypto.randomUUID(),
    email: input.email,
    username: deriveUsername(input.email),
    fullName: input.fullName,
    /**
     * NULLABLE ON PURPOSE. A user who only ever signed in with Google has no
     * password, and that must be representable — the alternative (inventing a
     * random password) creates an account nobody can ever recover by email.
     * Every read of this field has to handle null; see routes/auth.js login.
     */
    passwordHash: input.passwordHash ?? null,
    googleId: input.googleId ?? null,
    /**
     * Which credential CREATED the account. It stays put when a second method
     * is linked later, because it is provenance, not a list of what works — a
     * LOCAL account that links Google can then sign in either way. The frontend
     * type (AuthProvider in frontend/src/lib/types.ts) only allows one value,
     * which is why `googleId` above is the real "can they use Google?" test.
     */
    authProvider: input.authProvider,
    verificationStatus: input.verificationStatus ?? 'UNVERIFIED',
    createdAt: new Date().toISOString(),
  };

  usersById.set(user.id, user);
  userIdByEmail.set(user.email, user.id);
  if (user.googleId) userIdByGoogleId.set(user.googleId, user.id);

  return detach(user);
}

/** Attach a Google identity to an account that already exists. */
export async function linkGoogleAccount(userId, googleId, patch = {}) {
  const user = usersById.get(userId);
  if (!user) return null;

  user.googleId = googleId;
  // Google having verified the address is the only email verification this app
  // currently has, so a link is allowed to upgrade the status — but never to
  // downgrade one that is already VERIFIED.
  if (patch.verificationStatus === 'VERIFIED') user.verificationStatus = 'VERIFIED';
  userIdByGoogleId.set(googleId, userId);

  return detach(user);
}

export async function saveRefreshToken(userId, tokenHash, expiresAt) {
  refreshTokensByHash.set(tokenHash, { userId, expiresAt });
}

/**
 * Look up a refresh token AND invalidate it in the same step — the token is
 * single-use, so reading it must consume it.
 *
 * The delete happens before the expiry check on purpose: an expired token is
 * dead either way, and leaving it in the map would just accumulate garbage.
 *
 * A real implementation must make this ATOMIC (a conditional delete, or
 * `DELETE ... RETURNING` in SQL). If two requests can both read the same token
 * before either deletes it, "single use" is not enforced and a stolen refresh
 * cookie can be replayed alongside the legitimate one — which is the exact
 * attack rotation is meant to stop.
 */
export async function consumeRefreshToken(tokenHash) {
  const record = refreshTokensByHash.get(tokenHash);
  if (!record) return null;

  refreshTokensByHash.delete(tokenHash);
  if (new Date(record.expiresAt).getTime() < Date.now()) return null;

  return { userId: record.userId };
}

/** Sign out everywhere: drop every outstanding session for this user. */
export async function revokeRefreshTokensForUser(userId) {
  for (const [hash, record] of refreshTokensByHash) {
    if (record.userId === userId) refreshTokensByHash.delete(hash);
  }
}

/**
 * The guard promised in the header. Importing this module in production is a
 * configuration mistake serious enough to refuse to boot over — a silent
 * fallback to a store that forgets every account is far worse than a crash on
 * startup that names the problem.
 */
if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'userRepository: the in-memory store cannot run in production. ' +
      'Implement a real repository against the chosen AWS database and import that instead.'
  );
}
