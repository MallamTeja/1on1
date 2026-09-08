/**
 * =============================================================================
 * backend/src/db/pool.js — PostgreSQL connection pool, SSL configuration, and transactions
 * =============================================================================
 *
 * WHY A CONNECTION POOL
 *   Establishing a TLS and TCP handshake to PostgreSQL takes 20-50ms per query.
 *   A pool maintains a set of warm, reusable database connections.
 *   Transactions borrow a single client from the pool for the duration of a unit
 *   of work and return it immediately upon COMMIT or ROLLBACK.
 *
 * SIZING POLICY
 *   - Long-running containers (EC2/Lightsail/PM2): max 10 connections.
 *   - Serverless Lambda containers: max 1 connection to prevent exhausting max_connections.
 * =============================================================================
 */
import fs from 'node:fs';
import pg from 'pg';

const { Pool } = pg;

// Supported SSL postures matching libpq conventions.
const ALLOWED_SSL_MODES = ['disable', 'require', 'verify-full'];

/**
 * Resolve PostgreSQL SSL configuration object from environment settings.
 *
 * @param {string} [sslMode] PGSSLMODE setting (disable | require | verify-full).
 * @param {string} [sslRootCert] Path to CA root certificate or certificate string.
 * @returns {boolean|object} Configuration suitable for pg.Pool ssl parameter.
 */
export function resolveSsl(sslMode, sslRootCert) {
  // If undefined or empty, default to disabled (local dev without TLS).
  if (!sslMode || sslMode === 'disable') {
    return false;
  }

  // Encrypted transport without verifying server certificate chain (e.g. self-signed).
  if (sslMode === 'require') {
    return { rejectUnauthorized: false };
  }

  // Encrypted transport strictly verifying the server against a trusted CA bundle.
  if (sslMode === 'verify-full') {
    if (!sslRootCert) {
      throw new Error('PGSSLMODE=verify-full requires PGSSLROOTCERT to point to a valid CA bundle file.');
    }

    // Read CA file if path exists on disk, otherwise treat string as raw PEM content.
    let caContent = sslRootCert;
    if (fs.existsSync(sslRootCert)) {
      caContent = fs.readFileSync(sslRootCert, 'utf8');
    }

    return {
      ca: caContent,
      rejectUnauthorized: true,
    };
  }

  // Unknown mode: reject with explicit list of valid options.
  throw new Error(
    `Invalid PGSSLMODE "${sslMode}". Expected one of: ${ALLOWED_SSL_MODES.join(', ')}.`
  );
}

// Global pool singleton instance.
let poolInstance = null;

/**
 * Get or initialize the singleton pg.Pool instance.
 *
 * @returns {pg.Pool} The active PostgreSQL pool.
 */
export function getPool() {
  if (poolInstance) {
    return poolInstance;
  }

  const connectionString = process.env.DATABASE_URL || '';
  if (!connectionString.trim()) {
    throw new Error('DATABASE_URL is not set. Cannot initialize PostgreSQL connection pool.');
  }

  // Auto-detect serverless environment to prevent pool connection explosion.
  const isLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  const maxConnections = isLambda ? 1 : 10;

  const sslConfig = resolveSsl(process.env.PGSSLMODE, process.env.PGSSLROOTCERT);

  poolInstance = new Pool({
    connectionString,
    ssl: sslConfig,
    max: maxConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Log unexpected errors on idle pool clients without crashing the process.
  poolInstance.on('error', (err) => {
    console.error('[db:pool] Unexpected error on idle database client:', err);
  });

  return poolInstance;
}

/**
 * Execute a parameterized query using a client borrowed from the pool.
 *
 * @param {string} text SQL query string.
 * @param {Array} [params] Parameters array for prepared statement.
 * @returns {Promise<pg.QueryResult>} Result object containing rows and rowCount.
 */
export async function query(text, params) {
  const connectionString = process.env.DATABASE_URL || '';
  if (!connectionString.trim()) {
    throw new Error('Cannot execute query: DATABASE_URL is not configured.');
  }

  const pool = getPool();
  return pool.query(text, params);
}

/**
 * Execute an asynchronous callback within an atomic database transaction.
 * Automatically handles BEGIN, COMMIT, and ROLLBACK on error.
 *
 * @template T
 * @param {function(pg.PoolClient): Promise<T>} callback Transaction worker receiving client.
 * @returns {Promise<T>} Resolves with the return value of callback.
 */
export async function withTransaction(callback) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[db:pool] Error during transaction rollback:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gracefully close the database pool and terminate all active connections.
 * Idempotent.
 *
 * @returns {Promise<void>}
 */
export async function closePool() {
  if (poolInstance) {
    const active = poolInstance;
    poolInstance = null;
    await active.end();
  }
}
