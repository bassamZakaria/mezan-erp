import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { SalesReturnLine } from "../sales-returns/sales-return-document.js";
import type { PurchaseReturnLine } from "../purchase-returns/purchase-return-document.js";
import { runReport } from "./engine.js";
import { createReturnsFxFaceValueReport, type ReturnDocumentLike, type ReturnsFxFaceValueContext } from "./returns-fx-face-value.js";

function salesLine(overrides: Partial<SalesReturnLine> = {}): SalesReturnLine {
  return {
    itemId: "SVC",
    warehouseId: "WH",
    customerId: "CUST",
    sourceInvoiceId: "SI-CHF",
    sourceInvoiceNumber: "INV-9",
    reason: "OTHER",
    availableQty: Qty.fromMajor("2"),
    qty: Qty.fromMajor("1"),
    unitPrice: Money.fromMajor("50"),
    unitCost: Money.zero(),
    taxAmount: Money.zero(),
    ...overrides,
  };
}

function purchaseLine(overrides: Partial<PurchaseReturnLine> = {}): PurchaseReturnLine {
  return {
    itemId: "STK",
    warehouseId: "WH",
    supplierId: "SUP",
    sourceInvoiceId: "PI-CHF",
    sourceInvoiceNumber: "PI-9",
    reason: "DEFECTIVE",
    availableQty: Qty.fromMajor("10"),
    qty: Qty.fromMajor("2"),
    unitCost: Money.fromMajor("5"),
    taxAmount: Money.fromMajor("1.40"),
    ...overrides,
  };
}

function doc<L>(id: string, lines: L[], status = "confirmed"): ReturnDocumentLike<L> {
  return { id, docNo: id, date: "2026-08-24", status, lines };
}

function context(overrides: Partial<ReturnsFxFaceValueContext> = {}): ReturnsFxFaceValueContext {
  return {
    salesReturns: [
      doc("SR-OLD", [salesLine()]),
      doc("SR-NEW", [salesLine({ currency: "CHF", fxRate: "60" })]),
      doc("SR-REVERSED", [salesLine()], "reversed"),
      doc("SR-EGP", [salesLine({ sourceInvoiceId: "SI-EGP" })]),
    ],
    purchaseReturns: [doc("PR-OLD", [purchaseLine()]), doc("PR-NEW", [purchaseLine({ currency: "CHF", fxRate: "60" })])],
    salesInvoices: new Map([["SI-CHF", { number: "INV-9", currency: "CHF", fxRate: "60", partyId: "CUST" }]]),
    purchaseInvoices: new Map([["PI-CHF", { number: "PI-9", currency: "CHF", fxRate: "60", partyId: "SUP" }]]),
    partyNames: new Map([["CUST", "عميل بالفرنك"], ["SUP", "مورد بالفرنك"]]),
    ...overrides,
  };
}

describe("returns posted at a foreign invoice's face value (D222)", () => {
  const definition = createReturnsFxFaceValueReport();

  it("lists only confirmed returns that posted a foreign invoice's digits as base, with what they misstated", () => {
    const outcome = runReport(definition, definition.defaultParams, context());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((row) => row.returnNo)).toEqual(["PR-OLD", "SR-OLD"]);
    const sales = outcome.rows.find((row) => row.returnNo === "SR-OLD")!;
    expect(sales).toMatchObject({ kind: "sales", partyName: "عميل بالفرنك", invoiceNo: "INV-9", currency: "CHF", postedBase: 50, correctBase: 3000, misstatement: 2950 });
    const purchase = outcome.rows.find((row) => row.returnNo === "PR-OLD")!;
    expect(purchase).toMatchObject({ kind: "purchase", postedBase: 11.4, correctBase: 684, misstatement: 672.6 });
    expect(outcome.grandTotals.misstatement).toBe(3622.6);
  });

  it("narrows by kind, and a tenant whose returns all carry their rate is the clean, empty reading", () => {
    const sales = runReport(definition, { kind: "sales" }, context());
    expect(sales.ok && sales.rows.map((row) => row.returnNo)).toEqual(["SR-OLD"]);
    const clean = runReport(definition, definition.defaultParams, context({ salesReturns: [], purchaseReturns: [doc("PR-NEW", [purchaseLine({ currency: "CHF", fxRate: "60" })])] }));
    expect(clean.ok && clean.rows).toEqual([]);
  });
});
