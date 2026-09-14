import { describe, it, expect, vi } from "vitest";
import {
  createPlatformUser, verifyPlatformLogin, deactivatePlatformUser,
  type PlatformUser, type PlatformUserRepository,
} from "./platform-user.js";
import { InvalidPlatformUserError, PlatformUserEmailTakenError, PlatformUserNotFoundError } from "./errors.js";
import type { SecretHasher } from "../users/user.js";

const hasher: SecretHasher = {
  async hash(secret) { return `hashed:${secret}`; },
  async verify(secret, hash) { return hash === `hashed:${secret}`; },
};

function memoryRepo(): PlatformUserRepository & { rows: Map<string, PlatformUser> } {
  const rows = new Map<string, PlatformUser>();
  return {
    rows,
    async findById(id) { return rows.get(id) ?? null; },
    async findByEmail(email) { return [...rows.values()].find((u) => u.email === email) ?? null; },
    async list() { return [...rows.values()]; },
    async save(u) { rows.set(u.id, u); },
  };
}

const NOW = "2026-09-13T10:00:00.000Z";
const cmd = { id: "U1", email: " Root@Mezan.APP ", password: "correct horse", role: "owner" as const, now: NOW };

describe("createPlatformUser", () => {
  it("normalises the email, hashes the password, starts active", async () => {
    const repo = memoryRepo();
    const u = await createPlatformUser(cmd, repo, hasher);
    expect(u).toEqual({ id: "U1", email: "root@mezan.app", passwordHash: "hashed:correct horse", role: "owner", status: "active", createdAt: NOW });
    expect(repo.rows.get("U1")).toEqual(u);
  });

  it("refuses an empty email, a short password and a duplicate email", async () => {
    await expect(createPlatformUser({ ...cmd, email: " " }, memoryRepo(), hasher)).rejects.toThrow(InvalidPlatformUserError);
    await expect(createPlatformUser({ ...cmd, password: "short" }, memoryRepo(), hasher)).rejects.toThrow(InvalidPlatformUserError);
    const repo = memoryRepo();
    await createPlatformUser(cmd, repo, hasher);
    await expect(createPlatformUser({ ...cmd, id: "U2", email: "ROOT@mezan.app" }, repo, hasher)).rejects.toThrow(PlatformUserEmailTakenError);
  });

  it("rejects an 11-character password and accepts a 12-character one", async () => {
    await expect(createPlatformUser({ ...cmd, password: "a".repeat(11) }, memoryRepo(), hasher)).rejects.toThrow(InvalidPlatformUserError);
    const u = await createPlatformUser({ ...cmd, password: "a".repeat(12) }, memoryRepo(), hasher);
    expect(u.passwordHash).toBe(`hashed:${"a".repeat(12)}`);
  });

  it("refuses an empty id", async () => {
    await expect(createPlatformUser({ ...cmd, id: " " }, memoryRepo(), hasher))
      .rejects.toMatchObject({ reasons: expect.arrayContaining(["id is required"]) });
  });

  it("refuses a clock that is not an ISO-8601 timestamp", async () => {
    await expect(createPlatformUser({ ...cmd, now: "garbage" }, memoryRepo(), hasher))
      .rejects.toMatchObject({ reasons: expect.arrayContaining(["now must be an ISO-8601 timestamp"]) });
  });
});

describe("verifyPlatformLogin", () => {
  it("returns the user when active and the password verifies", async () => {
    const repo = memoryRepo();
    const u = await createPlatformUser(cmd, repo, hasher);
    const found = await verifyPlatformLogin({ email: " Root@Mezan.APP ", password: "correct horse" }, repo, hasher);
    expect(found).toEqual(u);
  });

  it("returns null for a wrong password", async () => {
    const repo = memoryRepo();
    await createPlatformUser(cmd, repo, hasher);
    const found = await verifyPlatformLogin({ email: cmd.email, password: "wrong password" }, repo, hasher);
    expect(found).toBeNull();
  });

  it("returns null for an inactive user, even with the right password", async () => {
    const repo = memoryRepo();
    const u = await createPlatformUser(cmd, repo, hasher);
    await repo.save({ ...u, status: "inactive" });
    const found = await verifyPlatformLogin({ email: cmd.email, password: "correct horse" }, repo, hasher);
    expect(found).toBeNull();
  });

  it("memoises the decoy hash: two unknown-email attempts hash the decoy at most once and verify once each", async () => {
    // A hasher private to this test, so the memoised decoy from any other test never leaks in.
    const localHasher: SecretHasher = {
      async hash(secret) { return `hashed:${secret}`; },
      async verify(secret, hash) { return hash === `hashed:${secret}`; },
    };
    const repo = memoryRepo();
    const hash = vi.spyOn(localHasher, "hash");
    const verify = vi.spyOn(localHasher, "verify");

    await verifyPlatformLogin({ email: "nobody@mezan.app", password: "whatever12345" }, repo, localHasher);
    await verifyPlatformLogin({ email: "nobody@mezan.app", password: "whatever12345" }, repo, localHasher);

    expect(hash.mock.calls.length).toBeLessThanOrEqual(1);
    expect(verify).toHaveBeenCalledTimes(2);
  });
});

describe("deactivatePlatformUser", () => {
  it("deactivates a support user", async () => {
    const repo = memoryRepo();
    const owner = await createPlatformUser(cmd, repo, hasher);
    const support = await createPlatformUser({ ...cmd, id: "U2", email: "support@mezan.app", role: "support" }, repo, hasher);
    const result = await deactivatePlatformUser({ id: support.id, actorId: owner.id }, repo);
    expect(result.status).toBe("inactive");
    expect(repo.rows.get("U2")?.status).toBe("inactive");
  });

  it("refuses deactivating yourself", async () => {
    const repo = memoryRepo();
    const owner = await createPlatformUser(cmd, repo, hasher);
    await expect(deactivatePlatformUser({ id: owner.id, actorId: owner.id }, repo))
      .rejects.toMatchObject({ reasons: expect.arrayContaining(["لا يمكنك تعطيل حسابك"]) });
  });

  it("refuses deactivating the last active owner", async () => {
    const repo = memoryRepo();
    const owner = await createPlatformUser(cmd, repo, hasher);
    const support = await createPlatformUser({ ...cmd, id: "U2", email: "support@mezan.app", role: "support" }, repo, hasher);
    await expect(deactivatePlatformUser({ id: owner.id, actorId: support.id }, repo))
      .rejects.toMatchObject({ reasons: expect.arrayContaining(["لا يمكن تعطيل آخر مالك للمنصة"]) });
  });

  it("allows deactivating an owner when another active owner remains", async () => {
    const repo = memoryRepo();
    const owner1 = await createPlatformUser(cmd, repo, hasher);
    const owner2 = await createPlatformUser({ ...cmd, id: "U2", email: "owner2@mezan.app" }, repo, hasher);
    const result = await deactivatePlatformUser({ id: owner1.id, actorId: owner2.id }, repo);
    expect(result.status).toBe("inactive");
  });

  it("refuses an unknown id", async () => {
    const repo = memoryRepo();
    const owner = await createPlatformUser(cmd, repo, hasher);
    await expect(deactivatePlatformUser({ id: "NOPE", actorId: owner.id }, repo))
      .rejects.toThrow(PlatformUserNotFoundError);
  });
});
