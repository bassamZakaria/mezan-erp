import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { throttleKey, throttleSource, type LoginThrottle, type SourceThrottle } from "./login-throttle.js";

export const ACCOUNT_LOCK_FAILURES = 20;
export const ACCOUNT_LOCK_WINDOW_MS = 24 * 60 * 60_000;
export const UNLOCK_CODE_TTL_MS = 60 * 60_000;
export const UNLOCK_CODE_ATTEMPTS = 5;
const UNLOCK_CODE_LENGTH = 16;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const UNKNOWN_ACCOUNT_RECORDS = 10_000;

export interface AccountLockRecord {
  readonly failures: readonly number[];
  readonly lockedAt: number | null;
  readonly unlockHash: string | null;
  readonly unlockExpiresAt: number | null;
  readonly unlockAttempts: number;
}

/** Where an account's failed sign-ins and its lock are kept. The tenant's database for a real account, so a restart forgets nothing. */
export interface AccountLockStore {
  get(account: string): AccountLockRecord | null;
  put(account: string, record: AccountLockRecord): void;
  delete(account: string): void;
}

export function createMemoryAccountLockStore(maxRecords = Number.POSITIVE_INFINITY): AccountLockStore {
  const records = new Map<string, AccountLockRecord>();
  return {
    get: (account) => records.get(account) ?? null,
    put(account, record) {
      records.delete(account);
      records.set(account, record);
      while (records.size > maxRecords) {
        const oldest = records.keys().next();
        if (oldest.done) break;
        records.delete(oldest.value);
      }
    },
    delete: (account) => void records.delete(account),
  };
}

export interface AccountLockOutcome {
  readonly locked: boolean;
  readonly justLocked: boolean;
}

export interface AccountLocks {
  isLocked(account: string, exists: boolean): boolean;
  fail(account: string, exists: boolean): AccountLockOutcome;
  clear(account: string): void;
  issueUnlockCode(account: string): string | null;
  redeemUnlockCode(account: string, code: string): boolean;
}

export interface AccountLocksOptions {
  /** Accounts that exist. SECURITY: nothing a caller sends may add a row here or remove one — only a failure against a real account writes, and only an unlock deletes. */
  readonly known: AccountLockStore;
  /** Names nobody holds, locked the same way so a lock does not say which accounts exist. Bounded: it guards nothing but that silence. */
  readonly unknown?: AccountLockStore;
  readonly now?: () => number;
}

const EMPTY: AccountLockRecord = { failures: [], lockedAt: null, unlockHash: null, unlockExpiresAt: null, unlockAttempts: 0 };

function accountKey(account: string): string {
  return account.trim().toLowerCase();
}

function hashCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

function newUnlockCode(): string {
  const bytes = randomBytes(UNLOCK_CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += BASE32[byte % BASE32.length];
  return code;
}

export function createAccountLocks(options: AccountLocksOptions): AccountLocks {
  const now = options.now ?? Date.now;
  const unknown = options.unknown ?? createMemoryAccountLockStore(UNKNOWN_ACCOUNT_RECORDS);
  const storeFor = (exists: boolean): AccountLockStore => (exists ? options.known : unknown);

  return {
    isLocked(account, exists) {
      return storeFor(exists).get(accountKey(account))?.lockedAt != null;
    },
    fail(account, exists) {
      const key = accountKey(account);
      const store = storeFor(exists);
      const record = store.get(key) ?? EMPTY;
      if (record.lockedAt !== null) return { locked: true, justLocked: false };
      const at = now();
      const failures = [...record.failures.filter((failedAt) => at - failedAt < ACCOUNT_LOCK_WINDOW_MS), at];
      const locked = failures.length >= ACCOUNT_LOCK_FAILURES;
      store.put(key, { ...record, failures, lockedAt: locked ? at : null });
      return { locked, justLocked: locked };
    },
    clear(account) {
      const key = accountKey(account);
      options.known.delete(key);
      unknown.delete(key);
    },
    issueUnlockCode(account) {
      const key = accountKey(account);
      const record = options.known.get(key);
      if (!record || record.lockedAt === null) return null;
      const code = newUnlockCode();
      options.known.put(key, { ...record, unlockHash: hashCode(code), unlockExpiresAt: now() + UNLOCK_CODE_TTL_MS, unlockAttempts: 0 });
      return code;
    },
    redeemUnlockCode(account, code) {
      const key = accountKey(account);
      const record = options.known.get(key);
      if (!record || record.lockedAt === null || record.unlockHash === null || record.unlockExpiresAt === null) return false;
      if (now() > record.unlockExpiresAt || record.unlockAttempts >= UNLOCK_CODE_ATTEMPTS) return false;
      const offered = Buffer.from(hashCode(code), "hex");
      const expected = Buffer.from(record.unlockHash, "hex");
      if (offered.length !== expected.length || !timingSafeEqual(offered, expected)) {
        options.known.put(key, { ...record, unlockAttempts: record.unlockAttempts + 1 });
        return false;
      }
      options.known.delete(key);
      return true;
    },
  };
}

export enum SignInVerdict {
  Proceed = "proceed",
  Failed = "failed",
  Wait = "wait",
  Locked = "locked",
}

export interface SignInDecision {
  readonly verdict: SignInVerdict;
  readonly retryAfterSeconds: number;
  readonly justLocked: boolean;
}

/**
 * Every rule a sign-in is held to, in one place, so the route and the tests
 * ask the same questions in the same order.
 *
 * SECURITY: `source` null is the machine's own console and nothing else. It is
 * never refused by an account lock and its failures never count toward one —
 * the person at the machine can always get in, and physical access already
 * means the database file. Every other source is counted, an unreadable one
 * included.
 */
export interface SignInGuard {
  check(account: string, source: string | null, exists: boolean): SignInDecision;
  failed(account: string, source: string | null, exists: boolean): SignInDecision;
  succeeded(account: string, source: string | null): void;
  unlock(account: string): void;
  issueUnlockCode(account: string): string | null;
  redeemUnlockCode(account: string, code: string): boolean;
}

export interface SignInGuardOptions {
  readonly throttle: LoginThrottle;
  readonly sources: SourceThrottle;
  readonly locks: AccountLocks;
}

const decision = (verdict: SignInVerdict, retryAfterSeconds = 0, justLocked = false): SignInDecision => ({ verdict, retryAfterSeconds, justLocked });

export function createSignInGuard(options: SignInGuardOptions): SignInGuard {
  const { throttle, sources, locks } = options;
  const unlock = (account: string): void => {
    locks.clear(account);
    throttle.unlock(account);
  };
  return {
    check(account, source, exists) {
      const bucket = throttleSource(source);
      if (bucket !== null && locks.isLocked(account, exists)) return decision(SignInVerdict.Locked);
      const wait = Math.max(throttle.retryAfter(throttleKey(account, source)), bucket === null ? 0 : sources.retryAfter(bucket));
      return wait > 0 ? decision(SignInVerdict.Wait, wait) : decision(SignInVerdict.Proceed);
    },
    failed(account, source, exists) {
      const bucket = throttleSource(source);
      const wait = Math.max(throttle.fail(throttleKey(account, source)), bucket === null ? 0 : sources.fail(bucket));
      if (bucket !== null) {
        const lock = locks.fail(account, exists);
        if (lock.locked) return decision(SignInVerdict.Locked, 0, lock.justLocked);
      }
      return wait > 0 ? decision(SignInVerdict.Wait, wait) : decision(SignInVerdict.Failed);
    },
    succeeded(account, source) {
      throttle.succeed(throttleKey(account, source));
    },
    unlock,
    issueUnlockCode: (account) => locks.issueUnlockCode(account),
    redeemUnlockCode(account, code) {
      if (!locks.redeemUnlockCode(account, code)) return false;
      unlock(account);
      return true;
    },
  };
}
