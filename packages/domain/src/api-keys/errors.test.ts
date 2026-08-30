import { describe, it, expect } from "vitest";
import { InvalidApiKeyError, ApiKeyNotFoundError, ApiKeyAlreadyRevokedError } from "./errors.js";

describe("InvalidApiKeyError", () => {
  it("joins reasons into the message", () => {
    const err = new InvalidApiKeyError(["name is required", "at least one scope is required"]);
    expect(err.code).toBe("INVALID_API_KEY");
    expect(err.reasons).toEqual(["name is required", "at least one scope is required"]);
    expect(err.message).toBe("name is required; at least one scope is required");
  });
});

describe("ApiKeyNotFoundError", () => {
  it("carries the id in an Arabic message", () => {
    const err = new ApiKeyNotFoundError("key-1");
    expect(err.code).toBe("API_KEY_NOT_FOUND");
    expect(err.id).toBe("key-1");
    expect(err.message).toBe('مفتاح API "key-1" غير موجود');
  });
});

describe("ApiKeyAlreadyRevokedError", () => {
  it("carries the id in an Arabic message", () => {
    const err = new ApiKeyAlreadyRevokedError("key-1");
    expect(err.code).toBe("API_KEY_ALREADY_REVOKED");
    expect(err.id).toBe("key-1");
    expect(err.message).toBe('مفتاح API "key-1" ملغى بالفعل');
  });
});
