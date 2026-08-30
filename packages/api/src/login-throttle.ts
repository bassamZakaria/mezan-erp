/**
 * Failed-login throttling.
 *
 * WHY THIS EXISTS. A Mezan credential is a SIX DIGIT PIN — a keyspace of one
 * million. Measured against the real login route with no throttle: 20 attempts
 * in 0.557s on a single connection (~36/s), and the correct PIN still worked
 * afterwards. One sequential attacker exhausts the whole space in under eight
 * hours; a handful of parallel connections does it over a lunch break, and the
 * LAN mount puts that attacker on the shop wifi. scrypt makes each guess cost
 * something; only a lockout makes the SEQUENCE cost something.
 *
 * Counted per account, not per connection: the attacker chooses their source
 * address and the desktop/in-process mount does not have one to count.
 */

/** Consecutive failures tolerated before the account starts locking. */
const FREE_ATTEMPTS = 5;
/** First lock, doubling with each further failure. */
const BASE_LOCK_MS = 60_000;
/** Ceiling, so a locked-out shop is never locked out for a whole shift. */
const MAX_LOCK_MS = 15 * 60_000;
/** A quiet period this long forgets the streak — yesterday's typos are not an attack. */
const DECAY_MS = 60 * 60_000;

interface AttemptRecord {
  failures: number;
  lastFailureAt: number;
  lockedUntil: number;
}

export interface LoginThrottle {
  /** Seconds the caller must wait, or 0 when the attempt may proceed. */
  retryAfter(key: string): number;
  /** Records a failure and returns the seconds the account is now locked for. */
  fail(key: string): number;
  /** Clears the streak after a verified credential. */
  succeed(key: string): void;
}

function lockDuration(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  const doublings = failures - FREE_ATTEMPTS - 1;
  return Math.min(BASE_LOCK_MS * 2 ** doublings, MAX_LOCK_MS);
}

export function createLoginThrottle(now: () => number = Date.now): LoginThrottle {
  const records = new Map<string, AttemptRecord>();

  function read(key: string, at: number): AttemptRecord | undefined {
    const record = records.get(key);
    if (!record) return undefined;
    if (at - record.lastFailureAt > DECAY_MS) {
      records.delete(key);
      return undefined;
    }
    return record;
  }

  return {
    retryAfter(key) {
      const at = now();
      const record = read(key, at);
      if (!record || record.lockedUntil <= at) return 0;
      return Math.ceil((record.lockedUntil - at) / 1000);
    },
    fail(key) {
      const at = now();
      const record = read(key, at) ?? { failures: 0, lastFailureAt: at, lockedUntil: 0 };
      record.failures += 1;
      record.lastFailureAt = at;
      const lock = lockDuration(record.failures);
      record.lockedUntil = lock > 0 ? at + lock : 0;
      records.set(key, record);
      return Math.ceil(lock / 1000);
    },
    succeed(key) {
      records.delete(key);
    },
  };
}
