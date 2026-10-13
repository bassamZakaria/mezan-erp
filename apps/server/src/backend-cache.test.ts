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

  it("retries open on the next get after a failure, without deleting a newer entry that replaced it", async () => {
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
    const second = await cache.get("a");
    rejectFirst(new Error("boom"));
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
});
