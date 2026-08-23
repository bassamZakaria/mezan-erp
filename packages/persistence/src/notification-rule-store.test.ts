import { describe, expect, it, afterEach } from "vitest";
import { createSqliteNotificationRuleStore, type SqliteNotificationRuleStoreHandle } from "./notification-rule-store.js";
import type { NotificationRule } from "@mezan/domain";

function makeRule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: "rule-1",
    name: "فاتورة مبيعات مؤكدة",
    eventCode: "SALES_INVOICE_CONFIRMED",
    condition: null,
    recipientType: "permission",
    recipientValue: "sales.invoice.view",
    priority: "normal",
    channels: ["in_app"],
    titleAr: null,
    bodyAr: null,
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("SqliteNotificationRuleRepository", () => {
  let handle: SqliteNotificationRuleStoreHandle;

  afterEach(() => {
    handle?.close();
  });

  it("round-trips save/findById including a condition", async () => {
    handle = createSqliteNotificationRuleStore();
    const rule = makeRule({ condition: { field: "amount", operator: "gt", value: "1000" } });
    await handle.save(rule);
    expect(await handle.findById(rule.id)).toEqual(rule);
  });

  it("round-trips a rule with no condition (null, not absent)", async () => {
    handle = createSqliteNotificationRuleStore();
    const rule = makeRule();
    await handle.save(rule);
    const found = await handle.findById(rule.id);
    expect(found?.condition).toBeNull();
  });

  it("update() replaces fields and bumps updatedAt", async () => {
    handle = createSqliteNotificationRuleStore();
    await handle.save(makeRule());
    const updated = makeRule({ name: "اسم محدث", active: false, updatedAt: "2026-08-20T00:00:00.000Z" });
    await handle.update(updated);
    const found = await handle.findById("rule-1");
    expect(found?.name).toBe("اسم محدث");
    expect(found?.active).toBe(false);
  });

  it("list() filters by active and eventCode", async () => {
    handle = createSqliteNotificationRuleStore();
    await handle.save(makeRule({ id: "r1", active: true, eventCode: "SALES_INVOICE_CONFIRMED" }));
    await handle.save(makeRule({ id: "r2", active: false, eventCode: "SALES_INVOICE_CONFIRMED" }));
    await handle.save(makeRule({ id: "r3", active: true, eventCode: "LOW_STOCK_DETECTED" }));

    expect((await handle.list({ active: true })).map((r) => r.id).sort()).toEqual(["r1", "r3"]);
    expect((await handle.list({ eventCode: "LOW_STOCK_DETECTED" })).map((r) => r.id)).toEqual(["r3"]);
    expect(await handle.list()).toHaveLength(3);
  });

  it("listActiveByEventCode() excludes inactive rules and other events", async () => {
    handle = createSqliteNotificationRuleStore();
    await handle.save(makeRule({ id: "r1", active: true, eventCode: "SALES_INVOICE_CONFIRMED" }));
    await handle.save(makeRule({ id: "r2", active: false, eventCode: "SALES_INVOICE_CONFIRMED" }));
    await handle.save(makeRule({ id: "r3", active: true, eventCode: "LOW_STOCK_DETECTED" }));

    const active = await handle.listActiveByEventCode("SALES_INVOICE_CONFIRMED");
    expect(active.map((r) => r.id)).toEqual(["r1"]);
  });

  it("delete() removes the row", async () => {
    handle = createSqliteNotificationRuleStore();
    await handle.save(makeRule());
    await handle.delete("rule-1");
    expect(await handle.findById("rule-1")).toBeNull();
  });

  it("findById() returns null for an unknown id", async () => {
    handle = createSqliteNotificationRuleStore();
    expect(await handle.findById("nope")).toBeNull();
  });
});
