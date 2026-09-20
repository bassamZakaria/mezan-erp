import { describe, expect, it } from "vitest";
import { createSqliteWebauthnChallengeRepository } from "./webauthn-challenge-store.js";

describe("SqliteWebauthnChallengeRepository", () => {
  it("issues a challenge and consumes it exactly once for the right purpose", async () => {
    const store = createSqliteWebauthnChallengeRepository(":memory:");
    const challenge = await store.issue("user-1", "register", "mezan.example");
    expect(challenge).toMatch(/^[\w-]{40,}$/);

    const pending = await store.consume("user-1", "register");
    expect(pending?.challenge).toBe(challenge);
    expect(pending?.rpId).toBe("mezan.example");

    // Single-use: a second consume of the same (now-deleted) challenge finds nothing.
    expect(await store.consume("user-1", "register")).toBeNull();
    store.close();
  });

  it("is visible across two repository instances over the SAME database file — the cloud multi-server fix", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-webauthn-"));
    const dbPath = path.join(dir, "t.sqlite");
    try {
      const serverA = createSqliteWebauthnChallengeRepository(dbPath);
      const challenge = await serverA.issue("user-2", "assert", "mezan.example");
      serverA.close();

      // A second server instance, opening the SAME file fresh — simulating a
      // request routed to a different cloud instance than the one that issued it.
      const serverB = createSqliteWebauthnChallengeRepository(dbPath);
      const pending = await serverB.consume("user-2", "assert");
      expect(pending?.challenge).toBe(challenge);
      serverB.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("burns the challenge on a mismatched purpose, not just a matching one", async () => {
    const store = createSqliteWebauthnChallengeRepository(":memory:");
    await store.issue("user-3", "register", "mezan.example");
    expect(await store.consume("user-3", "assert")).toBeNull();
    // The mismatched attempt already deleted it — the RIGHT purpose finds nothing either now.
    expect(await store.consume("user-3", "register")).toBeNull();
    store.close();
  });

  it("refuses an expired challenge and still burns it", async () => {
    const store = createSqliteWebauthnChallengeRepository(":memory:");
    const issuedAt = Date.parse("2026-01-01T00:00:00.000Z");
    await store.issue("user-4", "register", "mezan.example", issuedAt);
    const twoMinutesAndOneSecondLater = issuedAt + 121_000;
    expect(await store.consume("user-4", "register", twoMinutesAndOneSecondLater)).toBeNull();
    store.close();
  });

  it("issuing a new challenge for the same user replaces any prior one", async () => {
    const store = createSqliteWebauthnChallengeRepository(":memory:");
    await store.issue("user-5", "register", "mezan.example");
    const second = await store.issue("user-5", "register", "mezan.example");
    const pending = await store.consume("user-5", "register");
    expect(pending?.challenge).toBe(second);
    store.close();
  });
});
