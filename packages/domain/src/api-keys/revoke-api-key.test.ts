import { describe, it, expect } from "vitest";
import { revokeApiKey } from "./revoke-api-key.js";
import { ApiKeyAlreadyRevokedError, ApiKeyNotFoundError } from "./errors.js";
import type { ApiKey, ApiKeyRepository } from "./api-key.js";

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

function apiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: "key-1",
    name: "تكامل",
    prefix: "mzk_a",
    keyHash: "hashed:x",
    scopes: ["sales.invoice.view"],
    createdBy: "u1",
    createdAt: "2026-08-22T10:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe("revokeApiKey", () => {
  it("stamps revokedAt and persists it", async () => {
    const repo = new FakeApiKeyRepository();
    repo.rows.set("key-1", apiKey());
    const result = await revokeApiKey("key-1", repo, "2026-08-22T12:00:00.000Z");
    expect(result.revokedAt).toBe("2026-08-22T12:00:00.000Z");
    expect((await repo.findById("key-1"))?.revokedAt).toBe("2026-08-22T12:00:00.000Z");
  });

  it("throws ApiKeyNotFoundError for an unknown id", async () => {
    const repo = new FakeApiKeyRepository();
    await expect(revokeApiKey("missing", repo)).rejects.toBeInstanceOf(ApiKeyNotFoundError);
  });

  it("refuses to revoke an already-revoked key — the first revoke timestamp is the record", async () => {
    const repo = new FakeApiKeyRepository();
    repo.rows.set("key-1", apiKey({ revokedAt: "2026-08-01T00:00:00.000Z" }));
    await expect(revokeApiKey("key-1", repo, "2026-08-22T12:00:00.000Z")).rejects.toBeInstanceOf(
      ApiKeyAlreadyRevokedError,
    );
    // the original timestamp is untouched by the refused second attempt
    expect((await repo.findById("key-1"))?.revokedAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("defaults revokedAt to now() when not supplied", async () => {
    const repo = new FakeApiKeyRepository();
    repo.rows.set("key-1", apiKey());
    const result = await revokeApiKey("key-1", repo);
    expect(() => new Date(result.revokedAt!).toISOString()).not.toThrow();
  });

  it("leaves the key's scopes and hash untouched", async () => {
    const repo = new FakeApiKeyRepository();
    repo.rows.set("key-1", apiKey({ scopes: ["sales.invoice.view", "sales.invoice.create"] }));
    const result = await revokeApiKey("key-1", repo, "2026-08-22T12:00:00.000Z");
    expect(result.scopes).toEqual(["sales.invoice.view", "sales.invoice.create"]);
    expect(result.keyHash).toBe("hashed:x");
  });
});
