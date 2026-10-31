import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSqlitePasswordResetTokens } from "./password-reset-tokens.js";

const open: Database.Database[] = [];
afterEach(() => {
  for (const sqlite of open.splice(0)) sqlite.close();
});

function tokens() {
  const sqlite = new Database(":memory:");
  open.push(sqlite);
  return createSqlitePasswordResetTokens(sqlite);
}

const HOUR = 60 * 60 * 1000;

describe("password reset tokens", () => {
  it("keeps an earlier mailed link working after a re-request, and redeeming one voids the rest", async () => {
    const store = tokens();
    const now = Date.now();
    await store.issue("u-1", "first", now + HOUR);
    await store.issue("u-1", "second", now + HOUR);

    expect(await store.redeem("first", now)).toBe("u-1");
    expect(await store.redeem("second", now)).toBeNull();
  });

  it("leaves another user's token alone when one user is issued a new one", async () => {
    const store = tokens();
    const now = Date.now();
    await store.issue("u-1", "one", now + HOUR);
    await store.issue("u-2", "two", now + HOUR);

    expect(await store.redeem("one", now)).toBe("u-1");
  });

  it("redeems a token once", async () => {
    const store = tokens();
    const now = Date.now();
    await store.issue("u-1", "once", now + HOUR);

    expect(await store.redeem("once", now)).toBe("u-1");
    expect(await store.redeem("once", now)).toBeNull();
  });

  it("answers null for an expired token, and spends it all the same", async () => {
    const store = tokens();
    const now = Date.now();
    await store.issue("u-1", "late", now + HOUR);

    expect(await store.redeem("late", now + HOUR + 1)).toBeNull();
    expect(await store.redeem("late", now)).toBeNull();
  });

  it("reports when the user's live token expires, and null once none is live", async () => {
    const store = tokens();
    const now = Date.now();
    expect(await store.latestExpiry("u-1", now)).toBeNull();

    await store.issue("u-1", "live", now + HOUR);
    expect(await store.latestExpiry("u-1", now)).toBe(now + HOUR);
    expect(await store.latestExpiry("u-1", now + HOUR + 1)).toBeNull();
    expect(await store.latestExpiry("u-2", now)).toBeNull();

    await store.forgetUser("u-1");
    expect(await store.latestExpiry("u-1", now)).toBeNull();
  });
});
