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
  it("is still there, with its failures and its unlock code, after the process that wrote it is gone", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-account-lock-"));
    dirs.push(dir);
    const file = path.join(dir, "tenant.db");

    const first = new Database(file);
    createSqliteAccountLockStore(first).put("owner@shop.test", {
      failures: [1, 2, 3], lockedAt: 3, unlockHash: "abc", unlockExpiresAt: 99, unlockAttempts: 2,
    });
    first.close();

    const second = new Database(file);
    const store = createSqliteAccountLockStore(second);
    expect(store.get("owner@shop.test")).toEqual({ failures: [1, 2, 3], lockedAt: 3, unlockHash: "abc", unlockExpiresAt: 99, unlockAttempts: 2 });
    expect(store.lockedAccounts()).toEqual(["owner@shop.test"]);
    store.delete("owner@shop.test");
    expect(store.get("owner@shop.test")).toBeNull();
    second.close();
  });

  it("replaces an account's row rather than adding a second, and reads a row it cannot parse as no failures", () => {
    const db = new Database(":memory:");
    const store = createSqliteAccountLockStore(db);
    store.put("a@shop.test", { failures: [1], lockedAt: null, unlockHash: null, unlockExpiresAt: null, unlockAttempts: 0 });
    store.put("a@shop.test", { failures: [1, 2], lockedAt: null, unlockHash: null, unlockExpiresAt: null, unlockAttempts: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sign_in_account_lock").get()).toEqual({ n: 1 });
    expect(store.get("a@shop.test")?.failures).toEqual([1, 2]);

    db.prepare("UPDATE sign_in_account_lock SET failures = 'not json'").run();
    expect(store.get("a@shop.test")?.failures).toEqual([]);
    db.close();
  });
});
