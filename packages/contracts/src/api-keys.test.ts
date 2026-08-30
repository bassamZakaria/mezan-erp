import { describe, it, expect } from "vitest";
import { apiKeySchema, createApiKeySchema, createApiKeyResultSchema } from "./api-keys.js";

describe("apiKeySchema", () => {
  const key = {
    id: "key-1",
    name: "POS integration",
    prefix: "mzn_live_",
    scopes: ["sales:write", "inventory:read"],
    createdBy: "user-1",
    createdAt: "2026-08-30T10:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
  };

  it("accepts a minimal valid key and preserves every field verbatim", () => {
    const result = apiKeySchema.safeParse(key);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(key);
  });

  it("rejects a key missing name", () => {
    const { name, ...rest } = key;
    const result = apiKeySchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("name");
  });

  it("rejects a key missing scopes", () => {
    const { scopes, ...rest } = key;
    const result = apiKeySchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("scopes");
  });

  it("never carries the plaintext key or its hash — only the metadata schema is exposed for listing", () => {
    expect(key).not.toHaveProperty("key");
    expect(key).not.toHaveProperty("hash");
  });

  it("rejects a key missing revokedAt entirely — the field is required, if nullable", () => {
    const { revokedAt, ...rest } = key;
    const result = apiKeySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("silently strips an unrecognised key", () => {
    const result = apiKeySchema.safeParse({ ...key, unknownField: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("unknownField");
  });
});

describe("createApiKeySchema", () => {
  const create = { name: "POS integration", scopes: ["sales:write"] };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = createApiKeySchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing name", () => {
    const { name, ...rest } = create;
    const result = createApiKeySchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("name");
  });

  it("rejects an empty scopes array — at least one scope is required", () => {
    const result = createApiKeySchema.safeParse({ ...create, scopes: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("scopes");
  });

  it("silently strips an unrecognised id — the server assigns identity, not the caller", () => {
    const result = createApiKeySchema.safeParse({ ...create, id: "key-caller-supplied" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("id");
  });
});

describe("createApiKeyResultSchema", () => {
  const result = {
    id: "key-1",
    name: "POS integration",
    prefix: "mzn_live_",
    scopes: ["sales:write"],
    createdBy: "user-1",
    createdAt: "2026-08-30T10:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    key: "mzn_live_abc123secret",
  };

  it("accepts a minimal valid result and preserves every field, including the one-time plaintext key", () => {
    const parsed = createApiKeyResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(result);
  });

  it("rejects a result missing key", () => {
    const { key, ...rest } = result;
    const parsed = createApiKeyResultSchema.safeParse(rest);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors).toHaveProperty("key");
  });
});
