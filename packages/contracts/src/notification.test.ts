import { describe, it, expect } from "vitest";
import {
  notificationChannelStatusSchema,
  notificationSchema,
  notificationListQuerySchema,
  unreadCountResponseSchema,
} from "./notification.js";

describe("notificationChannelStatusSchema", () => {
  it("accepts each known channel status", () => {
    for (const status of ["delivered", "queued", "sending", "sent", "failed"]) {
      expect(notificationChannelStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(notificationChannelStatusSchema.safeParse("bounced").success).toBe(false);
  });
});

describe("notificationSchema", () => {
  const notification = {
    id: "notif-1",
    ruleId: "rule-1",
    recipientUserId: "user-1",
    eventCode: "sales-invoice.posted",
    title: "فاتورة جديدة",
    body: "تم ترحيل فاتورة رقم 100",
    priority: "normal" as const,
    channels: ["in_app" as const],
    channelStatus: { in_app: "delivered" as const },
    status: "unread" as const,
    payload: { invoiceId: "inv-1" },
    createdAt: "2026-08-30T10:00:00.000Z",
    readAt: null,
  };

  it("accepts a minimal valid notification and preserves every field verbatim", () => {
    const result = notificationSchema.safeParse(notification);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(notification);
  });

  it("accepts a null ruleId for a system-generated notification", () => {
    const result = notificationSchema.safeParse({ ...notification, ruleId: null });
    expect(result.success).toBe(true);
  });

  it("rejects a notification missing recipientUserId", () => {
    const { recipientUserId, ...rest } = notification;
    const result = notificationSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("recipientUserId");
  });

  it("rejects a notification missing channels", () => {
    const { channels, ...rest } = notification;
    const result = notificationSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("channels");
  });

  it("rejects an out-of-enum priority", () => {
    const result = notificationSchema.safeParse({ ...notification, priority: "critical" });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum status", () => {
    const result = notificationSchema.safeParse({ ...notification, status: "archived" });
    expect(result.success).toBe(false);
  });

  it("accepts any payload shape via the open record", () => {
    const result = notificationSchema.safeParse({ ...notification, payload: { count: 3, tags: ["a", "b"] } });
    expect(result.success).toBe(true);
  });

  it("silently strips an unrecognised branchId — a real dimension a caller could lose", () => {
    const result = notificationSchema.safeParse({ ...notification, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });
});

describe("notificationListQuerySchema", () => {
  it("accepts an empty query — both fields are optional", () => {
    const result = notificationListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a valid status and limit", () => {
    const result = notificationListQuerySchema.safeParse({ status: "unread", limit: "50" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(50);
  });

  it("rejects an out-of-enum status", () => {
    const result = notificationListQuerySchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });

  it("rejects a limit above 200", () => {
    const result = notificationListQuerySchema.safeParse({ limit: "201" });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative limit", () => {
    expect(notificationListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(notificationListQuerySchema.safeParse({ limit: "-5" }).success).toBe(false);
  });
});

describe("unreadCountResponseSchema", () => {
  it("accepts a minimal valid response and preserves it verbatim", () => {
    const result = unreadCountResponseSchema.safeParse({ count: 4 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ count: 4 });
  });

  it("rejects a missing count", () => {
    const result = unreadCountResponseSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("count");
  });

  it("rejects a negative count", () => {
    const result = unreadCountResponseSchema.safeParse({ count: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a count sent as a decimal string instead of a number", () => {
    const result = unreadCountResponseSchema.safeParse({ count: "4" });
    expect(result.success).toBe(false);
  });
});
