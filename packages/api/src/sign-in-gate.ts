export interface SignInGateOptions {
  /** PIN checks hashing at once. */
  readonly running?: number;
  /** Checks that may wait for one of those places. */
  readonly waiting?: number;
  /** Places, running or waiting, one address may hold. */
  readonly perSource?: number;
}

export interface SignInGate {
  /** Runs `check` when a place is free. Null when there is none: the caller is refused now and nothing is hashed. */
  admit<T>(source: string | null, check: () => Promise<T>): Promise<T> | null;
}

const RUNNING = 4;
const WAITING = 12;
const PER_SOURCE = 6;
const HOST_CONSOLE = "\u0000host";

// A PIN check is a scrypt on a four-thread pool the whole process shares, and
// anyone may ask for one. Unbounded, a thousand anonymous sign-ins queue a
// thousand hashes ahead of the owner's. Here a tenant hashes a few at a time,
// keeps a short queue, and no one address may fill it.
export function createSignInGate(options: SignInGateOptions = {}): SignInGate {
  const maxRunning = options.running ?? RUNNING;
  const maxWaiting = options.waiting ?? WAITING;
  const perSource = options.perSource ?? PER_SOURCE;
  const heldBy = new Map<string, number>();
  const queue: (() => void)[] = [];
  let running = 0;

  const leave = (key: string): void => {
    const held = (heldBy.get(key) ?? 1) - 1;
    if (held === 0) heldBy.delete(key);
    else heldBy.set(key, held);
    const next = queue.shift();
    if (next) next();
    else running -= 1;
  };

  return {
    admit<T>(source: string | null, check: () => Promise<T>): Promise<T> | null {
      const key = source ?? HOST_CONSOLE;
      const held = heldBy.get(key) ?? 0;
      if (held >= perSource || running + queue.length >= maxRunning + maxWaiting) return null;
      heldBy.set(key, held + 1);
      const run = async (): Promise<T> => {
        try {
          return await check();
        } finally {
          leave(key);
        }
      };
      if (running < maxRunning) {
        running += 1;
        return run();
      }
      return new Promise<T>((resolve) => queue.push(() => resolve(run())));
    },
  };
}
