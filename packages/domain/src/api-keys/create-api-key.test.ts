import { describe, it, expect } from "vitest";
import { createApiKey, type CreateApiKeyCommand } from "./create-api-key.js";
import { InvalidApiKeyError } from "./errors.js";
import type { ApiKey, ApiKeyRepository } from "./api-key.js";
import type { SecretHasher } from "../users/user.js";

class FakeApiKeyRepository implements ApiKeyRepository {
  readonly rows = new Map<string, ApiKey>();
  async list(): Promise<ApiKey[]> {
    return [...this.rows.values()];
  }
  async findById(id: string): Promise<ApiKey | null> {
    return this.rows.get(id) ?? null;
  }
  async save(key: ApiKey): Promise<void> {
    this.rows.set(key.id, key);
  }
}

function fakeHash(secret: string): string {
  let sum = 0;
  for (const ch of secret) sum = (sum * 31 + ch.codePointAt(0)!) | 0;
  return `h${(sum >>> 0).toString(16)}`;
}

/** One-way-shaped fake — the digest never contains the secret, unlike a trivial `hashed:${secret}` stub would. */
const hasher: SecretHasher = {
  hash: async (secret) => fakeHash(secret),
  verify: async (secret, hash) => hash === fakeHash(secret),
};

function cmd(overrides: Partial<CreateApiKeyCommand> = {}): CreateApiKeyCommand {
  return {
    id: "key-1",
    name: "تكامل المحاسبة",
    scopes: ["sales.invoice.view"],
    rawKey: "mzk_live_abc123",
    prefix: "mzk_live_a",
    createdBy: "u1",
    createdAt: "2026-08-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("createApiKey — happy path", () => {
  it("stores only the hash, never the raw key, and exposes name/prefix/scopes", async () => {
    const repo = new FakeApiKeyRepository();
    const key = await createApiKey(cmd(), repo, hasher);
    expect(key.keyHash).toBe(fakeHash("mzk_live_abc123"));
    expect(JSON.stringify(key)).not.toContain("mzk_live_abc123");
    expect(key.prefix).toBe("mzk_live_a");
    expect(key.scopes).toEqual(["sales.invoice.view"]);
    expect(key.lastUsedAt).toBeNull();
    expect(key.revokedAt).toBeNull();
    expect((await repo.findById("key-1"))?.keyHash).toBe(fakeHash("mzk_live_abc123"));
  });

  it("deduplicates repeated scopes", async () => {
    const repo = new FakeApiKeyRepository();
    const key = await createApiKey(cmd({ scopes: ["sales.invoice.view", "sales.invoice.view"] }), repo, hasher);
    expect(key.scopes).toEqual(["sales.invoice.view"]);
  });

  it("accepts multiple distinct known permission scopes — grants no more than exactly those", async () => {
    const repo = new FakeApiKeyRepository();
    const key = await createApiKey(cmd({ scopes: ["sales.invoice.view", "sales.invoice.create"] }), repo, hasher);
    expect(key.scopes.sort()).toEqual(["sales.invoice.create", "sales.invoice.view"].sort());
    expect(key.scopes).not.toContain("*");
  });
});

describe("createApiKey — validation refusals", () => {
  it("refuses a blank name", async () => {
    const repo = new FakeApiKeyRepository();
    await expect(createApiKey(cmd({ name: " " }), repo, hasher)).rejects.toBeInstanceOf(InvalidApiKeyError);
  });

  it("refuses an empty scope list", async () => {
    const repo = new FakeApiKeyRepository();
    await expect(createApiKey(cmd({ scopes: [] }), repo, hasher)).rejects.toBeInstanceOf(InvalidApiKeyError);
  });

  it("refuses an unknown permission scope", async () => {
    const repo = new FakeApiKeyRepository();
    await expect(createApiKey(cmd({ scopes: ["not.a.real.permission"] }), repo, hasher)).rejects.toBeInstanceOf(
      InvalidApiKeyError,
    );
  });

  it("refuses the wildcard '*' scope — a key can never grant everything a role can", async () => {
    const repo = new FakeApiKeyRepository();
    await expect(createApiKey(cmd({ scopes: ["*"] }), repo, hasher)).rejects.toBeInstanceOf(InvalidApiKeyError);
  });

  it("refuses a blank rawKey", async () => {
    const repo = new FakeApiKeyRepository();
    await expect(createApiKey(cmd({ rawKey: " " }), repo, hasher)).rejects.toBeInstanceOf(InvalidApiKeyError);
  });

  it("refuses a blank prefix", async () => {
    const repo = new FakeApiKeyRepository();
    await expect(createApiKey(cmd({ prefix: " " }), repo, hasher)).rejects.toBeInstanceOf(InvalidApiKeyError);
  });

  it("does not persist or hash anything when validation fails", async () => {
    const repo = new FakeApiKeyRepository();
    let hashCalls = 0;
    const countingHasher: SecretHasher = { hash: async (s) => { hashCalls += 1; return `h:${s}`; }, verify: async () => false };
    await expect(createApiKey(cmd({ name: "" }), repo, countingHasher)).rejects.toThrow();
    expect(hashCalls).toBe(0);
    expect(await repo.findById("key-1")).toBeNull();
  });

  it("collects every reason, not just the first", async () => {
    const repo = new FakeApiKeyRepository();
    try {
      await createApiKey(cmd({ name: "", scopes: [], rawKey: "", prefix: "" }), repo, hasher);
      throw new Error("expected createApiKey to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidApiKeyError);
      expect((e as InvalidApiKeyError).reasons.length).toBeGreaterThanOrEqual(4);
    }
  });
});
