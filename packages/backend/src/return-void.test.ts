import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, rowsOf, type BackendKit } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const STOCK_ITEM = "ITEM-DEMO-2";
const WAREHOUSE = "WH-MAIN";
const CUSTOMER = "CUST-DEMO-1";
const SUPPLIER = "SUPP-DEMO-1";
const REASON = "أُدخل المرتجع على الفاتورة الخطأ";

let kit: BackendKit;

const balance = async () => (await kit.call("GET", `/inventory/balance?itemId=${STOCK_ITEM}&warehouseId=${WAREHOUSE}`)).body;
const position = async () => {
  const b = await balance();
  return [b.onHand, b.totalValue, b.averageCost];
};

async function confirmedSale(id: string, line: Record<string, unknown> = {}) {
  const created = await kit.call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل", warehouseId: WAREHOUSE, branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "A", itemId: STOCK_ITEM, itemNameAr: "صنف", isStock: true, qty: "2", unitPrice: "100", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14", ...line }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await kit.call("POST", `/sales-invoices/${id}/confirm`, {})).status).toBe(200);
}

async function confirmedSalesReturn(id: string, sourceInvoiceId: string, qty: string) {
  const drafted = await kit.call("POST", "/sales-returns/from-invoice", {
    id, date: TODAY, memo: "", warehouseId: WAREHOUSE, sourceInvoiceId, reason: "DEFECTIVE",
    requested: [{ itemId: STOCK_ITEM, sourceLineId: "A", qty }],
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
  const confirmed = await kit.call("POST", `/sales-returns/${id}/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  return confirmed.body.document;
}

async function confirmedPurchase(id: string) {
  const created = await kit.call("POST", "/purchases/invoices", {
    id, supplierId: SUPPLIER, date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: WAREHOUSE,
    lines: [{ itemId: STOCK_ITEM, kind: "inventory", qty: "4", unitCost: "73.37", taxRateId: "VAT14" }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await kit.call("POST", `/purchases/invoices/${id}/confirm`, {})).status).toBe(200);
}

async function confirmedPurchaseReturn(id: string, sourceInvoiceId: string, qty: string) {
  const drafted = await kit.call("POST", "/purchase-returns", {
    id, date: TODAY, memo: "",
    lines: [{ itemId: STOCK_ITEM, warehouseId: WAREHOUSE, supplierId: SUPPLIER, sourceInvoiceId, sourceInvoiceNumber: null, sourceLineId: "0", reason: "DEFECTIVE", qty }],
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
  const confirmed = await kit.call("POST", `/purchase-returns/${id}/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  return confirmed.body.document;
}

const returnedQty = async (mount: string, invoiceId: string) =>
  (await kit.call("GET", `${mount}/source-lines/${invoiceId}`)).body.lines.map((l: { returnedQty: string }) => Number(l.returnedQty));

beforeAll(async () => {
  kit = await bootBackendKit();
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("voiding a confirmed sales return", () => {
  it("puts the invoice, the customer, the stock and the ledger back where they stood, and the lines are returnable again", async () => {
    await confirmedSale("RV-S-1", { qty: "1", unitFactor: 12, unitPrice: "1200" });
    const invoiceBefore = (await kit.call("GET", "/sales-invoices/RV-S-1")).body;
    const stockBefore = await position();
    const ledgerBefore = await kit.invariants();
    const statsBefore = (await kit.call("GET", "/sales-returns/stats")).body;

    const returned = await confirmedSalesReturn("RV-S-1-R", "RV-S-1", "5");
    expect(await returnedQty("/sales-returns", "RV-S-1")).toEqual([5]);
    expect(await position()).not.toEqual(stockBefore);

    const voided = await kit.call("POST", "/sales-returns/RV-S-1-R/void", { reason: REASON });
    expect([voided.status, voided.body.status], JSON.stringify(voided.body)).toEqual([200, "reversed"]);
    expect(voided.body.voidReason).toBe(REASON);

    expect(await returnedQty("/sales-returns", "RV-S-1")).toEqual([0]);
    const invoiceAfter = (await kit.call("GET", "/sales-invoices/RV-S-1")).body;
    expect([invoiceAfter.returnedCredit, invoiceAfter.remainingBalance]).toEqual([invoiceBefore.returnedCredit, invoiceBefore.remainingBalance]);
    expect(await position()).toEqual(stockBefore);
    expect(await kit.invariants()).toEqual(ledgerBefore);
    expect(Object.values(await kit.invariants())).toEqual([0n, 0n, 0n, 0n]);
    expect((await kit.journalLines(voided.body.reversalJournalEntryId)).length).toBe((await kit.journalLines(returned.journalEntryId)).length);

    const statsAfter = (await kit.call("GET", "/sales-returns/stats")).body;
    expect([statsAfter.confirmed, statsAfter.returnedTotal, statsAfter.refundDue]).toEqual([statsBefore.confirmed, statsBefore.returnedTotal, statsBefore.refundDue]);
    const listed = rowsOf((await kit.call("GET", "/sales-returns")).body).filter((row) => row.id.startsWith("RV-S-1-R"));
    expect(listed.map((row) => [row.id, row.status, row.voidReason])).toEqual([["RV-S-1-R", "reversed", REASON]]);
    expect((await kit.call("GET", "/sales-returns/RV-S-1-R")).body.voidReason).toBe(REASON);
    expect((await kit.auditRows("SALES_RETURN", "RV-S-1-R", "REVERSE")).map((row) => row.details.reason)).toEqual([REASON]);

    const again = await confirmedSalesReturn("RV-S-1-R2", "RV-S-1", "12");
    expect(again.status).toBe("confirmed");
    expect(await returnedQty("/sales-returns", "RV-S-1")).toEqual([12]);
  });

  it("takes out exactly the value the return put in when a purchase has moved the average since the sale", async () => {
    await confirmedSale("RV-S-7");
    await confirmedPurchase("RV-S-7-BUY");
    const stockBefore = await position();
    const ledgerBefore = await kit.invariants();
    await confirmedSalesReturn("RV-S-7-R", "RV-S-7", "2");
    const returned = await position();
    expect(returned[2]).not.toBe(stockBefore[2]);
    const voided = await kit.call("POST", "/sales-returns/RV-S-7-R/void", { reason: REASON });
    expect([voided.status, voided.body.status], JSON.stringify(voided.body)).toEqual([200, "reversed"]);
    expect(await position()).toEqual(stockBefore);
    expect(await kit.invariants()).toEqual(ledgerBefore);
    expect((await kit.invariants()).inventory).toBe(0n);
  });

  it("leaves no value on a position its void empties: the last issue out takes what is there and the difference is booked with the reversal", async () => {
    const warehouses = (await kit.call("GET", "/warehouses")).body as { id: string }[];
    const stockAt = async (warehouseId: string) => (await kit.call("GET", `/inventory/balance?itemId=${STOCK_ITEM}&warehouseId=${warehouseId}`)).body;
    let empty: string | undefined;
    for (const warehouse of warehouses) {
      if ((await stockAt(warehouse.id)).onHand === "0.000000") empty ??= warehouse.id;
    }
    expect(empty, "a seeded warehouse holding none of the item").toBeDefined();
    const there = empty as string;
    const buy = async (id: string, qty: string, unitCost: string) => {
      const created = await kit.call("POST", "/purchases/invoices", {
        id, supplierId: SUPPLIER, date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: there,
        lines: [{ itemId: STOCK_ITEM, kind: "inventory", qty, unitCost, taxRateId: "VAT14" }],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect((await kit.call("POST", `/purchases/invoices/${id}/confirm`, {})).status).toBe(200);
    };
    const sell = async (id: string) => {
      const created = await kit.call("POST", "/sales-invoices", {
        id, date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل", warehouseId: there, branchId: "BR-MAIN",
        arAccountId: "1105", taxAccountId: "2200",
        lines: [{ lineId: "A", itemId: STOCK_ITEM, itemNameAr: "صنف", isStock: true, qty: "2", unitPrice: "100", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const confirmed = await kit.call("POST", `/sales-invoices/${id}/confirm`, {});
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    };

    await buy("RV-S-9-BUY-1", "3", "10");
    await sell("RV-S-9");
    await buy("RV-S-9-BUY-2", "1", "40");
    const drafted = await kit.call("POST", "/sales-returns/from-invoice", {
      id: "RV-S-9-R", date: TODAY, memo: "", warehouseId: there, sourceInvoiceId: "RV-S-9", reason: "DEFECTIVE",
      requested: [{ itemId: STOCK_ITEM, sourceLineId: "A", qty: "2" }],
    });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    expect((await kit.call("POST", "/sales-returns/RV-S-9-R/confirm", {})).status).toBe(200);
    await sell("RV-S-9-AGAIN");
    const held = await stockAt(there);
    expect([held.onHand, held.totalValue]).toEqual(["2.000000", "35.000000"]);

    const voided = await kit.call("POST", "/sales-returns/RV-S-9-R/void", { reason: REASON });
    expect([voided.status, voided.body.status], JSON.stringify(voided.body)).toEqual([200, "reversed"]);

    const after = await stockAt(there);
    expect([after.onHand, after.totalValue]).toEqual(["0.000000", "0.000000"]);
    expect(await kit.invariants()).toEqual({ tb: 0n, inventory: 0n, ap: 0n, ar: 0n });
    const reversal = await kit.journalLines(voided.body.reversalJournalEntryId);
    const net = (accountId: string) =>
      reversal.filter((line) => line.accountId === accountId).reduce((sum, line) => sum + BigInt(line.credit.replace(".", "")) - BigInt(line.debit.replace(".", "")), 0n);
    expect([net("1200"), net("5100")]).toEqual([35_000000n, -35_000000n]);
    const valuation = (await kit.call("GET", "/inventory/valuation")).body.rows as { onHand: string; totalValue: string }[];
    expect(valuation.filter((row) => row.onHand === "0.000000" && row.totalValue !== "0.000000")).toEqual([]);
  });

  it("requires a reason and its own permission, and a refusal moves nothing", async () => {
    await confirmedSale("RV-S-2");
    await confirmedSalesReturn("RV-S-2-R", "RV-S-2", "1");
    const stock = await position();
    for (const body of [{}, { reason: "  " }]) {
      const refused = await kit.call("POST", "/sales-returns/RV-S-2-R/void", body);
      expect([refused.status, refused.body.error], JSON.stringify(refused.body)).toEqual([400, "VOID_REASON_REQUIRED"]);
      expect(refused.body.message).toMatch(/[؀-ۿ]/);
    }
    const unpermitted = await kit.call("POST", "/sales-returns/RV-S-2-R/void", { reason: REASON }, ["sales.return.view", "sales.return.confirm", "sales.return.create"]);
    expect(unpermitted.status).toBe(403);
    expect((await kit.call("GET", "/sales-returns/RV-S-2-R")).body.status).toBe("confirmed");
    expect(await position()).toEqual(stock);
  });

  it("is refused while a refund voucher stands against it, and proceeds once the voucher is reversed", async () => {
    await confirmedSale("RV-S-3");
    await confirmedSalesReturn("RV-S-3-R", "RV-S-3", "1");
    const refund = await kit.call("POST", "/sales-returns/RV-S-3-R/refund", { amount: "10", treasuryAccountId: "TR-DEMO-CASH", paymentMethod: "cash" });
    expect(refund.status, JSON.stringify(refund.body)).toBe(200);
    const refused = await kit.call("POST", "/sales-returns/RV-S-3-R/void", { reason: REASON });
    expect([refused.status, refused.body.error], JSON.stringify(refused.body)).toEqual([409, "RETURN_HAS_REFUNDS"]);
    expect(refused.body.message).toContain("اعكس سند");
    expect((await kit.call("GET", "/sales-returns/RV-S-3-R")).body.status).toBe("confirmed");

    const reversed = await kit.call("POST", `/vouchers/${encodeURIComponent(refund.body.voucherId)}/reverse`, {});
    expect(reversed.status, JSON.stringify(reversed.body)).toBeLessThan(300);
    const voided = await kit.call("POST", "/sales-returns/RV-S-3-R/void", { reason: REASON });
    expect([voided.status, voided.body.status], JSON.stringify(voided.body)).toEqual([200, "reversed"]);
  });

  it("is refused a second time, and a draft return is cancelled rather than voided", async () => {
    await confirmedSale("RV-S-4");
    await confirmedSalesReturn("RV-S-4-R", "RV-S-4", "1");
    expect((await kit.call("POST", "/sales-returns/RV-S-4-R/void", { reason: REASON })).status).toBe(200);
    const twice = await kit.call("POST", "/sales-returns/RV-S-4-R/void", { reason: REASON });
    expect([twice.status, twice.body.error], JSON.stringify(twice.body)).toEqual([409, "INVALID_DOCUMENT_TRANSITION"]);
    expect(twice.body.message).toMatch(/[؀-ۿ]/);
  });

  it("lets the invoice be voided once its only return is voided, and the refusal names that path", async () => {
    await confirmedSale("RV-S-5");
    await confirmedSalesReturn("RV-S-5-R", "RV-S-5", "1");
    const refused = await kit.call("POST", "/sales-invoices/RV-S-5/void", { reason: REASON });
    expect([refused.status, refused.body.error]).toEqual([409, "INVOICE_HAS_RETURNS"]);
    expect(refused.body.message).toContain("ألغِ المرتجع");
    expect((await kit.call("POST", "/sales-returns/RV-S-5-R/void", { reason: REASON })).status).toBe(200);
    const voided = await kit.call("POST", "/sales-invoices/RV-S-5/void", { reason: REASON });
    expect([voided.status, voided.body.status], JSON.stringify(voided.body)).toEqual([200, "reversed"]);
  });
});

describe("voiding a confirmed purchase return", () => {
  it("puts the invoice, the supplier, the stock and the ledger back, and the lines are returnable again", async () => {
    await confirmedPurchase("RV-P-1");
    const invoiceBefore = (await kit.call("GET", "/purchases/invoices/RV-P-1")).body;
    const stockBefore = await position();
    const ledgerBefore = await kit.invariants();

    const returned = await confirmedPurchaseReturn("RV-P-1-R", "RV-P-1", "3");
    expect(await returnedQty("/purchase-returns", "RV-P-1")).toEqual([3]);
    expect(await position()).not.toEqual(stockBefore);

    const voided = await kit.call("POST", "/purchase-returns/RV-P-1-R/void", { reason: REASON });
    expect([voided.status, voided.body.status], JSON.stringify(voided.body)).toEqual([200, "reversed"]);
    expect(voided.body.voidReason).toBe(REASON);

    expect(await returnedQty("/purchase-returns", "RV-P-1")).toEqual([0]);
    expect((await kit.call("GET", "/purchases/invoices/RV-P-1")).body.remainingBalance).toBe(invoiceBefore.remainingBalance);
    expect(await position()).toEqual(stockBefore);
    expect(await kit.invariants()).toEqual(ledgerBefore);
    expect(Object.values(await kit.invariants())).toEqual([0n, 0n, 0n, 0n]);
    expect((await kit.journalLines(voided.body.reversalJournalEntryId)).length).toBe((await kit.journalLines(returned.journalEntryId)).length);
    const listed = rowsOf((await kit.call("GET", "/purchase-returns")).body).filter((row) => row.id.startsWith("RV-P-1-R"));
    expect(listed.map((row) => [row.id, row.status, row.voidReason])).toEqual([["RV-P-1-R", "reversed", REASON]]);
    expect((await kit.auditRows("PURCHASE_RETURN", "RV-P-1-R", "REVERSE")).map((row) => row.details.reason)).toEqual([REASON]);

    const again = await confirmedPurchaseReturn("RV-P-1-R2", "RV-P-1", "4");
    expect(again.status).toBe("confirmed");
  });

  it("requires a reason and the void permission", async () => {
    await confirmedPurchase("RV-P-2");
    await confirmedPurchaseReturn("RV-P-2-R", "RV-P-2", "1");
    const refused = await kit.call("POST", "/purchase-returns/RV-P-2-R/void", {});
    expect([refused.status, refused.body.error]).toEqual([400, "VOID_REASON_REQUIRED"]);
    const unpermitted = await kit.call("POST", "/purchase-returns/RV-P-2-R/void", { reason: REASON }, ["purchases.return.view", "purchases.return.confirm"]);
    expect(unpermitted.status).toBe(403);
    expect((await kit.call("GET", "/purchase-returns/RV-P-2-R")).body.status).toBe("confirmed");
  });
});

describe("a void in a month that is shut", () => {
  it("is refused in Arabic when the fiscal period of the day is closed, and proceeds once it reopens", async () => {
    await confirmedPurchase("RV-P-3");
    await confirmedPurchaseReturn("RV-P-3-R", "RV-P-3", "1");
    const september = rowsOf((await kit.call("GET", "/fiscal-periods")).body).find((p) => p.startDate <= "2026-09-10" && p.endDate >= "2026-09-10");
    expect(september, "no period covers 2026-09-10").toBeTruthy();
    const closed = await kit.call("POST", `/fiscal-periods/${september.id}/close`, { overrideReason: "إقفال لاختبار إلغاء المرتجع" });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const stock = await position();
    const refused = await kit.call("POST", "/purchase-returns/RV-P-3-R/void", { reason: REASON, date: "2026-09-10" });
    expect(refused.status, JSON.stringify(refused.body)).toBeGreaterThanOrEqual(400);
    expect(refused.status).toBeLessThan(500);
    expect(refused.body.message).toMatch(/[\u0600-\u06FF]/);
    expect((await kit.call("GET", "/purchase-returns/RV-P-3-R")).body.status).toBe("confirmed");
    expect(await position()).toEqual(stock);
    const reopened = await kit.call("POST", `/fiscal-periods/${september.id}/reopen`, {});
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    const voided = await kit.call("POST", "/purchase-returns/RV-P-3-R/void", { reason: REASON, date: "2026-09-10" });
    expect([voided.status, voided.body.status], JSON.stringify(voided.body)).toEqual([200, "reversed"]);
  });

  it("is refused in Arabic when the VAT return covering the day is filed, and the return stays confirmed", async () => {
    await confirmedSale("RV-S-6");
    await confirmedSalesReturn("RV-S-6-R", "RV-S-6", "1");
    const filed = await kit.call("POST", "/gl/vat-filings", { id: "RV-FILING-AUG", periodFrom: "2026-08-01", periodTo: "2026-08-31", netAmount: "0" });
    expect(filed.status, JSON.stringify(filed.body).slice(0, 300)).toBeLessThan(300);
    const refused = await kit.call("POST", "/sales-returns/RV-S-6-R/void", { reason: REASON, date: TODAY });
    expect([refused.status, refused.body.error], JSON.stringify(refused.body)).toEqual([422, "VAT_PERIOD_ALREADY_FILED"]);
    expect(refused.body.message).toMatch(/[؀-ۿ]/);
    expect((await kit.call("GET", "/sales-returns/RV-S-6-R")).body.status).toBe("confirmed");
  });
});
