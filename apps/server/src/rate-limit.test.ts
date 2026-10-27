import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteRateWindowStore } from "@mezan/persistence";
import { createRateLimiter } from "./rate-limit.js";

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
  it("counts attempts spread across two instances against ONE limit", async () => {
    let now = 1_000;
    const [a, b] = twoInstances(3, 60_000, () => now);
    await a.consume("owner@shop.test");
    await b.consume("owner@shop.test");
    expect(await a.retryAfter("owner@shop.test")).toBe(0);
    await a.consume("owner@shop.test");
    expect(await b.retryAfter("owner@shop.test")).toBe(60);
    now += 60_000;
    expect(await a.retryAfter("owner@shop.test")).toBe(0);
  });

  it("starts a fresh window after the old one lapsed, on either instance", async () => {
    let now = 1_000;
    const [a, b] = twoInstances(1, 10_000, () => now);
    await a.consume("k");
    expect(await b.retryAfter("k")).toBe(10);
    now += 10_000;
    await b.consume("k");
    expect(await a.retryAfter("k")).toBe(10);
  });

  it("keeps the in-process default working with no store", async () => {
    let now = 0;
    const limiter = createRateLimiter(1, 1_000, () => now);
    await limiter.consume("k");
    expect(await limiter.retryAfter("k")).toBe(1);
    now += 1_000;
    expect(await limiter.retryAfter("k")).toBe(0);
  });
});
