import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
