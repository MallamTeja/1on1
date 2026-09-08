/**
 * backend/tests/helpers/testDatabase.js — opt-in Postgres for the test suite.
 *
 * WHY OPT-IN
 *   `pnpm test` must stay green on a fresh clone with nothing installed but
 *   Node, because that is the command a reviewer runs first and the one CI will
 *   run. A database is a heavy dependency: it has to be running, reachable,
 *   migrated and pointed at by a credential. So the Postgres-backed suites are
 *   gated on ONE variable, TEST_DATABASE_URL, and skip — visibly, in the test
 *   report — when it is absent. `pnpm test:pg` is the same command with that
 *   variable set by the caller.
 *
 * WHY A SEPARATE VARIABLE FROM DATABASE_URL
 *   Tests register users, mint sessions and revoke them. Pointing them at the
 *   development database would interleave test rows with a developer's own
 *   data, and a future cleanup step would then delete real work. Two names make
 *   the two databases impossible to confuse in a shell history.
 */
// node:test's describe is wrapped rather than re-exported, so the skip decision lives in one place.
import { describe } from 'node:test';
// A plain Client, not the app's pool: the pool reads DATABASE_URL, and this helper must never touch it.
import pg from 'pg';

/**
 * Empty string rather than undefined when unset. Callers spread this into a
 * child process env, and dotenv refuses to overwrite a key that is PRESENT —
 * even present-and-empty — so '' is what stops a repo-root .env from quietly
 * re-enabling Postgres for a run the caller meant to be in-memory.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';

/**
 * describe() when a test database is configured, describe.skip() otherwise.
 *
 * Skipping rather than silently omitting matters: `skipped 4` in the report
 * tells a reader that Postgres coverage exists and was not exercised, which is
 * a different fact from "there are no Postgres tests".
 */
export function describeIfPostgres(name, fn) {
  // The reason goes in the suite name because node:test's reporter prints the name, not the skip option, at a glance.
  if (!TEST_DATABASE_URL) return describe.skip(`${name} — skipped: TEST_DATABASE_URL is not set`, fn);
  // Normal path: exactly what describe() would have done, so gated suites read like ungated ones.
  return describe(name, fn);
}

/**
 * Throw an actionable error if the test database has never been migrated.
 *
 * WHY CHECK RATHER THAN LET THE FIRST QUERY FAIL
 *   An unmigrated database fails as `relation "app_user" does not exist` from
 *   somewhere deep inside a login test — a message that points at the wrong
 *   layer. Checking node-pg-migrate's ledger table up front turns that into one
 *   sentence naming the fix, at the moment the suite starts.
 */
export async function assertMigrated() {
  // A dedicated short-lived connection: the helper must work before, and independently of, the app's pool.
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL, ssl: false });
  // connect() is where a wrong password or a missing database surfaces, so it stays outside the try.
  await client.connect();
  try {
    // to_regclass() returns NULL for a missing relation instead of throwing 42P01, so no try/catch on the SQL.
    const { rows } = await client.query("SELECT to_regclass('public.pgmigrations') IS NOT NULL AS present");
    // `pgmigrations` is node-pg-migrate's default ledger; its absence means `up` has never run here.
    if (!rows[0].present) {
      throw new Error(
        'The test database has no `pgmigrations` table — migrations have never run against it. ' +
          'Fix: `pnpm --filter 1on1-backend migrate:test` (applies the migrations dir to TEST_DATABASE_URL).'
      );
    }
  } finally {
    // Always released, so a thrown assertion does not leave a connection open until the process exits.
    await client.end();
  }
}
