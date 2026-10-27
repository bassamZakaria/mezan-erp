import { randomUUID } from "node:crypto";
import type { Context } from "hono";

export interface KeyedLock {
  run<T>(key: string, work: () => Promise<T>): Promise<T>;
}

export interface LeaseStore {
  /** One atomic statement: true only when the key was free or its previous lease had expired. */
  tryAcquire(key: string, owner: string, expiresAt: number, now: number): Promise<boolean>;
  release(key: string, owner: string): Promise<void>;
}

export class LockBusyError extends Error {
  constructor(readonly key: string) {
    super(`The resource ${key} is being changed by another request.`);
    this.name = "LockBusyError";
  }
}

export const LOCK_BUSY_AR = "هذا السجل قيد التعديل من طلب آخر الآن، أعد المحاولة بعد لحظات.";

export function createMemoryKeyedLock(): KeyedLock {
  const tails = new Map<string, Promise<unknown>>();
  return {
    async run(key, work) {
      const previous = tails.get(key) ?? Promise.resolve();
      const run = previous.catch(() => undefined).then(work);
      tails.set(key, run);
      try {
        return await run;
      } finally {
        if (tails.get(key) === run) tails.delete(key);
      }
    },
  };
}

export interface LeasedKeyedLockOptions {
  readonly store: LeaseStore;
  readonly now?: () => number;
  /** SECURITY/CORRECTNESS: must outlast the slowest `work`, or a second instance enters while the first is still inside. */
  readonly leaseMs?: number;
  readonly waitMs?: number;
  readonly pollMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_WAIT_MS = 10_000;
const DEFAULT_POLL_MS = 25;

/**
 * Mutual exclusion across every server instance sharing one database.
 *
 * In-process callers queue on the promise chain first, so only one request per
 * process polls the database; a lease that expires covers an instance that
 * died inside `work`.
 */
export function createLeasedKeyedLock(options: LeasedKeyedLockOptions): KeyedLock {
  const now = options.now ?? Date.now;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const local = createMemoryKeyedLock();

  return {
    run: (key, work) =>
      local.run(key, async () => {
        const owner = randomUUID();
        const deadline = now() + waitMs;
        while (!(await options.store.tryAcquire(key, owner, now() + leaseMs, now()))) {
          if (now() >= deadline) throw new LockBusyError(key);
          await sleep(pollMs);
        }
        try {
          return await work();
        } finally {
          await options.store.release(key, owner);
        }
      }),
  };
}

export interface LeaseBeforeTheTurnOptions {
  readonly store: LeaseStore;
  readonly inTurn: <T>(work: () => Promise<T>) => Promise<T>;
  readonly keyFor: (c: Context) => Promise<string | null>;
  readonly now?: () => number;
  readonly leaseMs?: number;
  readonly waitMs?: number;
  readonly pollMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * SECURITY/CORRECTNESS: the wait for a lease held by another instance happens
 * BEFORE the request takes the connection's turn and opens its audit
 * transaction. Inside either, a poll that yields would hold every other write
 * of the tenant behind it, or roll the request back as having yielded. Each
 * database statement here is one short turn of its own.
 */
export function leaseBeforeTheTurn(options: LeaseBeforeTheTurnOptions) {
  const now = options.now ?? Date.now;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return async (c: Context): Promise<(() => void) | Response | void> => {
    const key = await options.keyFor(c);
    if (key === null) return;
    const owner = randomUUID();
    const deadline = now() + waitMs;
    while (!(await options.inTurn(async () => options.store.tryAcquire(key, owner, now() + leaseMs, now())))) {
      if (now() >= deadline) return c.json({ error: "RESOURCE_BUSY", message: LOCK_BUSY_AR }, 409);
      await sleep(pollMs);
    }
    return () => void options.inTurn(async () => options.store.release(key, owner)).catch(() => undefined);
  };
}
