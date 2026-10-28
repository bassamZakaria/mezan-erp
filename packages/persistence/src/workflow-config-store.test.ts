import { describe, it, expect, afterEach } from "vitest";
import type { WorkflowConfigRecord } from "@mezan/domain";
import { createSqliteWorkflowConfigStore, type SqliteWorkflowConfigStoreHandle } from "./workflow-config-store.js";

let store: SqliteWorkflowConfigStoreHandle;
afterEach(() => store?.close());

function config(overrides: Partial<WorkflowConfigRecord> = {}): WorkflowConfigRecord {
  return {
    id: "cfg-1",
    actionType: "SALES_INVOICE_CONFIRM",
    steps: [{ role: "SUPERVISOR" }, { role: "FINANCE_MANAGER", description: "مراجعة مالية" }],
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("SqliteWorkflowConfigStore", () => {
  it("round-trips a saved config including its steps", async () => {
    store = createSqliteWorkflowConfigStore();
    await store.save(config());
    const found = await store.findById("cfg-1");
    expect(found).toEqual(config());
  });

  it("finds by action type", async () => {
    store = createSqliteWorkflowConfigStore();
    await store.save(config());
    const found = await store.findByActionType("SALES_INVOICE_CONFIRM");
    expect(found?.id).toBe("cfg-1");
    expect(await store.findByActionType("PURCHASE_ORDER_CONFIRM")).toBeNull();
  });

  it("lists every config ordered by action type", async () => {
    store = createSqliteWorkflowConfigStore();
    await store.save(config({ id: "cfg-2", actionType: "PURCHASE_ORDER_CONFIRM" }));
    await store.save(config({ id: "cfg-1", actionType: "SALES_INVOICE_CONFIRM" }));
    const list = await store.list();
    expect(list.map((c) => c.actionType)).toEqual(["PURCHASE_ORDER_CONFIRM", "SALES_INVOICE_CONFIRM"]);
  });

  it("deletes a config", async () => {
    store = createSqliteWorkflowConfigStore();
    await store.save(config());
    await store.delete("cfg-1");
    expect(await store.findById("cfg-1")).toBeNull();
  });

  it("resolve returns the same shape findByActionType would resolve to", async () => {
    store = createSqliteWorkflowConfigStore();
    await store.save(config());
    const resolved = await store.resolve("SALES_INVOICE_CONFIRM");
    expect(resolved).toEqual({ actionType: "SALES_INVOICE_CONFIRM", steps: config().steps });
    expect(await store.resolve("PURCHASE_ORDER_CONFIRM")).toBeNull();
  });
});
