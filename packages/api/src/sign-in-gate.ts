export interface SignInGateOptions {
  readonly running?: number;
  readonly waiting?: number;
  readonly perSource?: number;
  readonly reserved?: number;
}

export interface SignInGate {
  admit<T>(source: string | null, check: () => Promise<T>): Promise<T> | null;
}

const RUNNING = 4;
const WAITING = 12;
const PER_SOURCE = 6;
const RESERVED = 4;
const HOST_CONSOLE = "\u0000host";

// A PIN check is a scrypt on a four-thread pool the whole process shares, and
// anyone may ask for one. Unbounded, a thousand anonymous sign-ins queue a
// thousand hashes ahead of the owner's. Here a tenant hashes a few at a time
// and keeps a short queue. No one address may fill it; the last places go only
// to an address holding none, so a handful of busy addresses cannot take them
// all; waiting addresses are served in turn, not in arrival order; and the
// machine's own console is outside the count altogether.
export function createSignInGate(options: SignInGateOptions = {}): SignInGate {
  const maxRunning = options.running ?? RUNNING;
  const capacity = maxRunning + (options.waiting ?? WAITING);
  const perSource = options.perSource ?? PER_SOURCE;
  const reserved = Math.min(options.reserved ?? RESERVED, Math.max(0, capacity - 1));
  const heldBy = new Map<string, number>();
  const waitingBy = new Map<string, (() => void)[]>();
  let running = 0;
  let remoteHeld = 0;
  let lastServed: string | null = null;

  const takeNext = (): (() => void) | undefined => {
    const sources = [...waitingBy.keys()];
    if (sources.length === 0) return undefined;
    const after = lastServed === null ? -1 : sources.indexOf(lastServed);
    const key = waitingBy.has(HOST_CONSOLE) ? HOST_CONSOLE : sources[(after + 1) % sources.length]!;
    const queue = waitingBy.get(key)!;
    const next = queue.shift();
    if (queue.length === 0) waitingBy.delete(key);
    return next;
  };

  const leave = (key: string): void => {
    const held = (heldBy.get(key) ?? 1) - 1;
    if (held === 0) heldBy.delete(key);
    else heldBy.set(key, held);
    if (key !== HOST_CONSOLE) remoteHeld -= 1;
    const next = takeNext();
    if (next) next();
    else running -= 1;
  };

  return {
    admit<T>(source: string | null, check: () => Promise<T>): Promise<T> | null {
      const key = source ?? HOST_CONSOLE;
      const held = heldBy.get(key) ?? 0;
      if (held >= perSource) return null;
      if (key !== HOST_CONSOLE) {
        if (remoteHeld >= capacity) return null;
        if (held > 0 && remoteHeld >= capacity - reserved) return null;
        remoteHeld += 1;
      }
      heldBy.set(key, held + 1);
      const run = async (): Promise<T> => {
        lastServed = key;
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
      return new Promise<T>((resolve) => {
        const queue = waitingBy.get(key) ?? [];
        queue.push(() => resolve(run()));
        waitingBy.set(key, queue);
      });
    },
  };
}
