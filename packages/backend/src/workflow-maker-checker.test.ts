import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, createEntitlements, LAN_MULTI_TILL_FEATURE, MODULE_CATALOG } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { createBackend, type BackendHandle } from "./create-backend.js";

const ARABIC = /[؀-ۿ]/;
const TODAY = new Date().toISOString().slice(0, 10);
const BOOT_TIMEOUT_MS = 240_000;
const APPROVER_ROLE = "BRANCH_MANAGER";
const GATED_ACTION = "SALES_INVOICE_CONFIRM";
const UNGATED_ACTION = "TREASURY_VOUCHER_CONFIRM";

interface Res {
  readonly status: number;
  readonly body: any;
}
type Caller = (method: string, path: string, body?: unknown) => Promise<Res>;

let handle: BackendHandle;
let sqlite: ReturnType<typeof openSqliteConnection>["sqlite"];
let admin: Caller;
let anonymous: Caller;
let clerk: Caller;
let clerkWhoMayApprove: Caller;
let noPermissions: Caller;
let supervisor: Caller;
let alexSupervisor: Caller;

function callerFor(token: string | null): Caller {
  return async (method, path, body) => {
    const res = await handle.app.fetch(
      new Request(`http://local${path}`, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await res.text();
    try {
      return { status: res.status, body: text ? JSON.parse(text) : null };
    } catch {
      return { status: res.status, body: text };
    }
  };
}

const one = <T = any>(sql: string, ...params: unknown[]) => sqlite.prepare(sql).get(...params) as T | undefined;
const requestRow = (id: string) => one("SELECT action_type, submitted_by, status, decisions_json, document_id FROM approval_request WHERE id = ?", id);
const invoiceRow = (id: string) => one("SELECT status, doc_no, workflow_request_id FROM sales_invoice WHERE id = ?", id);
const journalLines = (id: string) => (one<{ n: number }>("SELECT count(*) AS n FROM journal_line WHERE entry_id = ?", id) ?? { n: 0 }).n;
const requestCount = () => one<{ n: number }>("SELECT count(*) AS n FROM approval_request")!.n;

const invoice = (id: string, branchId = "BR-MAIN", warehouseId = "WH-MAIN") => ({
  id,
  date: TODAY,
  dueDate: TODAY,
  customerId: "CUST-DEMO-2",
  customerNameAr: "مؤسسة النور للمقاولات",
  warehouseId,
  branchId,
  currency: "EGP",
  arAccountId: "1105",
  taxAccountId: "2200",
  lines: [
    {
      lineId: `${id}-L1`,
      itemId: "ITEM-DEMO-1",
      itemNameAr: "خدمة اختبار",
      isStock: false,
      qty: "1",
      unitPrice: "100",
      taxRatePercent: 14,
      revenueAccountId: "4100",
      cogsAccountId: "5100",
      inventoryAccountId: "1200",
    },
  ],
});

async function heldInvoice(id: string, branchId?: string, warehouseId?: string): Promise<string> {
  expect((await clerk("POST", "/sales-invoices", invoice(id, branchId, warehouseId))).status).toBe(201);
  const confirm = await clerk("POST", `/sales-invoices/${id}/confirm`, {});
  expect(confirm.body?.held, JSON.stringify(confirm.body).slice(0, 200)).toBe(true);
  expect(invoiceRow(id)).toMatchObject({ status: "pending", workflow_request_id: `${id}:confirm` });
  return `${id}:confirm`;
}

beforeAll(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "mezan-wf-")), "books.db");
  const resolveEntitlements = () =>
    createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: { [LAN_MULTI_TILL_FEATURE]: true }, seats: 50, expiresAt: null });
  handle = await createBackend({ dbPath, seedDemoData: true, lan: { resolveEntitlements }, resolveEntitlements });
  sqlite = openSqliteConnection(dbPath).sqlite;
  const session = async (userId: string, permissions: readonly string[], roleCode: string | null, branchScope: typeof ALL_SCOPE | string[] = ALL_SCOPE) =>
    callerFor(await handle.sessions.issue({ userId, permissions, roleCode, branchScope, warehouseScope: ALL_SCOPE }));
  const clerkPermissions = ["sales.invoice.create", "sales.invoice.confirm", "sales.invoice.view", "workflow.view"];
  const approverPermissions = ["sales.invoice.view", "sales.invoice.confirm", "workflow.view", "workflow.approve", "workflow.reject"];
  admin = (await session("USER-ADMIN", ["*"], null));
  anonymous = callerFor(null);
  clerk = (await session("USER-WF-CLERK", clerkPermissions, "CASHIER"));
  clerkWhoMayApprove = (await session("USER-WF-CLERK", [...clerkPermissions, "workflow.approve", "workflow.reject"], APPROVER_ROLE));
  noPermissions = (await session("USER-WF-NOBODY", ["profile.view"], "CASHIER"));
  supervisor = (await session("USER-WF-SUPERVISOR", approverPermissions, APPROVER_ROLE));
  alexSupervisor = (await session("USER-WF-ALEX-SUPERVISOR", approverPermissions, APPROVER_ROLE, ["BR-ALEX"]));
  const steps = [{ role: APPROVER_ROLE }];
  const seeded = ((await admin("GET", "/workflow/configs")).body as { id: string; actionType: string }[]).find((config) => config.actionType === GATED_ACTION);
  const configured = seeded ? await admin("PUT", `/workflow/configs/${seeded.id}`, { steps }) : await admin("POST", "/workflow/configs", { actionType: GATED_ACTION, steps });
  expect([200, 201], JSON.stringify(configured.body)).toContain(configured.status);
  const others = ((await admin("GET", "/workflow/configs")).body as { actionType: string }[]).map((config) => config.actionType);
  expect(others).not.toContain(UNGATED_ACTION);
}, BOOT_TIMEOUT_MS);

afterAll(() => {
  sqlite?.close();
  handle?.close();
});

describe("POST /workflow/requests is not a way to write an approval", () => {
  it("refuses a caller who is not signed in and stores nothing", async () => {
    const before = requestCount();
    const res = await anonymous("POST", "/workflow/requests", { actionType: UNGATED_ACTION });
    expect(res.status).toBe(401);
    expect(requestCount()).toBe(before);
  });

  it("refuses a signed-in caller who may not use the approvals inbox", async () => {
    const before = requestCount();
    const res = await noPermissions("POST", "/workflow/requests", { actionType: UNGATED_ACTION });
    expect(res.status).toBe(403);
    expect(res.body?.message).toMatch(ARABIC);
    expect(requestCount()).toBe(before);
  });

  it("never takes the request id from the caller", async () => {
    const before = requestCount();
    const res = await clerk("POST", "/workflow/requests", { actionType: UNGATED_ACTION, requestId: "WF-CHOSEN:confirm" });
    expect(res.status).toBe(400);
    expect(res.body?.message).toMatch(ARABIC);
    expect(requestCount()).toBe(before);
    expect(requestRow("WF-CHOSEN:confirm")).toBeUndefined();
  });

  it("still opens a request that gates no document, under an id the server chose", async () => {
    const res = await clerk("POST", "/workflow/requests", { actionType: UNGATED_ACTION, entityLabel: "طلب عام" });
    expect(res.status).toBe(201);
    expect(res.body?.submittedBy).toBe("USER-WF-CLERK");
    expect(requestRow(res.body.id)).toMatchObject({ document_id: null });
  });
});

describe("a held document posts only on its own approval, given by someone else", () => {
  it("R5-WF-1 — the clerk cannot replace the pending request with an approved one and post", async () => {
    const requestId = await heldInvoice("WF-INV-1");
    const before = requestRow(requestId);
    expect(before).toMatchObject({ action_type: GATED_ACTION, status: "pending", document_id: "WF-INV-1" });

    const overwrite = await clerk("POST", "/workflow/requests", { actionType: UNGATED_ACTION, requestId });
    expect(overwrite.status).toBe(400);
    expect(requestRow(requestId)).toEqual(before);

    const again = await clerk("POST", "/sales-invoices/WF-INV-1/confirm", {});
    expect(again.body?.held).toBe(true);
    expect(invoiceRow("WF-INV-1")).toMatchObject({ status: "pending", doc_no: null });
    expect(journalLines("WF-INV-1")).toBe(0);
  });

  it("the clerk cannot decide the request they raised, with or without the approver's role", async () => {
    const requestId = await heldInvoice("WF-INV-SELF");
    const withoutPermission = await clerk("POST", `/workflow/requests/${requestId}/decide`, { decision: "approve" });
    expect(withoutPermission.status).toBe(403);
    const withRole = await clerkWhoMayApprove("POST", `/workflow/requests/${requestId}/decide`, { decision: "approve" });
    expect(withRole.status).toBe(409);
    expect(withRole.body?.error).toBe("SELF_APPROVAL");
    expect(withRole.body?.message).toMatch(ARABIC);
    expect(requestRow(requestId)).toMatchObject({ status: "pending", decisions_json: "[]" });
    expect(invoiceRow("WF-INV-SELF")).toMatchObject({ status: "pending" });
    expect(journalLines("WF-INV-SELF")).toBe(0);
  });

  it("the supervisor's approval posts the invoice", async () => {
    const requestId = await heldInvoice("WF-INV-OK");
    const decided = await supervisor("POST", `/workflow/requests/${requestId}/decide`, { decision: "approve" });
    expect(decided.status, JSON.stringify(decided.body).slice(0, 300)).toBe(200);
    expect(invoiceRow("WF-INV-OK")).toMatchObject({ status: "confirmed" });
    expect(journalLines("WF-INV-OK")).toBeGreaterThan(0);
  });

  it("R5-WF-2 — an approved request planted under the invoice's id before its first confirm is not honoured", async () => {
    expect((await clerk("POST", "/sales-invoices", invoice("WF-INV-2"))).status).toBe(201);
    sqlite
      .prepare(
        "INSERT INTO approval_request (id, action_type, submitted_by, steps_json, current_step, status, decisions_json, created_at, updated_at) VALUES (?, ?, 'USER-WF-NOBODY', '[]', 0, 'approved', '[]', ?, ?)",
      )
      .run("WF-INV-2:confirm", UNGATED_ACTION, TODAY, TODAY);
    const res = await clerk("POST", "/sales-invoices/WF-INV-2/confirm", {});
    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("APPROVAL_REQUEST_UNTRUSTED");
    expect(res.body?.message).toMatch(ARABIC);
    expect(invoiceRow("WF-INV-2")).toMatchObject({ status: "draft", doc_no: null });
    expect(journalLines("WF-INV-2")).toBe(0);
  });

  it("a confirm cannot name the request it is judged by", async () => {
    expect((await clerk("POST", "/sales-invoices", invoice("WF-INV-3"))).status).toBe(201);
    const planted = await clerk("POST", "/workflow/requests", { actionType: UNGATED_ACTION });
    expect(planted.body?.status).toBe("approved");
    const res = await clerk("POST", "/sales-invoices/WF-INV-3/confirm", { requestId: planted.body.id });
    expect(res.body?.held).toBe(true);
    expect(invoiceRow("WF-INV-3")).toMatchObject({ status: "pending", workflow_request_id: "WF-INV-3:confirm" });
    expect(journalLines("WF-INV-3")).toBe(0);
  });
});

describe("an approver held to one branch", () => {
  it("cannot see or decide another branch's request", async () => {
    const requestId = await heldInvoice("WF-INV-MAIN");
    const decided = await alexSupervisor("POST", `/workflow/requests/${requestId}/decide`, { decision: "approve" });
    expect(decided.status).toBe(404);
    expect(decided.body?.message).toMatch(ARABIC);
    expect(requestRow(requestId)).toMatchObject({ status: "pending", decisions_json: "[]" });
    expect(invoiceRow("WF-INV-MAIN")).toMatchObject({ status: "pending" });
    const listed = await alexSupervisor("GET", "/workflow/requests");
    expect(JSON.stringify(listed.body)).not.toContain(requestId);
    const pending = await alexSupervisor("GET", "/workflow/requests/pending");
    expect(JSON.stringify(pending.body)).not.toContain(requestId);
  });

  it("decides a request of their own branch", async () => {
    const requestId = await heldInvoice("WF-INV-ALEX", "BR-ALEX", "WH-ALEX");
    const decided = await alexSupervisor("POST", `/workflow/requests/${requestId}/decide`, { decision: "approve" });
    expect(decided.status, JSON.stringify(decided.body).slice(0, 300)).toBe(200);
    expect(invoiceRow("WF-INV-ALEX")).toMatchObject({ status: "confirmed" });
  });
});
