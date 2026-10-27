import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteAccountLockStore } from "./account-lock-store.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the account lock in the tenant's own database", () => {
  it("is still there, with its failures and its unlock code, after the process that wrote it is gone", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-account-lock-"));
    dirs.push(dir);
    const file = path.join(dir, "tenant.db");

    const first = new Database(file);
    await createSqliteAccountLockStore(first).put("owner@shop.test", {
      failures: [1, 2, 3], lockedAt: 3, unlockHash: "abc", unlockExpiresAt: 99, unlockAttempts: 2,
    });
    first.close();

    const second = new Database(file);
    const store = createSqliteAccountLockStore(second);
    expect(await store.get("owner@shop.test")).toEqual({ failures: [1, 2, 3], lockedAt: 3, unlockHash: "abc", unlockExpiresAt: 99, unlockAttempts: 2, unlockLinkHash: null });
    expect(await store.lockedAccounts()).toEqual(["owner@shop.test"]);
    await store.delete("owner@shop.test");
    expect(await store.get("owner@shop.test")).toBeNull();
    second.close();
  });

  it("replaces an account's row rather than adding a second, and reads a row it cannot parse as no failures", async () => {
    const db = new Database(":memory:");
    const store = createSqliteAccountLockStore(db);
    await store.put("a@shop.test", { failures: [1], lockedAt: null, unlockHash: null, unlockExpiresAt: null, unlockAttempts: 0 });
    await store.put("a@shop.test", { failures: [1, 2], lockedAt: null, unlockHash: null, unlockExpiresAt: null, unlockAttempts: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sign_in_account_lock").get()).toEqual({ n: 1 });
    expect((await store.get("a@shop.test"))?.failures).toEqual([1, 2]);

    db.prepare("UPDATE sign_in_account_lock SET failures = 'not json'").run();
    expect((await store.get("a@shop.test"))?.failures).toEqual([]);
    db.close();
  });

  it("finds the one account a link's hash was stored for, and none once the row is gone", async () => {
    const db = new Database(":memory:");
    const store = createSqliteAccountLockStore(db);
    await store.put("a@shop.test", { failures: [1], lockedAt: 1, unlockHash: null, unlockExpiresAt: 99, unlockAttempts: 0, unlockLinkHash: "hash-a" });
    await store.put("b@shop.test", { failures: [1], lockedAt: 1, unlockHash: null, unlockExpiresAt: 99, unlockAttempts: 0, unlockLinkHash: "hash-b" });

    expect(await store.accountOfLink("hash-b")).toBe("b@shop.test");
    expect(await store.accountOfLink("hash-c")).toBeNull();
    expect((await store.get("b@shop.test"))?.unlockLinkHash).toBe("hash-b");
    await store.delete("b@shop.test");
    expect(await store.accountOfLink("hash-b")).toBeNull();
    db.close();
  });

  it("opens a tenant file whose lock table was created before the link column existed, keeping its lock", async () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE sign_in_account_lock (
      account TEXT PRIMARY KEY, failures TEXT NOT NULL, locked_at INTEGER, unlock_hash TEXT, unlock_expires_at INTEGER, unlock_attempts INTEGER NOT NULL DEFAULT 0
    )`);
    db.prepare("INSERT INTO sign_in_account_lock (account, failures, locked_at) VALUES ('old@shop.test', '[5]', 5)").run();

    const store = createSqliteAccountLockStore(db);

    expect(await store.get("old@shop.test")).toMatchObject({ failures: [5], lockedAt: 5, unlockLinkHash: null });
    await store.put("old@shop.test", { failures: [5], lockedAt: 5, unlockHash: null, unlockExpiresAt: 9, unlockAttempts: 0, unlockLinkHash: "h" });
    expect(await store.accountOfLink("h")).toBe("old@shop.test");
    db.close();
  });
});

describe("the lock on a name nobody holds", () => {
  const LOCKED = { failures: [1], lockedAt: 1, unlockHash: null, unlockExpiresAt: null, unlockAttempts: 0 };
  const DAY = 24 * 60 * 60_000;

  it("is still there after a restart, under a key that is not the name, and is never listed as a locked account", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-account-lock-"));
    dirs.push(dir);
    const file = path.join(dir, "tenant.db");
    const first = new Database(file);
    await createSqliteAccountLockStore(first).unknownNames.put("ghost@shop.test", LOCKED);
    first.close();

    const second = new Database(file);
    const store = createSqliteAccountLockStore(second);

    expect(await store.unknownNames.get("ghost@shop.test")).toMatchObject({ lockedAt: 1 });
    expect(await store.get("ghost@shop.test")).toBeNull();
    expect(await store.lockedAccounts()).toEqual([]);
    const stored = (second.prepare("SELECT account FROM sign_in_account_lock").all() as { account: string }[]).map((row) => row.account);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^unknown:[0-9a-f]{64}$/);
    expect(JSON.stringify(second.prepare("SELECT * FROM sign_in_account_lock").all())).not.toContain("ghost");
    second.close();
  });

  it("drops rows whose failures have all left the window, of either kind, and keeps every lock", async () => {
    const db = new Database(":memory:");
    let now = 10 * DAY;
    const store = createSqliteAccountLockStore(db, { now: () => now });
    const stale = { ...LOCKED, lockedAt: null, failures: [now - DAY - 1] };
    const recent = { ...LOCKED, lockedAt: null, failures: [now - 1] };
    await store.unknownNames.put("stale-ghost@shop.test", stale);
    await store.put("stale-real@shop.test", stale);
    await store.unknownNames.put("locked-ghost@shop.test", { ...LOCKED, lockedAt: now - 5 * DAY, failures: [now - 5 * DAY] });
    await store.put("locked-real@shop.test", { ...LOCKED, lockedAt: now - 5 * DAY, failures: [now - 5 * DAY] });

    now += 1;
    await store.unknownNames.put("recent-ghost@shop.test", recent);

    expect(await store.unknownNames.get("stale-ghost@shop.test")).toBeNull();
    expect(await store.get("stale-real@shop.test")).toBeNull();
    expect(await store.unknownNames.get("recent-ghost@shop.test")).not.toBeNull();
    expect(await store.unknownNames.get("locked-ghost@shop.test")).not.toBeNull();
    expect(await store.lockedAccounts()).toEqual(["locked-real@shop.test"]);
    db.close();
  });

  it("holds at most the stated number of unknown names, dropping the oldest, and never a real account for them", async () => {
    const db = new Database(":memory:");
    let now = 1_000;
    const store = createSqliteAccountLockStore(db, { now: () => now, maxUnknownNames: 3 });
    await store.put("owner@shop.test", { ...LOCKED, lockedAt: now, failures: [now] });
    for (let i = 0; i < 5; i += 1) {
      now += 1;
      await store.unknownNames.put(`ghost${i}@shop.test`, { ...LOCKED, lockedAt: now, failures: [now] });
    }

    expect(await Promise.all([0, 1, 2, 3, 4].map(async (i) => (await store.unknownNames.get(`ghost${i}@shop.test`)) !== null))).toEqual([false, false, true, true, true]);
    expect(await store.lockedAccounts()).toEqual(["owner@shop.test"]);
    db.close();
  });
});
