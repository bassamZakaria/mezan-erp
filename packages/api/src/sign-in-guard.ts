import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { throttleKey, throttleSource, type LoginThrottle, type SourceThrottle } from "./login-throttle.js";

export const ACCOUNT_LOCK_FAILURES = 20;
export const ACCOUNT_LOCK_WINDOW_MS = 24 * 60 * 60_000;
export const UNLOCK_CODE_TTL_MS = 60 * 60_000;
const UNLOCK_CODE_LENGTH = 16;
const UNLOCK_LINK_BYTES = 32;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const UNKNOWN_ACCOUNT_RECORDS = 10_000;

export interface AccountLockRecord {
  readonly failures: readonly number[];
  readonly lockedAt: number | null;
  readonly unlockHash: string | null;
  readonly unlockExpiresAt: number | null;
  readonly unlockAttempts: number;
  readonly unlockLinkHash?: string | null;
}

export interface AccountLockStore {
  get(account: string): AccountLockRecord | null;
  put(account: string, record: AccountLockRecord): void;
  delete(account: string): void;
  accountOfLink(linkHash: string): string | null;
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
    accountOfLink(linkHash) {
      for (const [account, record] of records) if (record.unlockLinkHash === linkHash) return account;
      return null;
    },
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
  // SECURITY: true only for a locked account whose last code and link have
  // expired, or that was never issued any. It is what bounds the lock mail to
  // one an hour, whoever keeps knocking.
  unlockReissueDue(account: string): boolean;
  issueUnlockCode(account: string): string | null;
  redeemUnlockCode(account: string, code: string): boolean;
  issueUnlockLink(account: string): string | null;
  redeemUnlockLink(token: string): string | null;
}

export interface AccountLocksOptions {
  /** Accounts that exist. SECURITY: nothing a caller sends may add a row here or remove one — only a failure against a real account writes, and only an unlock deletes. */
  readonly known: AccountLockStore;
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

function hashLink(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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
    unlockReissueDue(account) {
      const record = options.known.get(accountKey(account));
      if (!record || record.lockedAt === null) return false;
      return record.unlockExpiresAt === null || now() > record.unlockExpiresAt;
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
      if (now() > record.unlockExpiresAt) return false;
      const offered = Buffer.from(hashCode(code), "hex");
      const expected = Buffer.from(record.unlockHash, "hex");
      // SECURITY: a wrong code changes nothing. The code is 80 bits and every
      // caller is held by the per-address throttle; counting wrong tries here
      // would let anyone who can reach the route spend the administrator's code.
      if (offered.length !== expected.length || !timingSafeEqual(offered, expected)) return false;
      options.known.delete(key);
      return true;
    },
    issueUnlockLink(account) {
      const key = accountKey(account);
      const record = options.known.get(key);
      if (!record || record.lockedAt === null) return null;
      const token = randomBytes(UNLOCK_LINK_BYTES).toString("base64url");
      options.known.put(key, { ...record, unlockLinkHash: hashLink(token), unlockExpiresAt: now() + UNLOCK_CODE_TTL_MS });
      return token;
    },
    redeemUnlockLink(token) {
      const offered = hashLink(token);
      const key = options.known.accountOfLink(offered);
      const record = key === null ? null : options.known.get(key);
      if (key === null || !record || record.lockedAt === null || record.unlockExpiresAt === null) return null;
      if (!record.unlockLinkHash || now() > record.unlockExpiresAt) return null;
      const expected = Buffer.from(record.unlockLinkHash, "hex");
      const presented = Buffer.from(offered, "hex");
      if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null;
      options.known.delete(key);
      return key;
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
 * SECURITY: `source` null is the machine's own console and nothing else. It is
 * never refused by an account lock and its failures never count toward one —
 * the person at the machine can always get in, and physical access already
 * means the database file. Every other source is counted, an unreadable one
 * included.
 */
export interface SignInGuard {
  check(account: string, source: string | null, exists: boolean): Promise<SignInDecision>;
  failed(account: string, source: string | null, exists: boolean): Promise<SignInDecision>;
  succeeded(account: string, source: string | null): Promise<void>;
  unlock(account: string): Promise<void>;
  unlockReissueDue(account: string): boolean;
  issueUnlockCode(account: string): string | null;
  redeemUnlockCode(account: string, code: string): Promise<boolean>;
  issueUnlockLink(account: string): string | null;
  redeemUnlockLink(token: string): Promise<string | null>;
}

export interface SignInGuardOptions {
  readonly throttle: LoginThrottle;
  readonly sources: SourceThrottle;
  readonly locks: AccountLocks;
}

const decision = (verdict: SignInVerdict, retryAfterSeconds = 0, justLocked = false): SignInDecision => ({ verdict, retryAfterSeconds, justLocked });

export function createSignInGuard(options: SignInGuardOptions): SignInGuard {
  const { throttle, sources, locks } = options;
  const unlock = async (account: string): Promise<void> => {
    locks.clear(account);
    await throttle.unlock(account);
  };
  return {
    async check(account, source, exists) {
      const bucket = throttleSource(source);
      if (bucket !== null && locks.isLocked(account, exists)) return decision(SignInVerdict.Locked);
      const accountWait = await throttle.retryAfter(throttleKey(account, source));
      const wait = Math.max(accountWait, bucket === null ? 0 : await sources.retryAfter(bucket));
      return wait > 0 ? decision(SignInVerdict.Wait, wait) : decision(SignInVerdict.Proceed);
    },
    async failed(account, source, exists) {
      const bucket = throttleSource(source);
      const accountWait = await throttle.fail(throttleKey(account, source));
      const wait = Math.max(accountWait, bucket === null ? 0 : await sources.fail(bucket));
      if (bucket !== null) {
        const lock = locks.fail(account, exists);
        if (lock.locked) return decision(SignInVerdict.Locked, 0, lock.justLocked);
      }
      return wait > 0 ? decision(SignInVerdict.Wait, wait) : decision(SignInVerdict.Failed);
    },
    async succeeded(account, source) {
      await throttle.succeed(throttleKey(account, source));
    },
    unlock,
    unlockReissueDue: (account) => locks.unlockReissueDue(account),
    issueUnlockCode: (account) => locks.issueUnlockCode(account),
    async redeemUnlockCode(account, code) {
      if (!locks.redeemUnlockCode(account, code)) return false;
      await unlock(account);
      return true;
    },
    issueUnlockLink: (account) => locks.issueUnlockLink(account),
    async redeemUnlockLink(token) {
      const account = locks.redeemUnlockLink(token);
      if (account !== null) await unlock(account);
      return account;
    },
  };
}
