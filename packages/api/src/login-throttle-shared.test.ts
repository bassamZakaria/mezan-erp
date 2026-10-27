import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteAttemptStore, SignInAttemptScope } from "@mezan/persistence";
import { createLoginThrottle, createSourceThrottle, throttleKey } from "./login-throttle.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tenantFile() {
  const dir = mkdtempSync(join(tmpdir(), "mezan-throttle-"));
  dirs.push(dir);
  return join(dir, "tenant.db");
}

function instances(count: number) {
  const file = tenantFile();
  let now = 5_000_000;
  const clock = () => now;
  return {
    servers: Array.from({ length: count }, () => {
      return createLoginThrottle(clock, createSqliteAttemptStore(file, SignInAttemptScope.Ladder));
    }),
    advance: (ms: number) => void (now += ms),
    file,
  };
}

describe("the sign-in ladder shared by every server instance of one tenant", () => {
  it("counts failures spread across instances on ONE ladder, so the sixth failure locks wherever it lands", async () => {
    const { servers } = instances(3);
    const key = throttleKey("owner@shop.test", "10.0.0.5");
    for (let i = 0; i < 5; i++) expect(await servers[i % 3]!.fail(key)).toBe(0);
    expect(await servers[0]!.fail(key)).toBe(60);
    expect(await servers[1]!.retryAfter(key)).toBe(60);
    expect(await servers[2]!.retryAfter(key)).toBe(60);
  });

  it("an unlock on one instance clears the account on every other, source buckets included", async () => {
    const { servers } = instances(2);
    const key = throttleKey("owner@shop.test", "10.0.0.5");
    for (let i = 0; i < 6; i++) await servers[0]!.fail(key);
    expect(await servers[1]!.retryAfter(key)).toBeGreaterThan(0);
    await servers[1]!.unlock("Owner@Shop.test");
    expect(await servers[0]!.retryAfter(key)).toBe(0);
  });

  it("a success on one instance clears only the key it verified on", async () => {
    const { servers } = instances(2);
    const mine = throttleKey("owner@shop.test", "10.0.0.5");
    const theirs = throttleKey("owner@shop.test", "10.0.0.9");
    for (let i = 0; i < 6; i++) await servers[0]!.fail(theirs);
    await servers[1]!.fail(mine);
    await servers[1]!.succeed(mine);
    expect(await servers[0]!.retryAfter(theirs)).toBeGreaterThan(0);
    expect(await servers[1]!.size()).toBe(1);
  });

  it("the lock is still there after every server restarts", async () => {
    const { servers, file } = instances(1);
    const key = throttleKey("owner@shop.test", "10.0.0.5");
    for (let i = 0; i < 6; i++) await servers[0]!.fail(key);
    const restarted = createLoginThrottle(() => 5_000_000, createSqliteAttemptStore(file, SignInAttemptScope.Ladder));
    expect(await restarted.retryAfter(key)).toBe(60);
  });

  it("expires with the clock: a served lock steps the ladder down one rung on whichever instance asks", async () => {
    const { servers, advance } = instances(2);
    const key = throttleKey("owner@shop.test", "10.0.0.5");
    for (let i = 0; i < 6; i++) await servers[0]!.fail(key);
    advance(61_000);
    expect(await servers[1]!.retryAfter(key)).toBe(0);
    expect(await servers[0]!.fail(key)).toBe(60);
  });

  it("keeps the table bounded however many distinct names an unauthenticated caller sends", async () => {
    const { servers } = instances(1);
    for (let i = 0; i < 10_050; i++) await servers[0]!.fail(`ghost-${i}@nowhere.test`);
    expect(await servers[0]!.size()).toBeLessThanOrEqual(10_000);
  });

  it("the source ladder is shared the same way, and does not collide with the account ladder in one file", async () => {
    const file = tenantFile();
    const a = createSourceThrottle(() => 1, 2, createSqliteAttemptStore(file, SignInAttemptScope.Source));
    const b = createSourceThrottle(() => 1, 2, createSqliteAttemptStore(file, SignInAttemptScope.Source));
    const ladder = createLoginThrottle(() => 1, createSqliteAttemptStore(file, SignInAttemptScope.Ladder));
    await a.fail("10.0.0.5");
    await b.fail("10.0.0.5");
    expect(await b.fail("10.0.0.5")).toBe(60);
    expect(await a.retryAfter("10.0.0.5")).toBe(60);
    expect(await ladder.size()).toBe(0);
  });
});
