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
 * WHAT CHANGED, AND WHY IT IS NOT SIMPLY "PER ACCOUNT" ANY MORE. Counting
 * purely per account is the right brute-force answer and the wrong shop
 * answer: the owner's email is printed on every invoice, so anyone on the shop
 * wifi could hold that account at the fifteen-minute ceiling indefinitely with
 * one request per quarter hour — a till outage bought for four requests an
 * hour, with no credential and no admin unlock. So a REMOTE caller is counted
 * per (account, source) and the HOST-LOCAL console is counted per account.
 *
 * The asymmetry is deliberate and safe in both directions:
 *   - the person standing at the machine can always still get in, because a
 *     remote attacker's failures never land on the host-local counter;
 *   - a remote attacker gains nothing, because rotating source addresses to
 *     dodge the lockout means rotating away from the one they can reach the
 *     shop from, and the per-account HOST counter still catches anyone with
 *     physical access, who has the SQLite file anyway.
 *
 * `POST /users/:id/unlock` clears a key. The map is bounded: it is keyed by a
 * string the caller supplies, records are created BEFORE any account lookup so
 * nonexistent emails accumulate, and `read()` only ever evicted the one key it
 * was asked about — an unauthenticated caller could grow it without limit.
 */

/** Consecutive failures tolerated before the account starts locking. */
const FREE_ATTEMPTS = 5;
/** First lock, doubling with each further failure. */
const BASE_LOCK_MS = 60_000;
/** Ceiling, so a locked-out shop is never locked out for a whole shift. */
const MAX_LOCK_MS = 15 * 60_000;
/** A quiet period this long forgets the streak — yesterday's typos are not an attack. */
const DECAY_MS = 60 * 60_000;
/**
 * How many attempt records are kept.
 *
 * The key is caller-supplied and a record is written before any account
 * lookup, so this is an unauthenticated write into a process-lifetime map.
 * Ten thousand is far more than a real shop's account list and small enough
 * that a flood cannot exhaust memory; the least-recently-failed entries go
 * first, which is also the order in which they were about to decay anyway.
 */
const MAX_RECORDS = 10_000;

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
  /** Clears the streak after a verified credential — and what an admin unlock calls. */
  succeed(key: string): void;
  /** How many records are held. For the exception report and for tests. */
  size(): number;
}

function lockDuration(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  const doublings = failures - FREE_ATTEMPTS - 1;
  return Math.min(BASE_LOCK_MS * 2 ** doublings, MAX_LOCK_MS);
}

/**
 * The key a failed attempt is counted against.
 *
 * `source` is the REMOTE ADDRESS the request arrived from, and it is null for
 * the host's own in-process mount — which is what makes the console at the
 * counter immune to a lockout somebody else triggered over the wifi. It is
 * never read from a header: see `requestOrigin` in ./request-origin.ts.
 */
export function throttleKey(account: string, source: string | null): string {
  const needle = account.trim().toLowerCase();
  return source ? `${needle}@${source}` : needle;
}

export function createLoginThrottle(now: () => number = Date.now): LoginThrottle {
  const records = new Map<string, AttemptRecord>();

  /** Drops decayed records, then the oldest, until the map is within its cap. */
  function evict(at: number) {
    for (const [key, record] of records) {
      if (at - record.lastFailureAt > DECAY_MS) records.delete(key);
    }
    if (records.size <= MAX_RECORDS) return;
    const oldestFirst = [...records.entries()].sort((a, b) => a[1].lastFailureAt - b[1].lastFailureAt);
    for (const [key] of oldestFirst.slice(0, records.size - MAX_RECORDS)) records.delete(key);
  }

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
      if (!record) return 0;
      if (record.lockedUntil > at) return Math.ceil((record.lockedUntil - at) / 1000);
      if (record.lockedUntil !== 0) {
        // A SERVED LOCK STEPS THE LADDER DOWN ONE RUNG — it does not reset it.
        //
        // Leaving the streak at its high-water mark meant that after waiting
        // fifteen minutes, one more typo bought another THIRTY: the ratchet
        // only ever went up, so a person who had just been let back in was one
        // slip from a longer lock than the one they had served.
        //
        // Resetting it to zero instead — which is the obvious fix, and the one
        // this file first shipped — is worse, and the existing suite said so.
        // Five free attempts per served lock is 7,200 guesses a day, which
        // walks a six-digit keyspace in about four months; the whole point of
        // the ratchet is that a sweep costs decades, not that a guess costs a
        // minute. Stepping down one rung keeps the ceiling exactly where it
        // was (one guess per fifteen minutes at the top, ~28 years for a full
        // sweep) while making a single post-lock typo cost the same wait
        // again rather than double it.
        //
        // For the person who is simply locked out and needs to work now, the
        // answer is `POST /users/:id/unlock`, not a weaker ladder.
        record.failures = Math.max(0, record.failures - 1);
        record.lockedUntil = 0;
      }
      return 0;
    },
    fail(key) {
      const at = now();
      const record = read(key, at) ?? { failures: 0, lastFailureAt: at, lockedUntil: 0 };
      record.failures += 1;
      record.lastFailureAt = at;
      const lock = lockDuration(record.failures);
      record.lockedUntil = lock > 0 ? at + lock : 0;
      records.set(key, record);
      evict(at);
      return Math.ceil(lock / 1000);
    },
    succeed(key) {
      records.delete(key);
      // An unlock clears the account everywhere it was counted, not only on the
      // one source that happened to lock it: an admin pressing «فكّ القفل» means
      // "this person can sign in now", and leaving four other keys locked would
      // make the button a lie.
      const prefix = `${key}@`;
      for (const held of [...records.keys()]) {
        if (held.startsWith(prefix)) records.delete(held);
      }
    },
    size() {
      return records.size;
    },
  };
}
