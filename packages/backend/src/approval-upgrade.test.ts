import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, ApprovalStatusCode } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { createBackend, type BackendHandle } from "./create-backend.js";

const ARABIC = /[؀-ۿ]/;
const APPROVER_ROLE = "SUPERVISOR";
const OLD_SHAPE = `
CREATE TABLE approval_request_old AS
  SELECT id, action_type, submitted_by, steps_json, current_step, status, decisions_json, entity_label, created_at, updated_at FROM approval_request;
DROP TABLE approval_request;
ALTER TABLE approval_request_old RENAME TO approval_request;
DROP TABLE IF EXISTS upgrade_step;
`;

interface Res {
  readonly status: number;
  readonly body: any;
}
type Caller = (method: string, path: string, body?: unknown) => Promise<Res>;

let dbPath: string;
let handle: BackendHandle;
let clerk: Caller;
let supervisor: Caller;
let admin: Caller;

function callers(): void {
  const as = (userId: string, permissions: string[], roleCode: string | null): Caller => {
    const token = handle.sessions.issue({ userId, permissions, roleCode, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    return async (method, path, body) => {
      const res = await handle.app.fetch(
        new Request(`http://local${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }),
      );
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };
  };
  admin = as("USER-UP-ADMIN", ["*"], null);
  clerk = as("USER-UP-CLERK", ["sales.invoice.create", "sales.invoice.confirm", "sales.invoice.view", "workflow.view"], "SALES_REP");
  supervisor = as("USER-UP-SUPERVISOR", ["sales.invoice.view", "sales.invoice.confirm", "workflow.view", "workflow.approve", "workflow.reject"], APPROVER_ROLE);
}

const invoice = (id: string) => ({
  id,
  date: new Date().toISOString().slice(0, 10),
  dueDate: new Date().toISOString().slice(0, 10),
  customerId: "CUST-UP",
  customerNameAr: "عميل الترقية",
  warehouseId: "WH-MAIN",
  branchId: "BR-MAIN",
  arAccountId: "1105",
  taxAccountId: "2200",
  lines: [{ lineId: `${id}-L1`, itemId: "ITEM-UP", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", taxRatePercent: 0, revenueAccountId: "4100" }],
});

function sql<T = any>(query: string, ...params: unknown[]): T | undefined {
  const { sqlite } = openSqliteConnection(dbPath);
  try {
    return sqlite.prepare(query).get(...params) as T | undefined;
  } finally {
    sqlite.close();
  }
}

async function hold(id: string): Promise<string> {
  expect((await clerk("POST", "/sales-invoices", invoice(id))).status).toBe(201);
  const held = await clerk("POST", `/sales-invoices/${id}/confirm`, {});
  expect(held.body?.held, JSON.stringify(held.body).slice(0, 200)).toBe(true);
  return `${id}:confirm`;
}

beforeAll(async () => {
  dbPath = join(mkdtempSync(join(tmpdir(), "mezan-approval-upgrade-")), "books.db");
  handle = await createBackend({ dbPath });
  callers();
  expect((await admin("POST", "/customers", { id: "CUST-UP", code: "CUST-UP", nameAr: "عميل الترقية", type: "company" })).status).toBe(201);
  expect((await admin("POST", "/items", { id: "ITEM-UP", code: "ITEM-UP", nameAr: "خدمة", type: "service", baseUnitCode: "PCS", salePrice: "100" })).status).toBe(201);
  const role = await admin("POST", "/roles", { code: APPROVER_ROLE, name: "مشرف", description: "يعتمد الفواتير", permissions: ["sales.invoice.view", "sales.invoice.confirm", "workflow.view", "workflow.approve", "workflow.reject"] });
  expect(role.status, JSON.stringify(role.body)).toBe(201);
  const configured = await admin("POST", "/workflow/configs", { actionType: "SALES_INVOICE_CONFIRM", steps: [{ role: APPROVER_ROLE }] });
  expect(configured.status, JSON.stringify(configured.body)).toBe(201);

  const approvedBeforeUpgrade = await hold("UP-APPROVED");
  const pendingBeforeUpgrade = await hold("UP-PENDING");
  const posted = await hold("UP-POSTED");
  expect((await supervisor("POST", `/workflow/requests/${posted}/decide`, { decision: "approve" })).status).toBe(200);
  const general = await clerk("POST", "/workflow/requests", { actionType: "TREASURY_VOUCHER_CONFIRM", entityLabel: "طلب عام" });
  expect(general.status, JSON.stringify(general.body)).toBe(201);
  handle.close();

  const { sqlite } = openSqliteConnection(dbPath);
  const approval = JSON.stringify([{ stepIndex: 0, kind: "approve", actorId: "USER-UP-SUPERVISOR", comment: null, at: "2026-09-01T10:00:00.000Z" }]);
  sqlite.prepare("UPDATE approval_request SET status = 'approved', decisions_json = ? WHERE id = ?").run(approval, approvedBeforeUpgrade);
  sqlite.exec(OLD_SHAPE);
  expect((sqlite.prepare("PRAGMA table_info(approval_request)").all() as { name: string }[]).map((column) => column.name)).not.toContain("document_fingerprint");
  expect(sqlite.prepare("SELECT status FROM approval_request WHERE id = ?").get(pendingBeforeUpgrade)).toEqual({ status: "pending" });
  sqlite.close();

  handle = await createBackend({ dbPath });
  callers();
}, 120_000);

afterAll(() => handle?.close());

describe("upgrade — an approval given before requests carried their document's fingerprint", () => {
  it("is marked as needing re-approval when its document is still held, with the document it gates recorded", () => {
    for (const id of ["UP-APPROVED", "UP-PENDING"]) {
      expect(sql("SELECT status, document_id, document_branch_id FROM approval_request WHERE id = ?", `${id}:confirm`), id).toEqual({
        status: ApprovalStatusCode.ReapprovalRequired,
        document_id: id,
        document_branch_id: "BR-MAIN",
      });
      expect(sql("SELECT status, journal_entry_id FROM sales_invoice WHERE id = ?", id), id).toEqual({ status: "pending", journal_entry_id: null });
    }
  });

  it("leaves alone a request whose document was posted and one that gates no document", () => {
    expect(sql("SELECT status FROM approval_request WHERE id = 'UP-POSTED:confirm'")).toEqual({ status: "approved" });
    expect(sql("SELECT status FROM sales_invoice WHERE id = 'UP-POSTED'")).toEqual({ status: "confirmed" });
    expect(sql("SELECT COUNT(*) AS n, SUM(status = 'reapproval_required') AS marked FROM approval_request WHERE action_type = 'TREASURY_VOUCHER_CONFIRM'")).toEqual({ n: 1, marked: 0 });
  });

  it("the document says so in Arabic to whoever may read it", async () => {
    const standing = await clerk("GET", "/workflow/requests/UP-APPROVED:confirm/standing");
    expect(standing.status, JSON.stringify(standing.body)).toBe(200);
    expect(standing.body.status).toBe(ApprovalStatusCode.ReapprovalRequired);
    expect(standing.body.reason).toMatch(ARABIC);
    expect(standing.body.reason).toContain("اطلب الموافقة من جديد");
    expect((await clerk("GET", "/workflow/requests/NOBODY:confirm/standing")).status).toBe(404);
    const elsewhere = handle.sessions.issue({ userId: "USER-UP-ELSEWHERE", permissions: ["sales.invoice.view", "workflow.view"], roleCode: null, branchScope: ["BR-ELSEWHERE"], warehouseScope: ALL_SCOPE });
    const foreign = await handle.app.fetch(new Request("http://local/workflow/requests/UP-APPROVED:confirm/standing", { headers: { authorization: `Bearer ${elsewhere}` } }));
    expect(foreign.status).toBe(404);
    const own = handle.sessions.issue({ userId: "USER-UP-OWN-BRANCH", permissions: ["sales.invoice.view"], roleCode: null, branchScope: ["BR-MAIN"], warehouseScope: ALL_SCOPE });
    const ownBranch = await handle.app.fetch(new Request("http://local/workflow/requests/UP-APPROVED:confirm/standing", { headers: { authorization: `Bearer ${own}` } }));
    expect(ownBranch.status).toBe(200);
    const anonymous = await handle.app.fetch(new Request("http://local/workflow/requests/UP-APPROVED:confirm/standing"));
    expect(anonymous.status).toBe(401);
  });

  it("the stale approval is not in the approver's inbox and cannot be decided as it stands", async () => {
    const pending = await supervisor("GET", "/workflow/requests/pending");
    expect((pending.body as { id: string }[]).map((row) => row.id)).not.toContain("UP-PENDING:confirm");
    const decided = await supervisor("POST", "/workflow/requests/UP-PENDING:confirm/decide", { decision: "approve" });
    expect(decided.status).toBe(409);
    expect(decided.body.message).toMatch(ARABIC);
    expect(sql("SELECT status FROM sales_invoice WHERE id = 'UP-PENDING'")).toEqual({ status: "pending" });
  });

  it("asking again sends it back through the chain in force, and the new approval posts the document", async () => {
    const again = await clerk("POST", "/sales-invoices/UP-APPROVED/confirm", {});
    expect(again.status, JSON.stringify(again.body).slice(0, 300)).toBe(200);
    expect(again.body.held).toBe(true);
    const row = sql<{ status: string; decisions_json: string; document_fingerprint: string }>("SELECT status, decisions_json, document_fingerprint FROM approval_request WHERE id = 'UP-APPROVED:confirm'")!;
    expect(row.status).toBe("pending");
    expect(JSON.parse(row.decisions_json)).toEqual([]);
    expect(row.document_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(sql("SELECT status FROM sales_invoice WHERE id = 'UP-APPROVED'")).toEqual({ status: "pending" });

    const approved = await supervisor("POST", "/workflow/requests/UP-APPROVED:confirm/decide", { decision: "approve" });
    expect(approved.status, JSON.stringify(approved.body).slice(0, 300)).toBe(200);
    const posted = sql<{ status: string; journal_entry_id: string | null; doc_no: string | null }>("SELECT status, journal_entry_id, doc_no FROM sales_invoice WHERE id = 'UP-APPROVED'")!;
    expect(posted.status).toBe("confirmed");
    expect(posted.journal_entry_id).not.toBeNull();
    expect(posted.doc_no).not.toBeNull();
    expect((await clerk("GET", "/workflow/requests/UP-APPROVED:confirm/standing")).body.status).toBe("approved");
  });

  it("runs once: a later start re-marks nothing", async () => {
    handle.close();
    handle = await createBackend({ dbPath });
    callers();
    expect(sql("SELECT status FROM approval_request WHERE id = 'UP-APPROVED:confirm'")).toEqual({ status: "approved" });
    expect(sql("SELECT status FROM approval_request WHERE id = 'UP-PENDING:confirm'")).toEqual({ status: ApprovalStatusCode.ReapprovalRequired });
  });
});

describe("a held voucher names the approval request it waits on", () => {
  it("so its screen can ask what stands in its way", async () => {
    const created = await admin("POST", "/workflow/configs", { actionType: "TREASURY_VOUCHER_CONFIRM", steps: [{ role: APPROVER_ROLE }] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const cashier: Caller = async (method, path, body) => {
      const token = handle.sessions.issue({ userId: "USER-UP-CASHIER", permissions: ["treasury.cash_voucher.create", "treasury.cash_voucher.confirm", "treasury.cash_voucher.view"], roleCode: "TREASURY_CASHIER", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
      const res = await handle.app.fetch(new Request(`http://local${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }));
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };
    const drawer = await admin("POST", "/treasury-accounts", { id: "TR-UP", code: "TR-UP", name: "صندوق الاختبار", type: "cash", currency: "EGP", branchId: "BR-MAIN", glAccountId: "1300-1", openingBalance: "0" });
    expect(drawer.status, JSON.stringify(drawer.body)).toBe(201);
    const voucher = { id: "UP-VCH", date: new Date().toISOString().slice(0, 10), memo: "سند اختبار", voucherType: "other_income", amount: "50.00", branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "TR-UP", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "4100" };
    const drafted = await cashier("POST", "/vouchers", voucher);
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    expect(drafted.body.workflowRequestId).toBeNull();
    const held = await cashier("POST", "/vouchers/UP-VCH/confirm", {});
    expect(held.body?.held, JSON.stringify(held.body).slice(0, 300)).toBe(true);
    const read = await cashier("GET", "/vouchers/UP-VCH");
    expect(read.body.workflowRequestId).toBe("UP-VCH:confirm");
    expect((await cashier("GET", "/workflow/requests/UP-VCH:confirm/standing")).body).toMatchObject({ status: "pending", reason: null });
  });
});
