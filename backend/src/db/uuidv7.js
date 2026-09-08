/**
 * =============================================================================
 * backend/src/db/uuidv7.js — application-generated, time-ordered UUIDv7 primary keys
 * =============================================================================
 *
 * WHY UUIDv7
 *   Sequential IDs (bigserial) leak business volume and allow scraping.
 *   UUIDv4 is completely random, scattering index writes across pages and
 *   causing page splits, cache churn, and WAL inflation.
 *   UUIDv7 encodes a 48-bit millisecond timestamp in the most significant bits,
 *   so inserts append to the rightmost B-tree page while retaining UUID opacity.
 *
 * SPECIFICATION
 *   Conforms strictly to RFC 9562 §5.7:
 *     - unix_ts_ms (48 bits)
 *     - ver (4 bits = 0111)
 *     - rand_a (12 bits)
 *     - var (2 bits = 10)
 *     - rand_b (62 bits)
 * =============================================================================
 */
import crypto from 'node:crypto';

// Monotonic state to guarantee strictly increasing order even within the same ms.
let lastTimeMs = -1;
let sequenceCounter = 0;

/**
 * Generate an RFC 9562 compliant UUIDv7 string.
 *
 * @param {number} [customTimestampMs] Optional timestamp override (used in deterministic tests).
 * @returns {string} Lowercase canonical UUIDv7 string.
 */
export function uuidv7(customTimestampMs) {
  let timeMs = typeof customTimestampMs === 'number' ? customTimestampMs : Date.now();

  // Guard against backwards clock drift (e.g. NTP corrections up to 60s) by holding lastTimeMs.
  if (timeMs <= lastTimeMs && (lastTimeMs - timeMs) <= 60_000) {
    timeMs = lastTimeMs;
  }

  // Handle sequence counter within the same millisecond.
  if (timeMs === lastTimeMs) {
    sequenceCounter = (sequenceCounter + 1) & 0x0fff;
    if (sequenceCounter === 0) {
      timeMs += 1;
    }
  } else {
    sequenceCounter = 0;
  }

  lastTimeMs = timeMs;

  // Allocate 16 bytes for the raw binary UUID.
  const buffer = Buffer.alloc(16);

  // High 48 bits: write exact millisecond timestamp (Big-Endian).
  buffer.writeUIntBE(timeMs, 0, 6);

  // Generate 10 cryptographically random bytes for random fields.
  const randomBytes = crypto.randomBytes(10);

  // rand_a (12 bits): combine 12-bit sequence counter with random bits.
  const seqBits = sequenceCounter & 0x0fff;

  // Byte 6: 4-bit version (7) in high nibble, high 4 bits of seq in low nibble.
  buffer[6] = 0x70 | ((seqBits >>> 8) & 0x0f);
  // Byte 7: low 8 bits of sequence counter.
  buffer[7] = seqBits & 0xff;

  // Byte 8: RFC variant 10xx in top 2 bits, 6 random bits from crypto.
  buffer[8] = 0x80 | (randomBytes[0] & 0x3f);

  // Bytes 9-15: remaining bytes of cryptographic randomness.
  randomBytes.copy(buffer, 9, 1, 8);
  crypto.randomBytes(2).copy(buffer, 14, 0, 2);

  // Format into standard canonical string: 8-4-4-4-12.
  const hex = buffer.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Extract the 48-bit millisecond timestamp encoded in a UUIDv7.
 *
 * @param {string} uuid The UUID string to parse.
 * @returns {number} Unix timestamp in milliseconds.
 */
export function timestampOf(uuid) {
  // Strip hyphens to get raw 32-character hex representation.
  const cleanHex = uuid.replace(/-/g, '');
  // First 12 hex characters represent the 48-bit timestamp.
  const timeHex = cleanHex.slice(0, 12);
  // Convert hex to numeric integer.
  return parseInt(timeHex, 16);
}

/**
 * Verify generator monotonicity and correctness over N iterations.
 *
 * @param {number} [iterations=1000] Number of sequential IDs to generate and compare.
 * @param {Function} [generator=uuidv7] Optional generator function to test failure paths.
 */
export function selfCheck(iterations = 1000, generator = uuidv7) {
  let prev = generator();
  for (let i = 1; i < iterations; i += 1) {
    const next = generator();
    if (!(next > prev)) {
      throw new Error(`UUIDv7 selfCheck failed: id ${next} is not strictly increasing after ${prev}`);
    }
    prev = next;
  }
}
