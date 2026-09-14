export interface CachedHandle { close(): void | Promise<void> }

export interface BackendCacheOptions<H extends CachedHandle> {
  readonly open: (code: string) => Promise<H>;
  readonly idleMs?: number;
  readonly now?: () => number;
  readonly sweepEveryMs?: number;
}

export interface BackendCache<H> {
  get(code: string): Promise<H>;
  sweep(): Promise<void>;
  close(): Promise<void>;
  readonly size: number;
}

export const DEFAULT_IDLE_MS = 30 * 60 * 1000;

export function createBackendCache<H extends CachedHandle>(options: BackendCacheOptions<H>): BackendCache<H> {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { handle: Promise<H>; lastUsed: number }>();
  let closed = false;
  const timer = options.sweepEveryMs === 0 ? null : setInterval(() => void sweep(), options.sweepEveryMs ?? 60_000);
  timer?.unref();

  async function sweep(): Promise<void> {
    const cutoff = now() - idleMs;
    for (const [code, entry] of entries) {
      if (entry.lastUsed <= cutoff) {
        entries.delete(code);
        await (await entry.handle).close();
      }
    }
  }

  return {
    get size() { return entries.size; },
    async get(code) {
      if (closed) throw new Error("CACHE_CLOSED");
      const existing = entries.get(code);
      if (existing) { existing.lastUsed = now(); return existing.handle; }
      const entry = { handle: options.open(code), lastUsed: now() };
      entries.set(code, entry);
      try { return await entry.handle; } catch (err) { entries.delete(code); throw err; }
    },
    sweep,
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      const open = [...entries.values()]; entries.clear();
      for (const entry of open) await (await entry.handle).close();
    },
  };
}
