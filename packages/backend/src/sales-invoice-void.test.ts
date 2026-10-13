import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, rowsOf, type BackendKit } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const STOCK_ITEM = "ITEM-DEMO-2";
const WAREHOUSE = "WH-MAIN";
const BUSINESS_CUSTOMER = "CUST-DEMO-1";

let kit: BackendKit;

async function confirmedStockSale(id: string, line: Record<string, unknown> = {}) {
  const created = await kit.call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId: BUSINESS_CUSTOMER, customerNameAr: "عميل", warehouseId: WAREHOUSE, branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "A", itemId: STOCK_ITEM, itemNameAr: "صنف", isStock: true, qty: "2", unitPrice: "100", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14", ...line }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const confirmed = await kit.call("POST", `/sales-invoices/${id}/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  return (await kit.call("GET", `/sales-invoices/${id}`)).body;
}

const balance = async () => (await kit.call("GET", `/inventory/balance?itemId=${STOCK_ITEM}&warehouseId=${WAREHOUSE}`)).body;

async function submissionOf(docNo: string) {
  await kit.backend.drain();
  return rowsOf((await kit.call("GET", "/eta/submissions?pageSize=500")).body).find((row) => row.internalId === docNo) ?? null;
}

beforeAll(async () => {
  kit = await bootBackendKit();
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("voiding a confirmed stock invoice", () => {
  it("puts the goods back at the cost they left at, with the reversal, in one act", async () => {
    const before = await balance();
    const ledgerBefore = await kit.invariants();
    const invoice = await confirmedStockSale("VOID-STOCK-1");
    const issued = await balance();
    expect(issued.onHand).not.toBe(before.onHand);

    const voided = await kit.call("POST", "/sales-invoices/VOID-STOCK-1/void", { reason: "خطأ" });
    expect([voided.status, voided.body.status], JSON.stringify(voided.body)).toEqual([200, "reversed"]);

    const after = await balance();
    expect([after.onHand, after.totalValue, after.averageCost]).toEqual([before.onHand, before.totalValue, before.averageCost]);
    expect((await kit.journalLines(voided.body.reversalJournalEntryId)).length).toBe((await kit.journalLines(invoice.journalEntryId)).length);
    expect(await kit.invariants()).toEqual(ledgerBefore);
  });

  it("puts back the pieces a line sold by the carton issued, so quantity and average cost stand where they stood", async () => {
    const before = await balance();
    const ledgerBefore = await kit.invariants();
    await confirmedStockSale("VOID-CARTON-1", { qty: "1", unitFactor: 12, unitPrice: "1200" });
    const issued = await balance();
    expect(Number(before.onHand) - Number(issued.onHand)).toBe(12);

    const voided = await kit.call("POST", "/sales-invoices/VOID-CARTON-1/void", { reason: "خطأ" });
    expect([voided.status, voided.body.status], JSON.stringify(voided.body)).toEqual([200, "reversed"]);

    const after = await balance();
    expect([after.onHand, after.totalValue, after.averageCost]).toEqual([before.onHand, before.totalValue, before.averageCost]);
    expect(await kit.invariants()).toEqual(ledgerBefore);
  });

  it("writes nothing when the reversal is refused: the goods stay out and the invoice stays confirmed", async () => {
    const invoice = await confirmedStockSale("VOID-STOCK-2");
    const issued = await balance();
    const paid = await kit.call("POST", "/sales-invoices/VOID-STOCK-2/payments", { amount: "10", treasuryAccountId: "TR-DEMO-CASH", paymentMethod: "cash" });
    expect(paid.status).toBe(200);
    const refused = await kit.call("POST", "/sales-invoices/VOID-STOCK-2/void", { reason: "خطأ" });
    expect([refused.status, refused.body.error]).toEqual([409, "INVOICE_HAS_COLLECTIONS"]);
    expect((await balance()).onHand).toBe(issued.onHand);
    expect(await kit.journalLines(`${invoice.id}:void`)).toHaveLength(0);
  });

  it("takes its not-yet-sent e-invoice out of the queue in the same act", async () => {
    const invoice = await confirmedStockSale("VOID-ETA-1");
    const queued = await submissionOf(invoice.docNo);
    expect(queued?.status).toBe("ready");
    const voided = await kit.call("POST", "/sales-invoices/VOID-ETA-1/void", { reason: "خطأ" });
    expect(voided.status).toBe(200);
    const after = await submissionOf(invoice.docNo);
    expect(after?.status).toBe("excluded");
    expect(after?.exclusionReason).toContain(invoice.docNo);
  });
});

describe("the reason a sale was voided", () => {
  it("is required, and a void without one moves nothing", async () => {
    const invoice = await confirmedStockSale("VOID-WHY-0");
    for (const body of [{}, { reason: "" }, { reason: "   " }]) {
      const refused = await kit.call("POST", "/sales-invoices/VOID-WHY-0/void", body);
      expect([refused.status, refused.body.error], JSON.stringify(refused.body)).toEqual([400, "VOID_REASON_REQUIRED"]);
      expect(refused.body.message).toMatch(/[\u0600-\u06FF]/);
      expect(refused.body.messageEn).toBeTruthy();
    }
    expect((await kit.call("GET", "/sales-invoices/VOID-WHY-0")).body.status).toBe("confirmed");
    expect(await kit.journalLines(`${invoice.id}:void`)).toHaveLength(0);
  });

  it("is written to the audit row and shown on the document", async () => {
    await confirmedStockSale("VOID-WHY-1");
    const voided = await kit.call("POST", "/sales-invoices/VOID-WHY-1/void", { reason: "  صدرت للعميل الخطأ  " });
    expect([voided.status, voided.body.voidReason], JSON.stringify(voided.body)).toEqual([200, "صدرت للعميل الخطأ"]);
    expect((await kit.call("GET", "/sales-invoices/VOID-WHY-1")).body.voidReason).toBe("صدرت للعميل الخطأ");
    expect((await kit.auditRows("SALES_INVOICE", "VOID-WHY-1", "VOID")).map((row) => row.details.reason)).toEqual(["صدرت للعميل الخطأ"]);
  });
});

describe("a line sold by the carton, everywhere its quantity is read", () => {
  const reserved = async () =>
    rowsOf((await kit.call("GET", `/inventory/stock-balance?warehouseId=${WAREHOUSE}`)).body).find((row) => row.itemId === STOCK_ITEM)?.reserved;

  it("reserves its pieces while it is a draft", async () => {
    const before = Number(await reserved());
    const created = await kit.call("POST", "/sales-invoices", {
      id: "CARTON-DRAFT-1", date: TODAY, dueDate: "2026-09-23", customerId: BUSINESS_CUSTOMER, customerNameAr: "عميل", warehouseId: WAREHOUSE, branchId: "BR-MAIN",
      arAccountId: "1105", taxAccountId: "2200",
      lines: [{ lineId: "A", itemId: STOCK_ITEM, itemNameAr: "صنف", isStock: true, qty: "1", unitFactor: 12, unitPrice: "1200", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(Number(await reserved()) - before).toBe(12);
    expect((await kit.call("POST", "/sales-invoices/CARTON-DRAFT-1/cancel", {})).status).toBe(200);
  });

  it("is returned in pieces: a full return puts all twelve back and the ledger still agrees", async () => {
    const before = await balance();
    const ledgerBefore = await kit.invariants();
    await confirmedStockSale("CARTON-RET-1", { qty: "1", unitFactor: 12, unitPrice: "1200" });
    const drafted = await kit.call("POST", "/sales-returns/from-invoice", {
      id: "CARTON-RET-1-R", date: TODAY, memo: "", warehouseId: WAREHOUSE, sourceInvoiceId: "CARTON-RET-1", reason: "DEFECTIVE",
      requested: [{ itemId: STOCK_ITEM, sourceLineId: "A", qty: "12" }],
    });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    expect((await kit.call("POST", "/sales-returns/CARTON-RET-1-R/confirm", {})).status).toBe(200);
    const after = await balance();
    expect([after.onHand, after.totalValue, after.averageCost]).toEqual([before.onHand, before.totalValue, before.averageCost]);
    const ledgerAfter = await kit.invariants();
    expect([ledgerAfter.tb, ledgerAfter.inventory]).toEqual([ledgerBefore.tb, ledgerBefore.inventory]);
    const over = await kit.call("POST", "/sales-returns/from-invoice", {
      id: "CARTON-RET-1-R2", date: TODAY, memo: "", warehouseId: WAREHOUSE, sourceInvoiceId: "CARTON-RET-1", reason: "DEFECTIVE",
      requested: [{ itemId: STOCK_ITEM, sourceLineId: "A", qty: "1" }],
    });
    expect(over.status).toBeGreaterThanOrEqual(400);
  });
});

describe("voiding an invoice a confirmed return stands against", () => {
  it("is refused with both ways forward: void the return first, or return the rest", async () => {
    await confirmedStockSale("VOID-RET-1");
    const drafted = await kit.call("POST", "/sales-returns/from-invoice", {
      id: "VOID-RET-1-R", date: TODAY, memo: "", warehouseId: WAREHOUSE, sourceInvoiceId: "VOID-RET-1", reason: "DEFECTIVE",
      requested: [{ itemId: STOCK_ITEM, sourceLineId: "A", qty: "1" }],
    });
    expect(drafted.status).toBe(201);
    expect((await kit.call("POST", "/sales-returns/VOID-RET-1-R/confirm", {})).status).toBe(200);
    const undo = await kit.call("POST", "/sales-returns/VOID-RET-1-R/cancel", {});
    expect(undo.status).toBeGreaterThanOrEqual(400);
    const refused = await kit.call("POST", "/sales-invoices/VOID-RET-1/void", { reason: "خطأ" });
    expect([refused.status, refused.body.error]).toEqual([409, "INVOICE_HAS_RETURNS"]);
    expect(refused.body.message).toContain("بمرتجع عن باقي كمياتها");
    expect(refused.body.message).toContain("ألغِ المرتجع أولاً");
    expect((await kit.call("POST", "/sales-returns/VOID-RET-1-R/void", { reason: "خطأ" })).status).toBe(200);
    expect((await kit.call("POST", "/sales-invoices/VOID-RET-1/void", { reason: "خطأ" })).body.status).toBe("reversed");
  });
});
