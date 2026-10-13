import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, ApprovalStatusCode } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { createBackend, type BackendHandle } from "./create-backend.js";

const ARABIC = /[؀-ۿ]/;
const APPROVER_ROLE = "TREASURY_SUPERVISOR";
const VOUCHER = "RA-VCH";
const REQUEST = `${VOUCHER}:confirm`;
const TODAY = new Date().toISOString().slice(0, 10);
const BEFORE_FINGERPRINTS = `
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
let admin: Caller;
let cashier: Caller;
let supervisor: Caller;

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
  admin = as("USER-RA-ADMIN", ["*"], null);
  cashier = as("USER-RA-CASHIER", ["treasury.cash_voucher.create", "treasury.cash_voucher.confirm", "treasury.cash_voucher.view"], "TREASURY_CASHIER");
  supervisor = as("USER-RA-SUPERVISOR", ["treasury.cash_voucher.view", "treasury.cash_voucher.confirm", "workflow.view", "workflow.approve", "workflow.reject"], APPROVER_ROLE);
}

function sql<T = any>(query: string, ...params: unknown[]): T | undefined {
  const { sqlite } = openSqliteConnection(dbPath);
  try {
    return sqlite.prepare(query).get(...params) as T | undefined;
  } finally {
    sqlite.close();
  }
}

beforeAll(async () => {
  dbPath = join(mkdtempSync(join(tmpdir(), "mezan-reapproval-flow-")), "books.db");
  handle = await createBackend({ dbPath });
  callers();
  const role = await admin("POST", "/roles", { code: APPROVER_ROLE, name: "مشرف الخزينة", description: "يعتمد السندات", permissions: ["treasury.cash_voucher.view", "treasury.cash_voucher.confirm", "workflow.view", "workflow.approve", "workflow.reject"] });
  expect(role.status, JSON.stringify(role.body)).toBe(201);
  expect((await admin("POST", "/workflow/configs", { actionType: "TREASURY_VOUCHER_CONFIRM", steps: [{ role: APPROVER_ROLE }] })).status).toBe(201);
  const drawer = await admin("POST", "/treasury-accounts", { id: "TR-RA", code: "TR-RA", name: "صندوق الاختبار", type: "cash", currency: "EGP", branchId: "BR-MAIN", glAccountId: "1300-1", openingBalance: "0" });
  expect(drawer.status, JSON.stringify(drawer.body)).toBe(201);
  const drafted = await cashier("POST", "/vouchers", { id: VOUCHER, date: TODAY, memo: "سند قبل التحديث", voucherType: "other_income", amount: "75.00", branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "TR-RA", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "4100" });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
  const held = await cashier("POST", `/vouchers/${VOUCHER}/confirm`, {});
  expect(held.body?.held, JSON.stringify(held.body).slice(0, 300)).toBe(true);
  handle.close();

  const { sqlite } = openSqliteConnection(dbPath);
  sqlite.exec(BEFORE_FINGERPRINTS);
  sqlite.close();

  handle = await createBackend({ dbPath });
  callers();
}, 120_000);

afterAll(() => handle?.close());

describe("a voucher held before the upgrade, from start-up marking to posting", () => {
  it("start-up marks its request, and the voucher stays held with nothing posted", () => {
    expect(sql("SELECT status, document_id FROM approval_request WHERE id = ?", REQUEST)).toEqual({ status: ApprovalStatusCode.ReapprovalRequired, document_id: VOUCHER });
    expect(sql("SELECT status FROM voucher WHERE id = ?", VOUCHER)).toEqual({ status: "pending" });
    expect(sql("SELECT COUNT(*) AS n FROM journal_entry WHERE source_doc_id = ?", VOUCHER)).toEqual({ n: 0 });
  });

  it("the voucher's own page reads the request it waits on and the Arabic reason it cannot post", async () => {
    const read = await cashier("GET", `/vouchers/${VOUCHER}`);
    expect(read.body.status).toBe("pending");
    expect(read.body.workflowRequestId).toBe(REQUEST);
    const standing = await cashier("GET", `/workflow/requests/${REQUEST}/standing`);
    expect(standing.status, JSON.stringify(standing.body)).toBe(200);
    expect(standing.body.status).toBe(ApprovalStatusCode.ReapprovalRequired);
    expect(standing.body.reason).toMatch(ARABIC);
    expect(standing.body.reason).toContain("اطلب الموافقة من جديد");
  });

  it("the approver cannot decide the stale request, and it is not in the inbox", async () => {
    expect(((await supervisor("GET", "/workflow/requests/pending")).body as { id: string }[]).map((row) => row.id)).not.toContain(REQUEST);
    const decided = await supervisor("POST", `/workflow/requests/${REQUEST}/decide`, { decision: "approve" });
    expect(decided.status).toBe(409);
    expect(decided.body.message).toMatch(ARABIC);
    expect(sql("SELECT status FROM voucher WHERE id = ?", VOUCHER)).toEqual({ status: "pending" });
  });

  it("«طلب الموافقة من جديد» is the voucher's confirm: the request goes back to pending under the chain in force", async () => {
    const again = await cashier("POST", `/vouchers/${VOUCHER}/confirm`, {});
    expect(again.status, JSON.stringify(again.body).slice(0, 300)).toBe(200);
    expect(again.body.held).toBe(true);
    const row = sql<{ status: string; decisions_json: string; document_fingerprint: string }>("SELECT status, decisions_json, document_fingerprint FROM approval_request WHERE id = ?", REQUEST)!;
    expect(row.status).toBe("pending");
    expect(JSON.parse(row.decisions_json)).toEqual([]);
    expect(row.document_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect((await cashier("GET", `/workflow/requests/${REQUEST}/standing`)).body).toMatchObject({ status: "pending", reason: null });
    expect(((await supervisor("GET", "/workflow/requests/pending")).body as { id: string }[]).map((row) => row.id)).toContain(REQUEST);
    expect(sql("SELECT COUNT(*) AS n FROM journal_entry WHERE source_doc_id = ?", VOUCHER)).toEqual({ n: 0 });
  });

  it("the new approval posts the voucher: one balanced entry, a number, and a standing that says approved", async () => {
    const approved = await supervisor("POST", `/workflow/requests/${REQUEST}/decide`, { decision: "approve" });
    expect(approved.status, JSON.stringify(approved.body).slice(0, 300)).toBe(200);
    const posted = await cashier("GET", `/vouchers/${VOUCHER}`);
    expect(posted.body.status).toBe("confirmed");
    expect(posted.body.docNo).toBeTruthy();
    const entry = sql<{ id: string }>("SELECT id FROM journal_entry WHERE source_doc_id = ?", VOUCHER);
    expect(entry).toBeDefined();
    expect(sql("SELECT SUM(debit) AS debit, SUM(credit) AS credit FROM journal_line WHERE entry_id = ?", entry!.id)).toEqual({ debit: 75_000_000, credit: 75_000_000 });
    expect((await cashier("GET", `/workflow/requests/${REQUEST}/standing`)).body.status).toBe("approved");
  });
});
