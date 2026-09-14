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
});
