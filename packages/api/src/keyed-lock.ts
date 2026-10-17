import { randomUUID } from "node:crypto";

export interface KeyedLock {
  run<T>(key: string, work: () => Promise<T>): Promise<T>;
}

export interface LeaseStore {
  /** One atomic statement: true only when the key was free or its previous lease had expired. */
  tryAcquire(key: string, owner: string, expiresAt: number, now: number): boolean;
  release(key: string, owner: string): void;
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
        while (!options.store.tryAcquire(key, owner, now() + leaseMs, now())) {
          if (now() >= deadline) throw new LockBusyError(key);
          await sleep(pollMs);
        }
        try {
          return await work();
        } finally {
          options.store.release(key, owner);
        }
      }),
  };
}
