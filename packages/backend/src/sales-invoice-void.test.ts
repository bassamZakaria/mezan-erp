import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, rowsOf, type BackendKit } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const STOCK_ITEM = "ITEM-DEMO-2";
const WAREHOUSE = "WH-MAIN";
const BUSINESS_CUSTOMER = "CUST-DEMO-1";

let kit: BackendKit;

async function confirmedStockSale(id: string) {
  const created = await kit.call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId: BUSINESS_CUSTOMER, customerNameAr: "عميل", warehouseId: WAREHOUSE, branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "A", itemId: STOCK_ITEM, itemNameAr: "صنف", isStock: true, qty: "2", unitPrice: "100", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
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
