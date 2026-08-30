import { describe, it, expect } from "vitest";
import {
  InvalidNotificationRuleError,
  NotificationRuleNotFoundError,
  NotificationNotFoundError,
} from "./errors.js";

describe("InvalidNotificationRuleError", () => {
  it("joins every reason into the message and keeps them on .reasons", () => {
    const err = new InvalidNotificationRuleError(["name is required", "eventCode is required"]);
    expect(err.code).toBe("INVALID_NOTIFICATION_RULE");
    expect(err.name).toBe("InvalidNotificationRuleError");
    expect(err.reasons).toEqual(["name is required", "eventCode is required"]);
    expect(err.message).toBe("Invalid notification rule: name is required; eventCode is required");
  });
});

describe("NotificationRuleNotFoundError", () => {
  it("carries the id in a quoted message", () => {
    const err = new NotificationRuleNotFoundError("rule-1");
    expect(err.code).toBe("NOTIFICATION_RULE_NOT_FOUND");
    expect(err.id).toBe("rule-1");
    expect(err.message).toBe('Notification rule "rule-1" not found.');
  });
});

describe("NotificationNotFoundError", () => {
  it("carries the id in a quoted message", () => {
    const err = new NotificationNotFoundError("n-1");
    expect(err.code).toBe("NOTIFICATION_NOT_FOUND");
    expect(err.id).toBe("n-1");
    expect(err.message).toBe('Notification "n-1" not found.');
  });
});
