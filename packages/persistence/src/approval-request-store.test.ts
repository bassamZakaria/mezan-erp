import { describe, it, expect, afterEach } from "vitest";
import { DuplicateRecordIdError, type ApprovalRequestRecord } from "@mezan/domain";
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
    await store.insert(request());
    expect(await store.findById("req-1")).toEqual({ ...request(), subject: null });
  });

  it("lists every request newest-first", async () => {
    store = createSqliteApprovalRequestStore();
    await store.insert(request({ id: "req-1", createdAt: "2026-08-08T00:00:00.000Z" }));
    await store.insert(request({ id: "req-2", createdAt: "2026-08-09T00:00:00.000Z" }));
    const list = await store.list();
    expect(list.map((r) => r.id)).toEqual(["req-2", "req-1"]);
  });

  it("listPendingForRoles matches only the current step's role", async () => {
    store = createSqliteApprovalRequestStore();
    await store.insert(request({ id: "req-1", currentStep: 0 }));
    await store.insert(request({ id: "req-2", currentStep: 1 }));
    await store.insert(request({ id: "req-3", status: "approved", currentStep: 2 }));

    expect((await store.listPendingForRoles(["SUPERVISOR"])).map((r) => r.id)).toEqual(["req-1"]);
    expect((await store.listPendingForRoles(["FINANCE_MANAGER"])).map((r) => r.id)).toEqual(["req-2"]);
    expect((await store.listPendingForRoles(["OTHER_ROLE"])).map((r) => r.id)).toEqual([]);
  });

  it("listPendingForRoles([\"*\"]) returns every pending request", async () => {
    store = createSqliteApprovalRequestStore();
    await store.insert(request({ id: "req-1", currentStep: 0 }));
    await store.insert(request({ id: "req-2", currentStep: 1 }));
    expect((await store.listPendingForRoles(["*"])).map((r) => r.id).sort()).toEqual(["req-1", "req-2"]);
  });

  it("listBySubmitter filters by submitter", async () => {
    store = createSqliteApprovalRequestStore();
    await store.insert(request({ id: "req-1", submittedBy: "alice" }));
    await store.insert(request({ id: "req-2", submittedBy: "bob" }));
    expect((await store.listBySubmitter("alice")).map((r) => r.id)).toEqual(["req-1"]);
  });

  it("persists a null entity label", async () => {
    store = createSqliteApprovalRequestStore();
    await store.insert(request({ entityLabel: null }));
    expect((await store.findById("req-1"))?.entityLabel).toBeNull();
  });

  it("round-trips the document a request was raised for", async () => {
    store = createSqliteApprovalRequestStore();
    const subject = { documentId: "INV-1", branchId: "BR-MAIN", fingerprint: "a".repeat(64) };
    await store.insert(request({ subject }));
    expect((await store.findById("req-1"))?.subject).toEqual(subject);
    await store.insert(request({ id: "req-2" }));
    expect((await store.findById("req-2"))?.subject).toBeNull();
  });

  it("never replaces a standing request: a second insert under its id is refused and the row is unchanged", async () => {
    store = createSqliteApprovalRequestStore();
    await store.insert(request());
    await expect(store.insert(request({ actionType: "TREASURY_VOUCHER_CONFIRM", submittedBy: "mallory", steps: [], status: "approved" }))).rejects.toBeInstanceOf(
      DuplicateRecordIdError,
    );
    expect(await store.findById("req-1")).toEqual({ ...request(), subject: null });
    expect(await store.list()).toHaveLength(1);
  });

  it("save records a transition of a standing request and creates nothing", async () => {
    store = createSqliteApprovalRequestStore();
    await store.save(request({ id: "req-ghost", status: "approved" }));
    expect(await store.findById("req-ghost")).toBeNull();
    await store.insert(request());
    await store.save(request({ status: "approved", currentStep: 2, updatedAt: "2026-08-09T00:00:00.000Z" }));
    expect((await store.findById("req-1"))?.status).toBe("approved");
  });

  it("adds the document columns to a table created before they existed", async () => {
    const { default: Database } = await import("better-sqlite3");
    const sqlite = new Database(":memory:");
    sqlite.exec(
      "CREATE TABLE approval_request (id TEXT PRIMARY KEY, action_type TEXT NOT NULL, submitted_by TEXT NOT NULL, steps_json TEXT NOT NULL, current_step INTEGER NOT NULL, status TEXT NOT NULL, decisions_json TEXT NOT NULL, entity_label TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    );
    sqlite.prepare("INSERT INTO approval_request VALUES ('old-1', 'SALES_INVOICE_CONFIRM', 'alice', '[]', 0, 'pending', '[]', NULL, '2026-01-01', '2026-01-01')").run();
    store = createSqliteApprovalRequestStore(sqlite);
    expect((await store.findById("old-1"))?.subject).toBeNull();
    await store.insert(request({ subject: { documentId: "INV-1", branchId: null, fingerprint: "f".repeat(64) } }));
    expect((await store.findById("req-1"))?.subject?.documentId).toBe("INV-1");
    sqlite.close();
  });
});
