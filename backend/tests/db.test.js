/**
 * backend/tests/db.test.js — unit tests for the Postgres foundation in src/db/.
 *
 * WHY MOST OF THESE NEED NO DATABASE
 *   uuidv7(), translatePgError() and resolveSsl() are pure functions. Running
 *   them against a live server would couple the cheapest tests in the suite to
 *   the most expensive dependency, and would hide the fact that each can be
 *   reasoned about alone. Only the pool tests touch Postgres, and they self-skip
 *   through describeIfPostgres() so `pnpm test` stays green on a fresh clone.
 *
 * WHY THE src/db IMPORTS ARE DYNAMIC
 *   src/config/env.js reads process.env ONCE at import and freezes the result,
 *   and pool.js imports env.js. A static `import` is hoisted above every
 *   statement in this file, so there would be no moment to point DATABASE_URL
 *   at the TEST database before env.js captured whatever the shell had. A
 *   dynamic import inside before() runs after the assignment below.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
// Only used to fabricate a CA-bundle file for the verify-full posture test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// The real class, because `instanceof HttpError` is what errorHandler.js branches on.
import { HttpError } from '../src/lib/httpError.js';
import { describeIfPostgres, TEST_DATABASE_URL } from './helpers/testDatabase.js';

// The pool must see the TEST database, never the dev one. '' (not undefined) when
// unset, so a repo-root .env cannot fill it back in — dotenv never overwrites a present key.
process.env.DATABASE_URL = TEST_DATABASE_URL;
// env.js warns to stderr when this is missing; in a unit-test process that warning is noise, not signal.
process.env.JWT_ACCESS_SECRET ||= 'test-only-secret-for-db-tests';

/* ========================================================================== */
/* uuidv7                                                                     */
/* ========================================================================== */
describe('uuidv7 — application-generated, time-ordered primary keys', () => {
  let uuidv7, timestampOf, selfCheck;
  // Dynamic on purpose — see the file header.
  before(async () => {
    ({ uuidv7, timestampOf, selfCheck } = await import('../src/db/uuidv7.js'));
  });

  // Version nibble 7 in the third group, variant bits 10xx (8/9/a/b) leading the fourth — RFC 9562 §5.7.
  const CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  test('mints a canonical lowercase UUID with version 7 and the RFC variant', () => {
    assert.match(uuidv7(), CANONICAL);
  });

  test('the first 48 bits are the Unix millisecond timestamp', () => {
    // A fixed clock makes the round-trip deterministic instead of "roughly now".
    const at = 1_757_300_000_000;
    assert.equal(timestampOf(uuidv7(at)), at);
  });

  test('ids minted within one millisecond still sort in mint order', () => {
    // Same `at` on every call is the worst case for a time-ordered id: the timestamp cannot break ties.
    const at = Date.now();
    let previous = uuidv7(at);
    for (let i = 0; i < 1000; i += 1) {
      const next = uuidv7(at);
      // Lexical string comparison IS numeric comparison here: fixed-width hex, big-endian.
      assert.ok(next > previous, `id ${i} did not sort after its predecessor`);
      previous = next;
    }
  });

  test('a clock that steps backwards cannot produce an earlier-sorting id', () => {
    // NTP corrections and VM migrations do move the wall clock back; a PK generator must not follow it.
    const first = uuidv7(Date.now());
    const second = uuidv7(Date.now() - 5_000);
    assert.ok(second > first);
  });

  test('selfCheck passes for the real generator', () => {
    assert.doesNotThrow(() => selfCheck(1000));
  });

  test('selfCheck catches a generator that stops increasing', () => {
    // A checker that cannot fail proves nothing — feed it a constant and demand a throw.
    assert.throws(() => selfCheck(3, () => '00000000-0000-7000-8000-000000000000'), /strictly increasing/);
  });
});

/* ========================================================================== */
/* translatePgError                                                           */
/* ========================================================================== */
describe('translatePgError — SQLSTATE to HttpError, without leaking the driver', () => {
  let translatePgError;
  before(async () => {
    ({ translatePgError } = await import('../src/db/pgErrors.js'));
  });

  // Shaped like a real `pg` DatabaseError: `.code` is the SQLSTATE, `.detail` carries the offending VALUE.
  const pgError = (code, extra = {}) =>
    Object.assign(new Error('duplicate key value violates unique constraint'), {
      code,
      detail: 'Key (lower(email))=(x@y.z) already exists.',
      ...extra,
    });

  test('ignores errors that did not come from Postgres', () => {
    // A plain Error has no `.code`; null/undefined must not crash the translator either.
    assert.equal(translatePgError(new Error('boom')), null);
    assert.equal(translatePgError(null), null);
    assert.equal(translatePgError(undefined), null);
  });

  test('duplicate email → 409 with the message Register.tsx already branches on', () => {
    const out = translatePgError(pgError('23505', { constraint: 'uq_app_user_email_lower' }));
    // instanceof, not duck-typing: errorHandler.js checks `err instanceof HttpError && err.expose`.
    assert.ok(out instanceof HttpError);
    assert.equal(out.status, 409);
    // Byte-for-byte the string routes/auth.js throws today, so the frontend sees no change.
    assert.equal(out.message, 'An account already uses this email.');
    assert.equal(out.expose, true);
  });

  test('duplicate username → null so the repository can retry with a new suffix', () => {
    assert.equal(translatePgError(pgError('23505', { constraint: 'uq_app_user_username' })), null);
  });

  test('any other unique violation → 409 that never echoes the driver detail', () => {
    const out = translatePgError(pgError('23505', { constraint: 'uq_offering_title' }));
    assert.equal(out.status, 409);
    // `.detail` contains the user's actual value; it must not reach the browser.
    assert.doesNotMatch(out.message, /Key \(|already exists|x@y\.z/);
  });

  test('exclusion violation (an overlapping booking) → 409', () => {
    assert.equal(translatePgError(pgError('23P01', { constraint: 'ex_booking_provider_no_overlap' })).status, 409);
  });

  test('check violation → 400', () => {
    assert.equal(translatePgError(pgError('23514', { constraint: 'ck_offering_duration' })).status, 400);
  });

  test('string too long for its column → 400', () => {
    assert.equal(translatePgError(pgError('22001')).status, 400);
  });

  test('an unmapped SQLSTATE → null so it surfaces as a real 500, not a guessed status', () => {
    // 42P01 = undefined_table: a deployment bug, and a 4xx would blame the client for it.
    assert.equal(translatePgError(pgError('42P01')), null);
  });

  test('keeps the original error as `cause` for server-side diagnosis', () => {
    const err = pgError('23514');
    // The client gets the safe sentence; whoever reads the logs still gets the SQLSTATE and constraint.
    assert.equal(translatePgError(err).cause, err);
  });
});

/* ========================================================================== */
/* resolveSsl                                                                 */
/* ========================================================================== */
describe('resolveSsl — TLS posture from PGSSLMODE', () => {
  let resolveSsl;
  before(async () => {
    ({ resolveSsl } = await import('../src/db/pool.js'));
  });

  test('unset → no TLS, because the local server runs with ssl = off', () => {
    assert.equal(resolveSsl(undefined, null), false);
  });

  test('disable → no TLS', () => {
    assert.equal(resolveSsl('disable', null), false);
  });

  test('require → encrypted but NOT authenticated', () => {
    // rejectUnauthorized:false is exactly what libpq's sslmode=require means: encrypt, trust any cert.
    assert.deepEqual(resolveSsl('require', null), { rejectUnauthorized: false });
  });

  test('verify-full → pins the CA bundle and demands verification', () => {
    // A fake bundle in a temp dir: the test is about the wiring, not about parsing PEM.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '1on1-ca-'));
    const caPath = path.join(dir, 'rds-ca.pem');
    fs.writeFileSync(caPath, 'FAKE-CA-BUNDLE');
    try {
      assert.deepEqual(resolveSsl('verify-full', caPath), { ca: 'FAKE-CA-BUNDLE', rejectUnauthorized: true });
    } finally {
      // Clean up even on assertion failure so repeated runs do not litter the temp dir.
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('verify-full without a CA path refuses to guess', () => {
    // Silently downgrading to "encrypted, unverified" would defeat the whole point of asking for verify-full.
    assert.throws(() => resolveSsl('verify-full', null), /PGSSLROOTCERT/);
  });

  test('an unknown mode is rejected at boot, naming the accepted values', () => {
    // libpq also has prefer/allow/verify-ca; supporting a subset is fine, accepting a typo is not.
    assert.throws(() => resolveSsl('prefer', null), /disable.*require.*verify-full/);
  });
});

/* ========================================================================== */
/* pool — no database configured                                              */
/* ========================================================================== */
describe('pool — without a database configured', () => {
  let query;
  before(async () => {
    ({ query } = await import('../src/db/pool.js'));
  });

  test(
    'query fails fast naming DATABASE_URL instead of dialling a default host',
    // Only meaningful when the pool has NO url; with TEST_DATABASE_URL set this scenario does not exist.
    { skip: Boolean(TEST_DATABASE_URL) && 'TEST_DATABASE_URL is set, so the pool has a URL' },
    async () => {
      // Without this guard `pg` would try localhost:5432 as the OS user and hang for the connection timeout.
      await assert.rejects(() => query('select 1'), /DATABASE_URL/);
    }
  );
});

/* ========================================================================== */
/* pool — against a real TEST_DATABASE_URL (self-skipping)                    */
/* ========================================================================== */
describeIfPostgres('pool — against TEST_DATABASE_URL', () => {
  let db;
  before(async () => {
    db = await import('../src/db/pool.js');
  });
  // Without this the idle pool keeps the test process alive until idleTimeoutMillis fires.
  after(async () => {
    await db?.closePool();
  });

  test('query returns rows and rowCount', async () => {
    // A parameter, not a literal, so the placeholder path is exercised too.
    const result = await db.query('select $1::int as ok', [1]);
    assert.deepEqual(result.rows, [{ ok: 1 }]);
    assert.equal(result.rowCount, 1);
  });

  test('withTransaction returns the callback result after COMMIT', async () => {
    const out = await db.withTransaction(async (client) => (await client.query('select 2 as two')).rows[0].two);
    assert.equal(out, 2);
  });

  test('withTransaction rolls back and rethrows, and the pool is still usable afterwards', async () => {
    // The throw must propagate unchanged — callers branch on their own error types.
    await assert.rejects(
      () =>
        db.withTransaction(async (client) => {
          await client.query('select 1');
          throw new Error('boom');
        }),
      /boom/
    );
    // A client left mid-transaction would make this next query fail with 25P02; success proves the release path.
    const result = await db.query('select 3 as three');
    assert.equal(result.rows[0].three, 3);
  });

  test('closePool is idempotent', async () => {
    // Graceful shutdown and the after() hook above may both call it; the second call must be a no-op.
    await db.closePool();
    await db.closePool();
  });
});
