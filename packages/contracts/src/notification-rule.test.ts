import { describe, it, expect } from "vitest";
import {
  notificationPrioritySchema,
  notificationChannelSchema,
  conditionOperatorSchema,
  notificationRecipientTypeSchema,
  notificationConditionSchema,
  notificationRuleSchema,
  createNotificationRuleSchema,
  updateNotificationRuleSchema,
  notificationTriggerSchema,
  notificationTriggerCatalogSchema,
} from "./notification-rule.js";

describe("notificationPrioritySchema", () => {
  it("accepts each known priority", () => {
    for (const p of ["low", "normal", "high", "urgent"]) {
      expect(notificationPrioritySchema.safeParse(p).success).toBe(true);
    }
  });

  it("rejects a priority outside the enum", () => {
    expect(notificationPrioritySchema.safeParse("critical").success).toBe(false);
  });
});

describe("notificationConditionSchema", () => {
  const condition = { field: "amount", operator: "gt" as const, value: "1000" };

  it("accepts a minimal valid condition and preserves every field verbatim", () => {
    const result = notificationConditionSchema.safeParse(condition);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(condition);
  });

  it("rejects an out-of-enum operator", () => {
    const result = notificationConditionSchema.safeParse({ ...condition, operator: "like" });
    expect(result.success).toBe(false);
  });

  it("rejects a condition missing value", () => {
    const { value, ...rest } = condition;
    const result = notificationConditionSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("value");
  });
});

describe("notificationRuleSchema", () => {
  const rule = {
    id: "rule-1",
    name: "Large invoice alert",
    eventCode: "sales-invoice.posted",
    condition: null,
    recipientType: "role" as const,
    recipientValue: "finance-manager",
    priority: "high" as const,
    channels: ["in_app" as const],
    titleAr: null,
    bodyAr: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a minimal valid rule and preserves every field verbatim", () => {
    const result = notificationRuleSchema.safeParse(rule);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(rule);
  });

  it("accepts any eventCode string — the closed catalog lives in @mezan/domain, not the wire schema", () => {
    const result = notificationRuleSchema.safeParse({ ...rule, eventCode: "some-future-event.happened" });
    expect(result.success).toBe(true);
  });

  it("rejects a rule with zero channels", () => {
    const result = notificationRuleSchema.safeParse({ ...rule, channels: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("channels");
  });

  it("rejects an out-of-enum recipientType", () => {
    const result = notificationRuleSchema.safeParse({ ...rule, recipientType: "team" });
    expect(result.success).toBe(false);
  });
});

describe("createNotificationRuleSchema", () => {
  const create = {
    name: "Large invoice alert",
    eventCode: "sales-invoice.posted",
    recipientType: "role" as const,
    recipientValue: "finance-manager",
    channels: ["in_app" as const],
  };

  it("accepts a minimal valid payload and defaults priority and active", () => {
    const result = createNotificationRuleSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe("normal");
      expect(result.data.active).toBe(true);
    }
  });

  it("preserves an explicit priority override", () => {
    const result = createNotificationRuleSchema.safeParse({ ...create, priority: "urgent" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priority).toBe("urgent");
  });

  it("rejects a payload missing recipientValue", () => {
    const { recipientValue, ...rest } = create;
    const result = createNotificationRuleSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("recipientValue");
  });

  it("rejects zero channels", () => {
    const result = createNotificationRuleSchema.safeParse({ ...create, channels: [] });
    expect(result.success).toBe(false);
  });
});

describe("updateNotificationRuleSchema", () => {
  it("strips id — id is omitted from the update schema entirely", () => {
    const update = {
      id: "rule-caller-supplied",
      name: "Large invoice alert",
      eventCode: "sales-invoice.posted",
      recipientType: "role" as const,
      recipientValue: "finance-manager",
      channels: ["in_app" as const],
    };
    const result = updateNotificationRuleSchema.safeParse(update);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("id");
  });

  it("rejects a payload missing name — update still requires the full shape minus id", () => {
    const result = updateNotificationRuleSchema.safeParse({
      eventCode: "sales-invoice.posted",
      recipientType: "role",
      recipientValue: "finance-manager",
      channels: ["in_app"],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("name");
  });
});

describe("notificationTriggerSchema", () => {
  const trigger = { code: "sales-invoice.posted", category: "sales", labelAr: "ترحيل فاتورة بيع", emitted: true };

  it("accepts a minimal valid trigger and preserves every field verbatim", () => {
    const result = notificationTriggerSchema.safeParse(trigger);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(trigger);
  });

  it("rejects a trigger missing emitted", () => {
    const { emitted, ...rest } = trigger;
    const result = notificationTriggerSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("emitted");
  });
});

describe("notificationTriggerCatalogSchema", () => {
  const catalog = {
    triggers: [{ code: "sales-invoice.posted", category: "sales", labelAr: "ترحيل فاتورة بيع", emitted: true }],
    implementedChannels: ["in_app" as const],
  };

  it("accepts a minimal valid catalog and preserves every field verbatim", () => {
    const result = notificationTriggerCatalogSchema.safeParse(catalog);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(catalog);
  });

  it("rejects a catalog missing triggers", () => {
    const { triggers, ...rest } = catalog;
    const result = notificationTriggerCatalogSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("triggers");
  });
});
