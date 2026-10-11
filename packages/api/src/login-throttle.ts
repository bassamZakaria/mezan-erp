import { canonicalOrigin } from "./session-auth.js";

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
 * Rotating source addresses buys a fresh ladder each time, and this map is
 * bounded, so neither is what caps an account: that is the account lock in
 * ./sign-in-guard.ts, kept where nothing a caller sends can evict it.
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
/**
 * How long one failure counts. A SLIDING window, not a quiet period: a streak
 * that only a quiet hour could forget never forgot anything in a shop that is
 * open all day, so one typo every twenty-five minutes climbed to a lock.
 */
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
  /** When each failure still inside the window happened, oldest first. */
  failures: number[];
  lockedUntil: number;
}

export interface LoginThrottle {
  /** Seconds the caller must wait, or 0 when the attempt may proceed. */
  retryAfter(key: string): number;
  /** Records a failure and returns the seconds the account is now locked for. */
  fail(key: string): number;
  /** Clears the streak of the one key a credential was just verified on. */
  succeed(key: string): void;
  /** Clears an account everywhere it was counted — what an admin unlock calls. */
  unlock(account: string): void;
  /** How many records are held. For the exception report and for tests. */
  size(): number;
}

export enum SignInRefusal {
  TooManyAttempts = "TOO_MANY_ATTEMPTS",
  AccountLocked = "ACCOUNT_LOCKED",
  InvalidUnlockCode = "INVALID_UNLOCK_CODE",
}

/** `unlockByCode` says whether a one-time code was mailed to the administrators, so the client offers a place to type it. */
export function accountLocked(unlockByCode: boolean) {
  return {
    error: SignInRefusal.AccountLocked,
    unlockByCode,
    message: unlockByCode
      ? "تم قفل هذا الحساب بعد محاولات دخول فاشلة متكررة. أُرسل رمز فكّ القفل إلى بريد مديري النظام: أدخله هنا، أو اطلب من مدير النظام فكّ القفل من شاشة المستخدمين."
      : "تم قفل هذا الحساب بعد محاولات دخول فاشلة متكررة. اطلب من مدير النظام فكّ القفل من شاشة المستخدمين، أو سجّل الدخول من جهاز الخادم نفسه.",
  };
}

/**
 * "900 ثانية" is not a wait a person can act on. Past two minutes the honest
 * unit is minutes; the exact second count still travels as `retryAfterSeconds`
 * so the client can run a countdown against it.
 */
export function waitPhrase(seconds: number): string {
  if (seconds < 120) return `${seconds} ثانية`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes === 2) return "دقيقتين";
  if (minutes <= 10) return `${minutes} دقائق`;
  return `${minutes} دقيقة`;
}

export function tooManyAttempts(seconds: number) {
  return {
    error: SignInRefusal.TooManyAttempts,
    retryAfterSeconds: seconds,
    message: `محاولات دخول كثيرة. حاول بعد ${waitPhrase(seconds)}.`,
  };
}

const lastFailureAt = (record: AttemptRecord): number => record.failures.at(-1) ?? 0;

function dropOutsideWindow(record: AttemptRecord, at: number): void {
  while (record.failures.length > 0 && at - record.failures[0]! > DECAY_MS) record.failures.shift();
}

function readRecord(records: Map<string, AttemptRecord>, key: string, at: number): AttemptRecord | undefined {
  const record = records.get(key);
  if (!record) return undefined;
  dropOutsideWindow(record, at);
  if (record.failures.length === 0 && record.lockedUntil <= at) {
    records.delete(key);
    return undefined;
  }
  return record;
}

function evictRecords(records: Map<string, AttemptRecord>, at: number): void {
  for (const key of [...records.keys()]) readRecord(records, key, at);
  if (records.size <= MAX_RECORDS) return;
  const oldestFirst = [...records.entries()].sort((a, b) => lastFailureAt(a[1]) - lastFailureAt(b[1]));
  for (const [key] of oldestFirst.slice(0, records.size - MAX_RECORDS)) records.delete(key);
}

function lockDuration(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  const doublings = failures - FREE_ATTEMPTS - 1;
  return Math.min(BASE_LOCK_MS * 2 ** doublings, MAX_LOCK_MS);
}

/**
 * The separator between the account half and the source half of a key.
 *
 * NOT `@`, which is what this used, and the reason is the per-account ceiling
 * below: an account IS an email address, so `owner@shop.com@192.168.1.40` has
 * no unambiguous split and the account could not be recovered from the key. A
 * NUL cannot occur in either half.
 */
const KEY_SEPARATOR = "\u0000";
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
  const bucket = throttleSource(source);
  return bucket ? `${needle}${KEY_SEPARATOR}${bucket}` : needle;
}

const IPV6_BYTES = /^[0-9a-f]{2}(?::[0-9a-f]{2}){15}$/;
const IPV6_SUBSCRIBER_BYTES = 8;

/**
 * The form a source is COUNTED in. One IPv6 subscriber holds a whole /64 and
 * can send from any address in it, so an IPv6 source is its /64; an IPv4
 * source is itself. Null stays null: the machine's own console.
 */
export function throttleSource(source: string | null): string | null {
  const canonical = canonicalOrigin(source);
  if (canonical === null || canonical === "") return null;
  if (!IPV6_BYTES.test(canonical)) return canonical;
  return `${canonical.split(":").slice(0, IPV6_SUBSCRIBER_BYTES).join(":")}::/64`;
}

function accountOf(key: string): string {
  return key.split(KEY_SEPARATOR)[0] ?? key;
}

export function createLoginThrottle(now: () => number = Date.now): LoginThrottle {
  const records = new Map<string, AttemptRecord>();
  const read = (key: string, at: number) => readRecord(records, key, at);

  return {
    retryAfter(key) {
      const at = now();
      const record = read(key, at);
      if (!record) return 0;
      if (record.lockedUntil > at) return Math.ceil((record.lockedUntil - at) / 1000);
      if (record.lockedUntil !== 0) {
        // A SERVED LOCK STEPS THE LADDER DOWN ONE RUNG — it does not reset it.
        // Left at its high-water mark, one typo after a served wait bought
        // double that wait; reset to zero, every served lock bought five free
        // guesses. One rung down, a post-lock typo costs the same wait again.
        // For the person who is simply locked out and needs to work now, the
        // answer is `POST /users/:id/unlock`, not a weaker ladder.
        record.failures.shift();
        record.lockedUntil = 0;
      }
      return 0;
    },
    fail(key) {
      const at = now();
      const record = read(key, at) ?? { failures: [], lockedUntil: 0 };
      record.failures.push(at);
      const lock = lockDuration(record.failures.length);
      record.lockedUntil = lock > 0 ? at + lock : 0;
      records.set(key, record);

      evictRecords(records, at);
      return Math.ceil(lock / 1000);
    },
    // ONLY the key the credential was verified on. Clearing the whole account
    // here let anyone who could sign in from one address wipe the count an
    // attacker was building against the same account from another.
    succeed(key) {
      records.delete(key);
    },
    unlock(account) {
      const needle = accountOf(throttleKey(account, null));
      records.delete(needle);
      const prefix = `${needle}${KEY_SEPARATOR}`;
      for (const held of [...records.keys()]) {
        if (held.startsWith(prefix)) records.delete(held);
      }
    },
    size() {
      return records.size;
    },
  };
}

/**
 * Failures a single SOURCE may make, across every account it names, before it
 * is made to wait.
 *
 * The (account, source) ladder above only bites when the attempts name the same
 * account. A caller that names a different one each time never climbs it, so
 * every request it sends buys a full hash and a place in the queue — an
 * unauthenticated flood no rung ever slows. Thirty is far above what one shop's
 * tills mistype in an hour behind one address, and far below a sweep.
 */
const SOURCE_FREE_ATTEMPTS = 30;

export interface SourceThrottle {
  /** Seconds this source must wait, or 0 when its attempt may proceed. */
  retryAfter(source: string): number;
  /** Records a failed sign-in from this source and returns the seconds it is now held for. */
  fail(source: string): number;
  size(): number;
}

/**
 * Counts failed sign-ins per source alone. A success does NOT clear it: one
 * valid account would otherwise reset the count for a sweep of every other.
 * The host's own console has no source and is never counted here.
 */
export function createSourceThrottle(now: () => number = Date.now): SourceThrottle {
  const records = new Map<string, AttemptRecord>();

  return {
    retryAfter(source) {
      const at = now();
      const record = readRecord(records, source, at);
      return record && record.lockedUntil > at ? Math.ceil((record.lockedUntil - at) / 1000) : 0;
    },
    fail(source) {
      const at = now();
      const record = readRecord(records, source, at) ?? { failures: [], lockedUntil: 0 };
      record.failures.push(at);
      const doublings = record.failures.length - SOURCE_FREE_ATTEMPTS - 1;
      const lock = doublings < 0 ? 0 : Math.min(BASE_LOCK_MS * 2 ** doublings, MAX_LOCK_MS);
      record.lockedUntil = lock > 0 ? at + lock : 0;
      records.set(source, record);
      evictRecords(records, at);
      return Math.ceil(lock / 1000);
    },
    size() {
      return records.size;
    },
  };
}
