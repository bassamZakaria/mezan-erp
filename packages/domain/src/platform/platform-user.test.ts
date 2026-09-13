import { describe, it, expect } from "vitest";
import { createPlatformUser, type PlatformUser, type PlatformUserRepository } from "./platform-user.js";
import { InvalidPlatformUserError, PlatformUserEmailTakenError } from "./errors.js";
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
});
