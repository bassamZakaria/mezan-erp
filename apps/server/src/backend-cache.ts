export interface CachedHandle { close(): void | Promise<void>; drain?(): Promise<void> }

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
  peek(code: string): Promise<H> | undefined;
  sweep(): Promise<void>;
  evict(code: string): Promise<void>;
  close(): Promise<void>;
  readonly size: number;
  /** The codes with a currently open (cached) handle — a closed tenant's code is absent, not merely idle. */
  openCodes(): string[];
}

export const DEFAULT_IDLE_MS = 30 * 60 * 1000;

export function isClosedConnectionError(err: unknown): boolean {
  return err instanceof Error && /database connection is not open/i.test(err.message);
}
// Several tenants close in parallel on shutdown, so this must stay well under the process's shutdown budget.
const DRAIN_BUDGET_MS = 10_000;

async function shut(handle: CachedHandle): Promise<void> {
  if (handle.drain) {
    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<void>((resolve) => { timer = setTimeout(resolve, DRAIN_BUDGET_MS); });
    await Promise.race([handle.drain().catch(() => undefined), budget]);
    clearTimeout(timer);
  }
  await handle.close();
}

export function createBackendCache<H extends CachedHandle>(options: BackendCacheOptions<H>): BackendCache<H> {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { handle: Promise<H>; lastUsed: number }>();
  // REQUIRED: a tenant is never reopened while its last handle is still draining, or two handles write one file.
  const closing = new Map<string, Promise<void>>();
  let closed = false;

  function retire(code: string, handle: Promise<H>): Promise<void> {
    const done: Promise<void> = handle.then(shut).finally(() => {
      if (closing.get(code) === done) closing.delete(code);
    });
    closing.set(code, done);
    return done;
  }

  async function get(code: string): Promise<H> {
    if (closed) throw new Error("CACHE_CLOSED");
    const existing = entries.get(code);
    if (existing) { existing.lastUsed = now(); return existing.handle; }
    const retiring = closing.get(code);
    if (retiring) {
      await retiring.catch(() => undefined);
      return get(code);
    }
    const entry = { handle: options.open(code), lastUsed: now() };
    entries.set(code, entry);
    try {
      return await entry.handle;
    } catch (err) {
      if (entries.get(code) === entry) entries.delete(code);
      throw err;
    }
  }
  const timer = options.sweepEveryMs === 0
    ? null
    : setInterval(() => { sweep().catch(() => undefined); }, options.sweepEveryMs ?? 60_000);
  timer?.unref();

  async function sweep(): Promise<void> {
    const cutoff = now() - idleMs;
    const due: Array<Promise<void>> = [];
    for (const [code, entry] of entries) {
      if (entry.lastUsed <= cutoff) {
        entries.delete(code);
        options.onEvict?.(code);
        due.push(retire(code, entry.handle));
      }
    }
    await Promise.allSettled(due);
  }

  return {
    get size() { return entries.size; },
    openCodes: () => [...entries.keys()],
    get,
    peek: (code) => entries.get(code)?.handle,
    sweep,
    async evict(code) {
      const entry = entries.get(code);
      if (!entry) {
        await closing.get(code)?.catch(() => undefined);
        return;
      }
      entries.delete(code);
      options.onEvict?.(code);
      await retire(code, entry.handle).catch(() => undefined);
    },
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      const open = [...entries]; entries.clear();
      for (const [code, entry] of open) retire(code, entry.handle).catch(() => undefined);
      await Promise.allSettled([...closing.values()]);
    },
  };
}
