import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { createBackend, type BackendHandle } from "./create-backend.js";

const ARABIC = /[؀-ۿ]/;
const TODAY = new Date().toISOString().slice(0, 10);

interface Res {
  readonly status: number;
  readonly body: any;
}
type Caller = (method: string, path: string, body?: unknown) => Promise<Res>;

let dbPath: string;
let handle: BackendHandle;
let admin: Caller;
let cashier: Caller;

function sql<T = any>(query: string, ...params: unknown[]): T | undefined {
  const { sqlite } = openSqliteConnection(dbPath);
  try {
    return sqlite.prepare(query).get(...params) as T | undefined;
  } finally {
    sqlite.close();
  }
}

beforeAll(async () => {
  dbPath = join(mkdtempSync(join(tmpdir(), "mezan-collection-draft-")), "books.db");
  handle = await createBackend({ dbPath });
  const as = (userId: string, permissions: string[], roleCode: string | null): Caller => {
    const token = handle.sessions.issue({ userId, permissions, roleCode, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    return async (method, path, body) => {
      const res = await handle.app.fetch(new Request(`http://local${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }));
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };
  };
  admin = as("USER-CD-ADMIN", ["*"], null);
  cashier = as("USER-CD-CASHIER", ["treasury.cash_voucher.create", "treasury.cash_voucher.view"], "TREASURY_CASHIER");
  expect((await admin("POST", "/customers", { id: "CUST-CD", code: "CUST-CD", nameAr: "عميل التحصيل", type: "company" })).status).toBe(201);
  const drawer = await admin("POST", "/treasury-accounts", { id: "TR-CD", code: "TR-CD", name: "صندوق التحصيل", type: "cash", currency: "EGP", branchId: "BR-MAIN", glAccountId: "1300-1", openingBalance: "0" });
  expect(drawer.status, JSON.stringify(drawer.body)).toBe(201);
}, 120_000);

afterAll(() => handle?.close());

describe("a cashier who may write a voucher but not confirm it, collecting from the phone", () => {
  it("is refused the one-call collection in Arabic, and nothing is written", async () => {
    const refused = await cashier("POST", "/vouchers/collections", { id: "CD-ONE-CALL", customerId: "CUST-CD", branchId: "BR-MAIN", treasuryAccountId: "TR-CD", amount: "100.00", paymentMethod: "cash", allocations: [] });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(ARABIC);
    expect(sql("SELECT id FROM voucher WHERE id = 'CD-ONE-CALL'")).toBeUndefined();
  });

  it("saves a draft collection without naming a ledger account: the server books it against the customers' control account, and nothing moves", async () => {
    const entriesBefore = sql<{ n: number }>("SELECT COUNT(*) AS n FROM journal_entry")!.n;
    const drafted = await cashier("POST", "/vouchers", { id: "CD-DRAFT", date: TODAY, voucherType: "customer_collection", amount: "100.00", branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "TR-CD", customerId: "CUST-CD", referenceNo: null, memo: "تحصيل الفاتورة INV-000123" });
    expect(drafted.status, JSON.stringify(drafted.body).slice(0, 300)).toBe(201);
    expect(drafted.body.status).toBe("draft");
    expect(drafted.body.docNo ?? null).toBeNull();
    expect(sql("SELECT status, counterparty_gl_account_id AS counter, customer_id AS customer FROM voucher WHERE id = 'CD-DRAFT'")).toEqual({ status: "draft", counter: "1105", customer: "CUST-CD" });
    expect(sql<{ n: number }>("SELECT COUNT(*) AS n FROM journal_entry")!.n).toBe(entriesBefore);
  });

  it("cannot confirm its own draft", async () => {
    const refused = await cashier("POST", "/vouchers/CD-DRAFT/confirm", {});
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(ARABIC);
    expect(sql("SELECT status FROM voucher WHERE id = 'CD-DRAFT'")).toEqual({ status: "draft" });
  });
});
