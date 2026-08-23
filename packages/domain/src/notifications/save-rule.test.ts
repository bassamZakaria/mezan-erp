import { describe, expect, it } from "vitest";
import {
  deleteNotificationRule,
  saveNotificationRule,
  setNotificationRuleActive,
  updateNotificationRule,
} from "./save-rule.js";
import { InvalidNotificationRuleError, NotificationRuleNotFoundError } from "./errors.js";
import type { NotificationRule, NotificationRuleListFilter, NotificationRuleRepository } from "./types.js";

class FakeNotificationRuleRepository implements NotificationRuleRepository {
  private readonly rows = new Map<string, NotificationRule>();

  async save(rule: NotificationRule): Promise<void> {
    this.rows.set(rule.id, rule);
  }
  async update(rule: NotificationRule): Promise<void> {
    this.rows.set(rule.id, rule);
  }
  async findById(id: string): Promise<NotificationRule | null> {
    return this.rows.get(id) ?? null;
  }
  async list(filter: NotificationRuleListFilter = {}): Promise<readonly NotificationRule[]> {
    return [...this.rows.values()].filter((r) => {
      if (filter.active !== undefined && r.active !== filter.active) return false;
      if (filter.eventCode !== undefined && r.eventCode !== filter.eventCode) return false;
      return true;
    });
  }
  async listActiveByEventCode(eventCode: string): Promise<readonly NotificationRule[]> {
    return [...this.rows.values()].filter((r) => r.active && r.eventCode === eventCode);
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

function baseCommand(overrides: Partial<Parameters<typeof saveNotificationRule>[0]> = {}) {
  return {
    id: "rule-1",
    name: "فاتورة مبيعات جديدة",
    eventCode: "SALES_INVOICE_CONFIRMED",
    condition: null,
    recipientType: "permission" as const,
    recipientValue: "sales.invoice.view",
    priority: "normal" as const,
    channels: ["in_app" as const],
    titleAr: null,
    bodyAr: null,
    active: true,
    ...overrides,
  };
}

describe("saveNotificationRule", () => {
  it("creates a valid rule", async () => {
    const repo = new FakeNotificationRuleRepository();
    const rule = await saveNotificationRule(baseCommand(), repo, () => "2026-08-23T00:00:00.000Z");
    expect(rule.id).toBe("rule-1");
    expect(rule.eventCode).toBe("SALES_INVOICE_CONFIRMED");
    expect(rule.createdAt).toBe("2026-08-23T00:00:00.000Z");
    expect(await repo.findById("rule-1")).toEqual(rule);
  });

  it("rejects an unknown event code", async () => {
    const repo = new FakeNotificationRuleRepository();
    await expect(saveNotificationRule(baseCommand({ eventCode: "NOT_A_REAL_EVENT" }), repo)).rejects.toBeInstanceOf(
      InvalidNotificationRuleError,
    );
  });

  it("rejects an empty channel list", async () => {
    const repo = new FakeNotificationRuleRepository();
    await expect(saveNotificationRule(baseCommand({ channels: [] }), repo)).rejects.toBeInstanceOf(InvalidNotificationRuleError);
  });

  it("rejects a condition missing its operator/value", async () => {
    const repo = new FakeNotificationRuleRepository();
    await expect(
      saveNotificationRule(
        baseCommand({ condition: { field: "amount", operator: "gt" as never, value: "" } }),
        repo,
      ),
    ).rejects.toBeInstanceOf(InvalidNotificationRuleError);
  });

  it("trims blank title/body overrides to null", async () => {
    const repo = new FakeNotificationRuleRepository();
    const rule = await saveNotificationRule(baseCommand({ titleAr: "   ", bodyAr: "  " }), repo);
    expect(rule.titleAr).toBeNull();
    expect(rule.bodyAr).toBeNull();
  });
});

describe("updateNotificationRule", () => {
  it("updates fields while preserving createdAt", async () => {
    const repo = new FakeNotificationRuleRepository();
    await saveNotificationRule(baseCommand(), repo, () => "2026-08-01T00:00:00.000Z");
    const updated = await updateNotificationRule(
      "rule-1",
      { ...baseCommand(), name: "اسم جديد" },
      repo,
      () => "2026-08-23T00:00:00.000Z",
    );
    expect(updated.name).toBe("اسم جديد");
    expect(updated.createdAt).toBe("2026-08-01T00:00:00.000Z");
    expect(updated.updatedAt).toBe("2026-08-23T00:00:00.000Z");
  });

  it("throws NotificationRuleNotFoundError for an unknown id", async () => {
    const repo = new FakeNotificationRuleRepository();
    await expect(updateNotificationRule("missing", baseCommand(), repo)).rejects.toBeInstanceOf(NotificationRuleNotFoundError);
  });
});

describe("deleteNotificationRule / setNotificationRuleActive", () => {
  it("deletes an existing rule", async () => {
    const repo = new FakeNotificationRuleRepository();
    await saveNotificationRule(baseCommand(), repo);
    await deleteNotificationRule("rule-1", repo);
    expect(await repo.findById("rule-1")).toBeNull();
  });

  it("throws deleting an unknown rule", async () => {
    const repo = new FakeNotificationRuleRepository();
    await expect(deleteNotificationRule("missing", repo)).rejects.toBeInstanceOf(NotificationRuleNotFoundError);
  });

  it("toggles active without touching other fields", async () => {
    const repo = new FakeNotificationRuleRepository();
    await saveNotificationRule(baseCommand(), repo);
    const disabled = await setNotificationRuleActive("rule-1", false, repo);
    expect(disabled.active).toBe(false);
    expect(disabled.name).toBe("فاتورة مبيعات جديدة");
  });
});
