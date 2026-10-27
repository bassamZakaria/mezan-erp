import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteLeaseStore } from "@mezan/persistence";
import { Hono } from "hono";
import { createLeasedKeyedLock, createMemoryKeyedLock, leaseBeforeTheTurn, LockBusyError } from "./keyed-lock.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sharedFile() {
  const dir = mkdtempSync(join(tmpdir(), "mezan-lease-"));
  dirs.push(dir);
  return join(dir, "tenant.db");
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

describe("createMemoryKeyedLock", () => {
  it("runs two callers on one key strictly one after the other", async () => {
    const lock = createMemoryKeyedLock();
    const order: string[] = [];
    const first = lock.run("k", async () => {
      order.push("a:start");
      await tick();
      order.push("a:end");
    });
    const second = lock.run("k", async () => {
      order.push("b:start");
      order.push("b:end");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("a failing holder does not wedge the key", async () => {
    const lock = createMemoryKeyedLock();
    await expect(lock.run("k", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(lock.run("k", async () => "ok")).resolves.toBe("ok");
  });
});

describe("createLeasedKeyedLock across two server instances over one database", () => {
  it("never lets two instances inside the same key at once", async () => {
    const file = sharedFile();
    const a = createLeasedKeyedLock({ store: createSqliteLeaseStore(file), pollMs: 1 });
    const b = createLeasedKeyedLock({ store: createSqliteLeaseStore(file), pollMs: 1 });
    let inside = 0;
    let overlapped = false;
    const critical = async () => {
      inside += 1;
      if (inside > 1) overlapped = true;
      await tick();
      await tick();
      inside -= 1;
    };
    await Promise.all([a, b, a, b, a, b].map((lock) => lock.run("hr-advance:ADV-1", critical)));
    expect(overlapped).toBe(false);
  });

  it("different keys do not wait for each other", async () => {
    const file = sharedFile();
    const a = createLeasedKeyedLock({ store: createSqliteLeaseStore(file), pollMs: 1 });
    const b = createLeasedKeyedLock({ store: createSqliteLeaseStore(file), pollMs: 1 });
    let release!: () => void;
    const held = a.run("one", () => new Promise<void>((resolve) => (release = resolve)));
    await tick();
    await expect(b.run("two", async () => "free")).resolves.toBe("free");
    release();
    await held;
  });

  it("refuses with LockBusyError once the wait is spent, and the holder still releases", async () => {
    const file = sharedFile();
    let now = 1_000;
    const store = createSqliteLeaseStore(file);
    const a = createLeasedKeyedLock({ store, now: () => now, leaseMs: 60_000, waitMs: 50, pollMs: 10, sleep: async (ms) => void (now += ms) });
    const b = createLeasedKeyedLock({ store: createSqliteLeaseStore(file), now: () => now, leaseMs: 60_000, waitMs: 50, pollMs: 10, sleep: async (ms) => void (now += ms) });
    let release!: () => void;
    const held = a.run("k", () => new Promise<void>((resolve) => (release = resolve)));
    await tick();
    await expect(b.run("k", async () => "never")).rejects.toBeInstanceOf(LockBusyError);
    release();
    await held;
    await expect(b.run("k", async () => "now")).resolves.toBe("now");
  });

  it("an instance that died inside the work does not hold the key past its lease", async () => {
    const file = sharedFile();
    const store = createSqliteLeaseStore(file);
    expect(await store.tryAcquire("k", "dead-instance", 2_000, 1_000)).toBe(true);
    expect(await store.tryAcquire("k", "other", 3_000, 1_500)).toBe(false);
    expect(await store.tryAcquire("k", "other", 4_000, 2_000)).toBe(true);
    await store.release("k", "dead-instance");
    expect(await store.tryAcquire("k", "third", 5_000, 3_000)).toBe(false);
  });
});

describe("leaseBeforeTheTurn", () => {
  const request = async (prepare: ReturnType<typeof leaseBeforeTheTurn>) => {
    const app = new Hono();
    let released: (() => void) | void = undefined;
    app.post("/x", async (c) => {
      const outcome = await prepare(c);
      if (outcome instanceof Response) return outcome;
      released = outcome;
      return c.json({ ok: true });
    });
    const res = await app.fetch(new Request("http://local/x", { method: "POST" }));
    return { res, release: () => released?.() };
  };

  it("answers 409 RESOURCE_BUSY once the wait is spent, and frees the key when the holder releases", async () => {
    const clock = { now: 1_000 };
    const prepare = leaseBeforeTheTurn({
      store: createSqliteLeaseStore(sharedFile()),
      inTurn: (work) => work(),
      keyFor: async () => "k",
      now: () => clock.now,
      leaseMs: 60_000,
      waitMs: 50,
      pollMs: 10,
      sleep: async (ms) => void (clock.now += ms),
    });
    const first = await request(prepare);
    expect(first.res.status).toBe(200);

    const second = await request(prepare);
    expect(second.res.status).toBe(409);
    expect(await second.res.json()).toMatchObject({ error: "RESOURCE_BUSY" });

    first.release();
    await tick();
    expect((await request(prepare)).res.status).toBe(200);
  });
});
