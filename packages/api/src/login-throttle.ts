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

export interface AttemptRecord {
  failures: number[];
  lockedUntil: number;
}

export interface AttemptChange<T> {
  /** undefined leaves the stored record alone, null deletes it, a record replaces it. */
  readonly record?: AttemptRecord | null;
  readonly result: T;
}

/**
 * CONTRACT: `update` is one atomic read-modify-write on the key across every
 * process that shares the store. The ladder counts failures with it; an
 * implementation that reads and writes as separate steps lets N server
 * instances each grant an attacker a fresh set of free attempts.
 */
export interface AttemptStore {
  update<T>(key: string, change: (held: AttemptRecord | null) => AttemptChange<T>): Promise<T>;
  /** A plain read for the common "no failures held" and "still locked" answers, which must not take the write lock. */
  peek(key: string): Promise<AttemptRecord | null>;
  remove(key: string): Promise<void>;
  removeWithPrefix(prefix: string): Promise<void>;
  sweep(at: number, limits: { readonly decayMs: number; readonly maxRecords: number }): Promise<void>;
  size(): Promise<number>;
}

export interface LoginThrottle {
  /** Seconds the caller must wait, or 0 when the attempt may proceed. */
  retryAfter(key: string): Promise<number>;
  /** Records a failure and returns the seconds the account is now locked for. */
  fail(key: string): Promise<number>;
  succeed(key: string): Promise<void>;
  unlock(account: string): Promise<void>;
  /** How many records are held. For the exception report and for tests. */
  size(): Promise<number>;
}

export enum SignInRefusal {
  TooManyAttempts = "TOO_MANY_ATTEMPTS",
  AccountLocked = "ACCOUNT_LOCKED",
  Busy = "SIGN_IN_BUSY",
  InvalidUnlockCode = "INVALID_UNLOCK_CODE",
  InvalidUnlockLink = "INVALID_UNLOCK_LINK",
}

export function signInBusy(seconds: number) {
  return {
    error: SignInRefusal.Busy,
    retryAfterSeconds: seconds,
    message: "الخادم مشغول الآن بطلبات دخول أخرى، ولم تُحتسب هذه المحاولة. أعد المحاولة بعد ثوانٍ.",
  };
}

export interface AccountRecovery {
  readonly mailed: boolean;
  // CONTRACT: true where the tenant is served by a platform whose operator can
  // unlock an account from the console. There is no "server machine" to sit at
  // there, and with no mail it is the only way back in for a sole administrator.
  readonly operatorUnlocks: boolean;
}

const LOCKED_AR = "تم قفل هذا الحساب بعد محاولات دخول فاشلة متكررة.";
const LOCKED_EN = "This account was locked after repeated failed sign-in attempts.";
const BY_ADMIN_AR = "اطلب من مدير النظام فكّ القفل من شاشة المستخدمين";
const BY_ADMIN_EN = "ask a system administrator to unlock it from the Users screen";

export function accountLocked(recovery: AccountRecovery) {
  const mailedAr = `${LOCKED_AR} أُرسل رمز فكّ القفل ورابطه إلى بريد مديري النظام، ويُرسل رمز جديد عند المحاولة بعد انتهاء صلاحية السابق: أدخل الرمز هنا أو افتح الرابط، أو ${BY_ADMIN_AR}`;
  const mailedEn = `${LOCKED_EN} An unlock code and link were mailed to the system administrators, and a fresh one is mailed on an attempt after the last expired: enter the code here or open the link, or ${BY_ADMIN_EN}`;
  const [message, messageEn] = recovery.mailed
    ? recovery.operatorUnlocks
      ? [`${mailedAr}، أو تواصل مع دعم المنصة.`, `${mailedEn}, or contact platform support.`]
      : [`${mailedAr}.`, `${mailedEn}.`]
    : recovery.operatorUnlocks
      ? [
          `${LOCKED_AR} ${BY_ADMIN_AR}، وإن كان هذا حساب المدير الوحيد فتواصل مع دعم المنصة ليفكّ القفل.`,
          `${LOCKED_EN} Please ${BY_ADMIN_EN}; if this is the only administrator account, contact platform support to have it unlocked.`,
        ]
      : [
          `${LOCKED_AR} ${BY_ADMIN_AR}، أو سجّل الدخول من جهاز الخادم نفسه.`,
          `${LOCKED_EN} Please ${BY_ADMIN_EN}, or sign in at the server machine itself.`,
        ];
  return { error: SignInRefusal.AccountLocked, unlockByCode: recovery.mailed, message, messageEn };
}

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

function liveRecord(held: AttemptRecord | null, at: number): AttemptRecord | null {
  if (!held) return null;
  const record: AttemptRecord = { failures: [...held.failures], lockedUntil: held.lockedUntil };
  dropOutsideWindow(record, at);
  return record.failures.length === 0 && record.lockedUntil <= at ? null : record;
}

// A failed sign-in sweeps on every attempt, so the full scan for stale records runs at most this often.
const STALE_SWEEP_EVERY_MS = 60_000;

export function createMemoryAttemptStore(): AttemptStore {
  // REQUIRED: every write re-inserts its key, so Map order is last-write order and over-cap eviction drops the oldest first.
  const records = new Map<string, AttemptRecord>();
  let nextStaleSweepAt = 0;
  return {
    async update(key, change) {
      const held = records.get(key);
      const outcome = change(held ? { failures: [...held.failures], lockedUntil: held.lockedUntil } : null);
      if (outcome.record === null) records.delete(key);
      else if (outcome.record !== undefined) {
        records.delete(key);
        records.set(key, outcome.record);
      }
      return outcome.result;
    },
    async peek(key) {
      const held = records.get(key);
      return held ? { failures: [...held.failures], lockedUntil: held.lockedUntil } : null;
    },
    remove: async (key) => void records.delete(key),
    async removeWithPrefix(prefix) {
      for (const held of [...records.keys()]) if (held.startsWith(prefix)) records.delete(held);
    },
    async sweep(at, limits) {
      if (at >= nextStaleSweepAt) {
        nextStaleSweepAt = at + STALE_SWEEP_EVERY_MS;
        for (const [key, record] of records) {
          if (record.lockedUntil <= at && at - lastFailureAt(record) > limits.decayMs) records.delete(key);
        }
      }
      for (const key of records.keys()) {
        if (records.size <= limits.maxRecords) return;
        records.delete(key);
      }
    },
    size: async () => records.size,
  };
}

const LIMITS = { decayMs: DECAY_MS, maxRecords: MAX_RECORDS } as const;

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
const KEY_SEPARATOR = "\u001F";
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

export function createLoginThrottle(now: () => number = Date.now, store: AttemptStore = createMemoryAttemptStore()): LoginThrottle {
  return {
    async retryAfter(key) {
      const at = now();
      const seen = await store.peek(key);
      if (!seen) return 0;
      const open = liveRecord(seen, at);
      if (open && open.lockedUntil > at) return Math.ceil((open.lockedUntil - at) / 1000);
      return store.update(key, (held) => {
        const record = liveRecord(held, at);
        if (!record) return { record: held ? null : undefined, result: 0 };
        if (record.lockedUntil > at) return { record, result: Math.ceil((record.lockedUntil - at) / 1000) };
        if (record.lockedUntil !== 0) {
          // A SERVED LOCK STEPS THE LADDER DOWN ONE RUNG — it does not reset it.
          // For the person who is simply locked out and needs to work now, the
          // answer is `POST /users/:id/unlock`, not a weaker ladder.
          record.failures.shift();
          record.lockedUntil = 0;
          return { record: record.failures.length === 0 ? null : record, result: 0 };
        }
        return { result: 0 };
      });
    },
    async fail(key) {
      const at = now();
      const lock = await store.update(key, (held) => {
        const record = liveRecord(held, at) ?? { failures: [], lockedUntil: 0 };
        record.failures.push(at);
        const duration = lockDuration(record.failures.length);
        record.lockedUntil = duration > 0 ? at + duration : 0;
        return { record, result: duration };
      });
      await store.sweep(at, LIMITS);
      return Math.ceil(lock / 1000);
    },
    // ONLY the key the credential was verified on. Clearing the whole account
    // here let anyone who could sign in from one address wipe the count an
    // attacker was building against the same account from another.
    async succeed(key) {
      await store.remove(key);
    },
    async unlock(account) {
      const needle = accountOf(throttleKey(account, null));
      await store.remove(needle);
      await store.removeWithPrefix(`${needle}${KEY_SEPARATOR}`);
    },
    size() {
      return store.size();
    },
  };
}

const SOURCE_FREE_ATTEMPTS = 30;

export interface SourceThrottle {
  retryAfter(source: string): Promise<number>;
  fail(source: string): Promise<number>;
  size(): Promise<number>;
}

/**
 * Counts failed sign-ins per source alone. A success does NOT clear it: one
 * valid account would otherwise reset the count for a sweep of every other.
 * The host's own console has no source and is never counted here.
 */
export function createSourceThrottle(
  now: () => number = Date.now,
  freeAttempts: number = SOURCE_FREE_ATTEMPTS,
  store: AttemptStore = createMemoryAttemptStore(),
): SourceThrottle {
  return {
    async retryAfter(source) {
      const at = now();
      const record = liveRecord(await store.peek(source), at);
      return record && record.lockedUntil > at ? Math.ceil((record.lockedUntil - at) / 1000) : 0;
    },
    async fail(source) {
      const at = now();
      const lock = await store.update(source, (held) => {
        const record = liveRecord(held, at) ?? { failures: [], lockedUntil: 0 };
        record.failures.push(at);
        const doublings = record.failures.length - freeAttempts - 1;
        const duration = doublings < 0 ? 0 : Math.min(BASE_LOCK_MS * 2 ** doublings, MAX_LOCK_MS);
        record.lockedUntil = duration > 0 ? at + duration : 0;
        return { record, result: duration };
      });
      await store.sweep(at, LIMITS);
      return Math.ceil(lock / 1000);
    },
    size() {
      return store.size();
    },
  };
}
