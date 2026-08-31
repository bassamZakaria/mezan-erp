import { describe, expect, it } from "vitest";
import { saveNotificationRule, setNotificationRuleActive, updateNotificationRule } from "./save-rule.js";
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

describe("saveNotificationRule — remaining refusal branches", () => {
  it("refuses a blank rule name", async () => {
    const repo = new FakeNotificationRuleRepository();
    await expect(saveNotificationRule(baseCommand({ name: "   " }), repo)).rejects.toBeInstanceOf(
      InvalidNotificationRuleError,
    );
  });

  it("refuses an unknown recipient type", async () => {
    const repo = new FakeNotificationRuleRepository();
    await expect(
      saveNotificationRule(baseCommand({ recipientType: "team" as never }), repo),
    ).rejects.toBeInstanceOf(InvalidNotificationRuleError);
  });

  it("refuses a blank recipient value", async () => {
    const repo = new FakeNotificationRuleRepository();
    await expect(saveNotificationRule(baseCommand({ recipientValue: "  " }), repo)).rejects.toBeInstanceOf(
      InvalidNotificationRuleError,
    );
  });

  it("refuses an unknown priority", async () => {
    const repo = new FakeNotificationRuleRepository();
    await expect(
      saveNotificationRule(baseCommand({ priority: "critical" as never }), repo),
    ).rejects.toBeInstanceOf(InvalidNotificationRuleError);
  });

  it("refuses an unknown delivery channel", async () => {
    const repo = new FakeNotificationRuleRepository();
    await expect(
      saveNotificationRule(baseCommand({ channels: ["fax" as never] }), repo),
    ).rejects.toBeInstanceOf(InvalidNotificationRuleError);
  });

  it("refuses a condition with a blank field", async () => {
    const repo = new FakeNotificationRuleRepository();
    await expect(
      saveNotificationRule(
        baseCommand({ condition: { field: "  ", operator: "eq", value: "1" } }),
        repo,
      ),
    ).rejects.toBeInstanceOf(InvalidNotificationRuleError);
  });

  it("refuses a condition with an unknown operator", async () => {
    const repo = new FakeNotificationRuleRepository();
    await expect(
      saveNotificationRule(
        baseCommand({ condition: { field: "amount", operator: "startsWith" as never, value: "1" } }),
        repo,
      ),
    ).rejects.toBeInstanceOf(InvalidNotificationRuleError);
  });
});

describe("updateNotificationRule — title/body override branches", () => {
  it("keeps a non-blank title/body override, trimmed", async () => {
    const repo = new FakeNotificationRuleRepository();
    await saveNotificationRule(baseCommand(), repo);
    const updated = await updateNotificationRule(
      "rule-1",
      { ...baseCommand(), titleAr: "  عنوان مخصص  ", bodyAr: "  نص الرسالة  " },
      repo,
    );
    expect(updated.titleAr).toBe("عنوان مخصص");
    expect(updated.bodyAr).toBe("نص الرسالة");
  });

  it("collapses a blank-after-trim title/body override to null", async () => {
    const repo = new FakeNotificationRuleRepository();
    await saveNotificationRule(baseCommand(), repo);
    const updated = await updateNotificationRule(
      "rule-1",
      { ...baseCommand(), titleAr: "   ", bodyAr: "   " },
      repo,
    );
    expect(updated.titleAr).toBeNull();
    expect(updated.bodyAr).toBeNull();
  });
});

describe("setNotificationRuleActive — default clock", () => {
  it("stamps updatedAt from the system clock when no clock is injected", async () => {
    const repo = new FakeNotificationRuleRepository();
    await saveNotificationRule(baseCommand(), repo, () => "2026-08-01T00:00:00.000Z");
    const toggled = await setNotificationRuleActive("rule-1", false, repo);
    expect(toggled.active).toBe(false);
    expect(new Date(toggled.updatedAt).toString()).not.toBe("Invalid Date");
  });

  it("throws NotFoundError toggling an unknown rule", async () => {
    const repo = new FakeNotificationRuleRepository();
    await expect(setNotificationRuleActive("missing", true, repo)).rejects.toBeInstanceOf(
      NotificationRuleNotFoundError,
    );
  });
});
