import { describe, it, expect } from "vitest";
import { InvalidWebhookError, WebhookNotFoundError } from "./errors.js";

describe("InvalidWebhookError", () => {
  it("joins reasons into the message", () => {
    const err = new InvalidWebhookError(["name is required", "secret is required"]);
    expect(err.code).toBe("INVALID_WEBHOOK");
    expect(err.name).toBe("InvalidWebhookError");
    expect(err.reasons).toEqual(["name is required", "secret is required"]);
    expect(err.message).toBe("name is required; secret is required");
  });
});

describe("WebhookNotFoundError", () => {
  it("carries the id in an Arabic message", () => {
    const err = new WebhookNotFoundError("wh-1");
    expect(err.code).toBe("WEBHOOK_NOT_FOUND");
    expect(err.id).toBe("wh-1");
    expect(err.message).toBe('الويب هوك "wh-1" غير موجود');
  });
});
