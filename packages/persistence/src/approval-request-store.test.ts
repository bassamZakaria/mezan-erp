import { describe, it, expect, afterEach } from "vitest";
import type { ApprovalRequestRecord } from "@mezan/domain";
import { createSqliteApprovalRequestStore, type SqliteApprovalRequestStoreHandle } from "./approval-request-store.js";

let store: SqliteApprovalRequestStoreHandle;
afterEach(() => store?.close());

function request(overrides: Partial<ApprovalRequestRecord> = {}): ApprovalRequestRecord {
  return {
    id: "req-1",
    actionType: "SALES_INVOICE_CONFIRM",
    submittedBy: "alice",
    steps: [{ role: "SUPERVISOR" }, { role: "FINANCE_MANAGER" }],
    currentStep: 0,
    status: "pending",
    decisions: [],
    entityLabel: "فاتورة INV-001",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("SqliteApprovalRequestStore", () => {
  it("round-trips a saved request", async () => {
    store = createSqliteApprovalRequestStore();
    await store.save(request());
    expect(await store.findById("req-1")).toEqual(request());
  });

  it("lists every request newest-first", async () => {
    store = createSqliteApprovalRequestStore();
    await store.save(request({ id: "req-1", createdAt: "2026-08-08T00:00:00.000Z" }));
    await store.save(request({ id: "req-2", createdAt: "2026-08-09T00:00:00.000Z" }));
    const list = await store.list();
    expect(list.map((r) => r.id)).toEqual(["req-2", "req-1"]);
  });

  it("listPendingForRoles matches only the current step's role", async () => {
    store = createSqliteApprovalRequestStore();
    await store.save(request({ id: "req-1", currentStep: 0 }));
    await store.save(request({ id: "req-2", currentStep: 1 }));
    await store.save(request({ id: "req-3", status: "approved", currentStep: 2 }));

    expect((await store.listPendingForRoles(["SUPERVISOR"])).map((r) => r.id)).toEqual(["req-1"]);
    expect((await store.listPendingForRoles(["FINANCE_MANAGER"])).map((r) => r.id)).toEqual(["req-2"]);
    expect((await store.listPendingForRoles(["OTHER_ROLE"])).map((r) => r.id)).toEqual([]);
  });

  it("listPendingForRoles([\"*\"]) returns every pending request", async () => {
    store = createSqliteApprovalRequestStore();
    await store.save(request({ id: "req-1", currentStep: 0 }));
    await store.save(request({ id: "req-2", currentStep: 1 }));
    expect((await store.listPendingForRoles(["*"])).map((r) => r.id).sort()).toEqual(["req-1", "req-2"]);
  });

  it("listBySubmitter filters by submitter", async () => {
    store = createSqliteApprovalRequestStore();
    await store.save(request({ id: "req-1", submittedBy: "alice" }));
    await store.save(request({ id: "req-2", submittedBy: "bob" }));
    expect((await store.listBySubmitter("alice")).map((r) => r.id)).toEqual(["req-1"]);
  });

  it("persists a null entity label", async () => {
    store = createSqliteApprovalRequestStore();
    await store.save(request({ entityLabel: null }));
    expect((await store.findById("req-1"))?.entityLabel).toBeNull();
  });
});
