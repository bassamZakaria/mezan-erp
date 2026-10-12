export interface CachedHandle { close(): void | Promise<void> }

export interface BackendCacheOptions<H extends CachedHandle> {
  readonly open: (code: string) => Promise<H>;
  readonly idleMs?: number;
  readonly now?: () => number;
  readonly sweepEveryMs?: number;
  /** Called for each code a sweep evicts, before its handle finishes closing. */
  readonly onEvict?: (code: string) => void;
}

export interface BackendCache<H> {
  get(code: string): Promise<H>;
  /** An open handle, without counting as use: the idle sweep still closes it on time. Undefined when none is open. */
  peek(code: string): Promise<H> | undefined;
  sweep(): Promise<void>;
  evict(code: string): Promise<void>;
  close(): Promise<void>;
  readonly size: number;
  /** The codes with a currently open (cached) handle — a closed tenant's code is absent, not merely idle. */
  openCodes(): string[];
}

export const DEFAULT_IDLE_MS = 30 * 60 * 1000;

export function createBackendCache<H extends CachedHandle>(options: BackendCacheOptions<H>): BackendCache<H> {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { handle: Promise<H>; lastUsed: number }>();
  let closed = false;
  const timer = options.sweepEveryMs === 0
    ? null
    : setInterval(() => { sweep().catch(() => undefined); }, options.sweepEveryMs ?? 60_000);
  timer?.unref();

  async function sweep(): Promise<void> {
    const cutoff = now() - idleMs;
    const due: Array<Promise<H>> = [];
    for (const [code, entry] of entries) {
      if (entry.lastUsed <= cutoff) {
        entries.delete(code);
        options.onEvict?.(code);
        due.push(entry.handle);
      }
    }
    await Promise.allSettled(due.map((handle) => handle.then((h) => h.close())));
  }

  return {
    get size() { return entries.size; },
    openCodes: () => [...entries.keys()],
    async get(code) {
      if (closed) throw new Error("CACHE_CLOSED");
      const existing = entries.get(code);
      if (existing) { existing.lastUsed = now(); return existing.handle; }
      const entry = { handle: options.open(code), lastUsed: now() };
      entries.set(code, entry);
      try {
        return await entry.handle;
      } catch (err) {
        if (entries.get(code) === entry) entries.delete(code);
        throw err;
      }
    },
    peek: (code) => entries.get(code)?.handle,
    sweep,
    async evict(code) {
      const entry = entries.get(code);
      if (!entry) return;
      entries.delete(code);
      options.onEvict?.(code);
      await entry.handle.then((h) => h.close()).catch(() => undefined);
    },
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      const open = [...entries.values()]; entries.clear();
      await Promise.allSettled(open.map((entry) => entry.handle.then((h) => h.close())));
    },
  };
}
