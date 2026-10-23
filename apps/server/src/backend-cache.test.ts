import { describe, it, expect, vi } from "vitest";
import { createBackendCache } from "./backend-cache.js";

describe("createBackendCache", () => {
  it("opens once and reuses the handle on repeat get", async () => {
    const open = vi.fn(async (code: string) => ({ code, close: vi.fn() }));
    const cache = createBackendCache({ open, sweepEveryMs: 0 });

    const a1 = await cache.get("a");
    const a2 = await cache.get("a");

    expect(open).toHaveBeenCalledTimes(1);
    expect(a1).toBe(a2);
  });

  it("opens once for concurrent gets of the same code", async () => {
    const open = vi.fn(async (code: string) => ({ code, close: vi.fn() }));
    const cache = createBackendCache({ open, sweepEveryMs: 0 });

    const [a1, a2] = await Promise.all([cache.get("a"), cache.get("a")]);

    expect(open).toHaveBeenCalledTimes(1);
    expect(a1).toBe(a2);
  });

  it("opens a second handle for a different code", async () => {
    const open = vi.fn(async (code: string) => ({ code, close: vi.fn() }));
    const cache = createBackendCache({ open, sweepEveryMs: 0 });

    await cache.get("a");
    await cache.get("b");

    expect(open).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(2);
  });

  it("peeks at an open handle without counting as use, so an idle tenant is still swept", async () => {
    let t = 0;
    const closed: string[] = [];
    const open = vi.fn(async (code: string) => ({ code, close: () => void closed.push(code) }));
    const cache = createBackendCache({ open, idleMs: 1000, now: () => t, sweepEveryMs: 0 });
    const handle = await cache.get("a");

    t = 900;
    expect(await cache.peek("a")).toBe(handle);
    expect(cache.peek("never-opened")).toBeUndefined();
    t = 1000;
    await cache.sweep();

    expect(closed).toEqual(["a"]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(cache.peek("a")).toBeUndefined();
  });

  it("closes idle handles on sweep and reopens on next get", async () => {
    let t = 0;
    const open = vi.fn(async (code: string) => ({ code, close: vi.fn() }));
    const cache = createBackendCache({ open, idleMs: 1000, now: () => t, sweepEveryMs: 0 });

    const a = await cache.get("a");
    const b = await cache.get("b");

    t += 1001;
    await cache.sweep();

    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);

    await cache.get("a");
    expect(open).toHaveBeenCalledTimes(3);
  });

  it("a recently used entry survives sweep", async () => {
    let t = 0;
    const open = vi.fn(async (code: string) => ({ code, close: vi.fn() }));
    const cache = createBackendCache({ open, idleMs: 1000, now: () => t, sweepEveryMs: 0 });

    const a = await cache.get("a");
    t += 500;
    await cache.get("a");
    t += 600;
    await cache.sweep();

    expect(cache.size).toBe(1);
    expect(a.close).not.toHaveBeenCalled();
  });

  it("retries open on the next get after a failed open, waiting for that open to settle first", async () => {
    let t = 0;
    let rejectFirst: (err: Error) => void = () => undefined;
    let openCalls = 0;
    const open = vi.fn((code: string) => {
      openCalls += 1;
      if (openCalls === 1) {
        return new Promise<{ code: string; close: ReturnType<typeof vi.fn> }>((_resolve, reject) => {
          rejectFirst = reject;
        });
      }
      return Promise.resolve({ code, close: vi.fn() });
    });
    const cache = createBackendCache({ open, idleMs: 1000, now: () => t, sweepEveryMs: 0 });

    const first = cache.get("a").catch(() => "failed");

    t += 1001;
    const sweepPromise = cache.sweep();
    const pendingSecond = cache.get("a");
    rejectFirst(new Error("boom"));
    const second = await pendingSecond;
    await sweepPromise;
    await first;

    expect(second.code).toBe("a");
    expect(open).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(1);
  });

  it("a close() that throws does not stop the other handles from closing", async () => {
    let t = 0;
    const closeA = vi.fn(() => { throw new Error("close failed"); });
    const closeB = vi.fn();
    const open = vi.fn(async (code: string) => ({ code, close: code === "a" ? closeA : closeB }));
    const cache = createBackendCache({ open, idleMs: 1000, now: () => t, sweepEveryMs: 0 });

    await cache.get("a");
    await cache.get("b");

    t += 1001;
    await cache.sweep();

    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
  });

  it("calls onEvict for each code a sweep evicts", async () => {
    let t = 0;
    const evicted: string[] = [];
    const open = vi.fn(async (code: string) => ({ code, close: vi.fn() }));
    const cache = createBackendCache({ open, idleMs: 1000, now: () => t, sweepEveryMs: 0, onEvict: (code) => evicted.push(code) });

    await cache.get("a");
    await cache.get("b");
    t += 1001;
    await cache.sweep();

    expect(evicted.sort()).toEqual(["a", "b"]);
  });

  it("openCodes lists only currently cached codes, and drops one a sweep evicted", async () => {
    let t = 0;
    const open = vi.fn(async (code: string) => ({ code, close: vi.fn() }));
    const cache = createBackendCache({ open, idleMs: 1000, now: () => t, sweepEveryMs: 0 });

    await cache.get("a");
    await cache.get("b");
    expect(cache.openCodes().sort()).toEqual(["a", "b"]);

    t += 1001;
    await cache.sweep();
    expect(cache.openCodes()).toEqual([]);
  });

  it("closes everything open on close and rejects further get", async () => {
    const open = vi.fn(async (code: string) => ({ code, close: vi.fn() }));
    const cache = createBackendCache({ open, sweepEveryMs: 0 });

    const a = await cache.get("a");
    const b = await cache.get("b");

    await cache.close();

    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
    await expect(cache.get("a")).rejects.toThrow("CACHE_CLOSED");
  });

  it("closes one code's handle when it is evicted, has finished closing before it answers, and opens a new one on the next get", async () => {
    const closed: string[] = [];
    const evicted: string[] = [];
    const open = vi.fn(async (code: string) => ({
      code,
      close: async () => {
        await Promise.resolve();
        closed.push(code);
      },
    }));
    const cache = createBackendCache({ open, sweepEveryMs: 0, onEvict: (code) => evicted.push(code) });
    const first = await cache.get("a");
    await cache.get("b");

    await cache.evict("a");

    expect(closed).toEqual(["a"]);
    expect(evicted).toEqual(["a"]);
    expect(cache.openCodes()).toEqual(["b"]);
    expect(await cache.get("a")).not.toBe(first);
    await cache.evict("never-opened");
    expect(closed).toEqual(["a"]);
  });

  it("lets a handle finish its queued work before closing it", async () => {
    const order: string[] = [];
    const open = vi.fn(async (code: string) => ({
      code,
      drain: async () => void order.push(`drain ${code}`),
      close: () => void order.push(`close ${code}`),
    }));
    const cache = createBackendCache({ open, sweepEveryMs: 0 });
    await cache.get("a");
    await cache.get("b");
    await cache.evict("a");
    await cache.close();
    expect(order).toEqual(["drain a", "close a", "drain b", "close b"]);
  });

  it("closes a handle whose drain never settles once the drain budget runs out", async () => {
    vi.useFakeTimers();
    try {
      const close = vi.fn();
      const cache = createBackendCache({ open: async () => ({ drain: () => new Promise<void>(() => undefined), close }), sweepEveryMs: 0 });
      await cache.get("a");
      const evicted = cache.evict("a");
      await vi.advanceTimersByTimeAsync(10_000);
      await evicted;
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reopen a tenant until its previous handle has finished closing", async () => {
    const order: string[] = [];
    let finishDrain: () => void = () => undefined;
    let opened = 0;
    const cache = createBackendCache({
      open: async () => {
        opened += 1;
        order.push(`open ${opened}`);
        return { drain: () => new Promise<void>((resolve) => { finishDrain = resolve; }), close: () => void order.push(`close ${opened}`) };
      },
      sweepEveryMs: 0,
    });
    await cache.get("a");
    const evicted = cache.evict("a");
    const reopened = cache.get("a");
    await Promise.resolve();
    expect(order).toEqual(["open 1"]);
    finishDrain();
    await evicted;
    await reopened;
    expect(order).toEqual(["open 1", "close 1", "open 2"]);
  });

  it("makes an evict of a tenant the idle sweep already took wait until its handle has closed", async () => {
    let t = 0;
    const order: string[] = [];
    let finishDrain: () => void = () => undefined;
    const cache = createBackendCache({
      open: async () => ({ drain: () => new Promise<void>((resolve) => { finishDrain = resolve; }), close: () => void order.push("closed") }),
      idleMs: 1000,
      now: () => t,
      sweepEveryMs: 0,
    });
    await cache.get("a");
    t += 1001;
    const swept = cache.sweep();
    const evicted = cache.evict("a").then(() => void order.push("evict returned"));
    await Promise.resolve();
    finishDrain();
    await Promise.all([swept, evicted]);
    expect(order).toEqual(["closed", "evict returned"]);
  });
});
