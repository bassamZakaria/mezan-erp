import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE } from "@mezan/domain";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const OWN_RECORDS_REP = ["sales.return.create", "sales.return.view_own", "sales.invoice.view_own"];
const RETURNS_CLERK = ["purchases.return.create", "purchases.return.view"];
const NOT_FOUND = "SOURCE_INVOICE_NOT_FOUND";

let kit: BackendKit;

beforeAll(async () => {
  kit = await bootBackendKit();
  const sale = await kit.call("POST", "/sales-invoices", {
    id: "VIS-S", date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "A", itemId: "ITEM-DEMO-2", itemNameAr: "صنف", isStock: true, qty: "2", unitPrice: "100", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
  });
  expect(sale.status, JSON.stringify(sale.body)).toBe(201);
  expect((await kit.call("POST", "/sales-invoices/VIS-S/confirm", {})).status).toBe(200);
  const purchase = await kit.call("POST", "/purchases/invoices", {
    id: "VIS-P", supplierId: "SUPP-DEMO-1", date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: "WH-MAIN",
    lines: [{ itemId: "ITEM-DEMO-2", kind: "inventory", qty: "2", unitCost: "50", taxRateId: "VAT14" }],
  });
  expect(purchase.status, JSON.stringify(purchase.body)).toBe(201);
  expect((await kit.call("POST", "/purchases/invoices/VIS-P/confirm", {})).status).toBe(200);
}, 120_000);

afterAll(async () => {
  await kit.close();
});

const salesFromInvoice = (id: string, permissions?: readonly string[]) =>
  kit.call("POST", "/sales-returns/from-invoice", {
    id, date: TODAY, memo: "", warehouseId: "WH-MAIN", sourceInvoiceId: "VIS-S", reason: "DEFECTIVE",
    requested: [{ itemId: "ITEM-DEMO-2", sourceLineId: "A", qty: "1" }],
  }, permissions);

const salesByLines = (id: string, permissions?: readonly string[]) =>
  kit.call("POST", "/sales-returns", {
    id, date: TODAY, memo: "",
    lines: [{
      itemId: "ITEM-DEMO-2", warehouseId: "WH-MAIN", customerId: "CUST-DEMO-1", sourceInvoiceId: "VIS-S", sourceInvoiceNumber: null, sourceLineId: "A",
      reason: "DEFECTIVE", availableQty: "2", qty: "1", unitPrice: "100", unitCost: "50", taxAmount: "14", taxRatePercent: 14,
    }],
  }, permissions);

const purchaseByLines = (id: string, permissions?: readonly string[]) =>
  kit.call("POST", "/purchase-returns", {
    id, date: TODAY, memo: "",
    lines: [{ itemId: "ITEM-DEMO-2", warehouseId: "WH-MAIN", supplierId: "SUPP-DEMO-1", sourceInvoiceId: "VIS-P", sourceInvoiceNumber: null, reason: "DEFECTIVE", qty: "1" }],
  }, permissions);

describe("a return is raised only against an invoice its author may read", () => {
  it("hides another seller's sales invoice from an own-records caller on every route that reads it", async () => {
    const lines = await kit.call("GET", "/sales-returns/source-lines/VIS-S", undefined, OWN_RECORDS_REP);
    const fromInvoice = await salesFromInvoice("VIS-S-R1", OWN_RECORDS_REP);
    const byLines = await salesByLines("VIS-S-R2", OWN_RECORDS_REP);
    expect([lines.status, lines.body.error]).toEqual([404, NOT_FOUND]);
    expect([fromInvoice.status, fromInvoice.body.error], JSON.stringify(fromInvoice.body).slice(0, 300)).toEqual([404, NOT_FOUND]);
    expect([byLines.status, byLines.body.error], JSON.stringify(byLines.body).slice(0, 300)).toEqual([422, NOT_FOUND]);
    expect((await kit.call("GET", "/sales-returns/VIS-S-R1")).status).toBe(404);
    expect((await kit.call("GET", "/sales-returns/VIS-S-R2")).status).toBe(404);
  });

  it("still lets a caller who may read the invoice raise the return", async () => {
    expect((await salesFromInvoice("VIS-S-OK")).status).toBe(201);
  });

  it("hides a purchase invoice somebody else entered from a caller without the invoice permission", async () => {
    const lines = await kit.call("GET", "/purchase-returns/source-lines/VIS-P", undefined, RETURNS_CLERK);
    const byLines = await purchaseByLines("VIS-P-R1", RETURNS_CLERK);
    expect([lines.status, lines.body.error]).toEqual([404, NOT_FOUND]);
    expect([byLines.status, byLines.body.error], JSON.stringify(byLines.body).slice(0, 300)).toEqual([422, NOT_FOUND]);
    expect((await kit.call("GET", "/purchase-returns/VIS-P-R1")).status).toBe(404);
    expect((await purchaseByLines("VIS-P-OK")).status).toBe(201);
  });
});

describe("a purchase-returns role reads the source invoices of the warehouses it is granted, and no others", () => {
  async function clerk(method: string, path: string, body: unknown, warehouseScope: readonly string[] | typeof ALL_SCOPE, permissions: readonly string[] = RETURNS_CLERK) {
    const bearer = kit.backend.sessions.issue({ userId: "RETURNS-CLERK", permissions, roleCode: null, branchScope: ALL_SCOPE, warehouseScope });
    const res = await kit.backend.app.fetch(
      new Request(`http://local${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, "x-branch-scope": "*", "x-warehouse-scope": "*" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  const draft = (id: string) => ({
    id, date: TODAY, memo: "",
    lines: [{ itemId: "ITEM-DEMO-2", warehouseId: "WH-MAIN", supplierId: "SUPP-DEMO-1", sourceInvoiceId: "VIS-P", sourceInvoiceNumber: null, sourceLineId: "0", reason: "DEFECTIVE", qty: "1" }],
  });

  it("reads the lines and raises the return when the invoice's warehouse is one it is granted", async () => {
    const lines = await clerk("GET", "/purchase-returns/source-lines/VIS-P", undefined, ["WH-MAIN"]);
    expect([lines.status, lines.body.lines?.length], JSON.stringify(lines.body)).toEqual([200, 1]);
    const raised = await clerk("POST", "/purchase-returns", draft("VIS-P-WH-1"), ["WH-MAIN"]);
    expect(raised.status, JSON.stringify(raised.body).slice(0, 300)).toBe(201);
  });

  it("is refused, as if the invoice did not exist, for a warehouse outside its grant and when it holds no explicit grant at all", async () => {
    for (const scope of [["WH-ELSEWHERE"], ALL_SCOPE] as const) {
      const lines = await clerk("GET", "/purchase-returns/source-lines/VIS-P", undefined, scope);
      expect([lines.status, lines.body.error], JSON.stringify(scope)).toEqual([404, NOT_FOUND]);
      const raised = await clerk("POST", "/purchase-returns", draft(`VIS-P-WH-X-${String(scope)}`), scope);
      expect([raised.status, raised.body.error], JSON.stringify(scope)).toEqual([422, NOT_FOUND]);
    }
  });

  it("opens the source lookup only: the invoice itself, its list and a caller who cannot raise a return stay closed", async () => {
    expect((await clerk("GET", "/purchases/invoices/VIS-P", undefined, ["WH-MAIN"])).status).toBe(404);
    const listed = await clerk("GET", "/purchases/invoices", undefined, ["WH-MAIN"]);
    const rows: { id: string }[] = Array.isArray(listed.body) ? listed.body : (listed.body?.items ?? []);
    expect(rows.map((row) => row.id)).not.toContain("VIS-P");
    expect((await clerk("GET", "/purchase-returns/source-lines/VIS-P", undefined, ["WH-MAIN"], ["purchases.return.view"])).status).toBe(403);
  });

  it("keeps the sales rule as it is: a warehouse grant opens no sales invoice to a returns role", async () => {
    const lines = await clerk("GET", "/sales-returns/source-lines/VIS-S", undefined, ["WH-MAIN"], ["sales.return.create", "sales.return.view_own"]);
    expect([lines.status, lines.body.error]).toEqual([404, NOT_FOUND]);
  });
});

