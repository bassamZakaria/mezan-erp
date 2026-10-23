import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteRateWindowStore } from "@mezan/persistence";
import { requireCloudSource } from "./client-source.js";
import { addressKey, createMemoryRateWindowStore, createRateLimiter, RequestCapRefusal, requestCap, sessionKey } from "./rate-limit.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function twoInstances(limit: number, windowMs: number, clock: () => number) {
  const dir = mkdtempSync(join(tmpdir(), "mezan-rate-"));
  dirs.push(dir);
  const file = join(dir, "platform.db");
  const build = () => createRateLimiter(limit, windowMs, clock, createSqliteRateWindowStore(file, "signup-start-email"));
  return [build(), build()] as const;
}

describe("rate limiter shared through the platform database", () => {
  it("counts attempts spread across two instances against ONE limit", () => {
    let now = 1_000;
    const [a, b] = twoInstances(3, 60_000, () => now);
    a.consume("owner@shop.test");
    b.consume("owner@shop.test");
    expect(a.retryAfter("owner@shop.test")).toBe(0);
    a.consume("owner@shop.test");
    expect(b.retryAfter("owner@shop.test")).toBe(60);
    now += 60_000;
    expect(a.retryAfter("owner@shop.test")).toBe(0);
  });

  it("starts a fresh window after the old one lapsed, on either instance", () => {
    let now = 1_000;
    const [a, b] = twoInstances(1, 10_000, () => now);
    a.consume("k");
    expect(b.retryAfter("k")).toBe(10);
    now += 10_000;
    b.consume("k");
    expect(a.retryAfter("k")).toBe(10);
  });

  it("keeps the in-process default working with no store", () => {
    let now = 0;
    const limiter = createRateLimiter(1, 1_000, () => now);
    limiter.consume("k");
    expect(limiter.retryAfter("k")).toBe(1);
    now += 1_000;
    expect(limiter.retryAfter("k")).toBe(0);
  });
});

describe("in-memory window store", () => {
  it("never holds more than the cap, dropping the oldest window first", () => {
    const store = createMemoryRateWindowStore();
    for (let i = 0; i < 5; i += 1) {
      store.hit(`k${i}`, i, 1_000);
      store.sweep(i, 3);
    }
    expect(["k0", "k1", "k2", "k3", "k4"].map((k) => store.read(k, 5) !== null)).toEqual([false, false, true, true, true]);
  });

  it("treats a restarted window as the newest, so eviction does not reset a live caller", () => {
    const store = createMemoryRateWindowStore();
    store.hit("old", 0, 10);
    store.hit("other", 5, 10);
    store.hit("old", 10, 10);
    store.sweep(11, 1);
    expect(store.read("old", 11)).toEqual({ hits: 1, resetAt: 20 });
    expect(store.read("other", 11)).toBeNull();
  });

  it("drops lapsed windows on sweep", () => {
    const store = createMemoryRateWindowStore();
    store.hit("a", 0, 10);
    store.hit("b", 5, 10);
    store.sweep(12, 100);
    expect(store.read("a", 12)).toBeNull();
    expect(store.read("b", 12)).not.toBeNull();
  });
});

describe("limiter capacity", () => {
  it("keeps live windows up to the capacity it was given, so junk keys cannot evict a counted caller below it", () => {
    const limiter = createRateLimiter(1, 60_000, () => 0, createMemoryRateWindowStore(), 50_000);
    limiter.consume("real-session");
    for (let i = 0; i < 20_000; i += 1) limiter.consume(`junk-${i}`);
    expect(limiter.retryAfter("real-session")).toBe(60);
  });
});

describe("requestCap", () => {
  function capped(limit: number, clock: () => number, keyOf = (c: Context) => c.req.header("x-key") ?? null) {
    const app = new Hono();
    app.use("*", requestCap(createRateLimiter(limit, 60_000, clock), keyOf));
    app.get("/", (c) => c.text("ok"));
    return (key?: string) => app.request("/", { headers: key === undefined ? {} : { "x-key": key } });
  }

  it("answers 429 with Retry-After once a key spends its limit, and only that key", async () => {
    let now = 0;
    const call = capped(2, () => now);
    expect((await call("a")).status).toBe(200);
    expect((await call("a")).status).toBe(200);
    const refused = await call("a");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    expect(((await refused.json()) as { error: string }).error).toBe(RequestCapRefusal.TooManyRequests);
    expect((await call("b")).status).toBe(200);
    now += 60_000;
    expect((await call("a")).status).toBe(200);
  });

  it("lets a request with no key through uncounted", async () => {
    const call = capped(1, () => 0);
    for (let i = 0; i < 3; i += 1) expect((await call()).status).toBe(200);
  });

  it("never lets parallel requests past the limit", async () => {
    const call = capped(5, () => 0);
    const statuses = (await Promise.all(Array.from({ length: 20 }, () => call("a")))).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
  });
});

describe("sessionKey", () => {
  const keyFor = async (headers: Record<string, string>) => {
    const app = new Hono();
    app.get("/", (c) => c.json({ key: sessionKey(c) }));
    return ((await (await app.request("/", { headers })).json()) as { key: string | null }).key;
  };

  it("keys a bearer token and a session-token header the same, and never a basic-auth password", async () => {
    const bearer = await keyFor({ authorization: "Bearer tok-1" });
    expect(bearer).not.toBeNull();
    expect(bearer).not.toContain("tok-1");
    expect(await keyFor({ "x-session-token": "tok-1" })).toBe(bearer);
    expect(await keyFor({ authorization: "Bearer tok-2" })).not.toBe(bearer);
    expect(await keyFor({ authorization: "Basic ZGVtbzpwdw==" })).toBeNull();
    expect(await keyFor({})).toBeNull();
    expect(await keyFor({ authorization: "Bearer tok-1", "x-session-token": "rotated-every-call" })).toBe(bearer);
  });
});

describe("addressKey", () => {
  const keyOf = async (peer: string) => {
    const app = new Hono();
    app.use("*", requireCloudSource({ trustedProxyHops: 1 }));
    app.get("/", (c) => c.json({ key: addressKey(c) }));
    return ((await (await app.request("/", { headers: { "x-forwarded-for": peer } })).json()) as { key: string }).key;
  };

  it("keys IPv6 by its /64 and IPv4 by the whole address", async () => {
    expect(await keyOf("2001:db8:0:1::1")).toBe(await keyOf("2001:db8:0:1:ffff::2"));
    expect(await keyOf("2001:db8:0:1::1")).not.toBe(await keyOf("2001:db8:0:2::1"));
    expect(await keyOf("41.33.1.2")).toBe("41.33.1.2");
    expect(await keyOf("::ffff:41.33.1.2")).toBe("41.33.1.2");
  });
});
