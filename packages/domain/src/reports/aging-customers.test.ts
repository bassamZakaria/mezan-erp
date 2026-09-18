import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { agingBucketsTotal, createAgingCustomersReport, customerAgingBalances } from "./aging-customers.js";
import type { SalesInvoice, SalesInvoiceLine } from "../sales-invoices/sales-invoice.js";

function line(overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return { lineId: "l1", itemId: "item-1", itemNameAr: "صنف", isStock: true, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("200.00"), discountPercent: 0, taxRatePercent: 0, revenueAccountId: "4100", cogsAccountId: null, inventoryAccountId: null, costCenterId: null, unitCost: null, unitCode: "", unitFactor: 1, discountType: "percent" as const, discountAmount: Money.zero(), ...overrides, baseQty: overrides.baseQty ?? overrides.qty ?? Qty.fromMajor("1") };
}
function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: "inv-1", docType: "SALES_INVOICE", docNo: "INV-1", status: "confirmed", date: "2026-06-01", dueDate: "2026-06-15", customerId: "c1", customerNameAr: "عميل أ",
    customerTaxExempt: false, taxInclusive: false, warehouseId: "wh-1", branchId: "br-1", salespersonId: null, salespersonNameAr: null, projectId: null, couponCode: null, appliedPromotion: null, currency: "EGP", notes: null, internalNotes: null, discount: { type: "amount", amount: Money.zero() },
    arAccountId: "1120", taxAccountId: "2200", lines: [line()], amountPaid: Money.zero(), createdAt: "2026-06-01T00:00:00.000Z", confirmedAt: "2026-06-01T00:00:00.000Z",
    journalEntryId: null, workflowRequestId: null, reversesInvoiceId: null, reversedByInvoiceId: null, ...overrides,
  };
}

describe("createAgingCustomersReport", () => {
  it("buckets an invoice not yet due as 'current'", () => {
    const definition = createAgingCustomersReport("2026-08-22");
    const outcome = runReport(definition, { asOfDate: "2026-06-05" }, { invoices: [invoice()] }); // asOf before dueDate
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.current).toBe(200);
  });

  it("buckets 68 days past due into 61-90", () => {
    // dueDate 2026-06-15 -> asOfDate 2026-08-22 = 68 days
    const definition = createAgingCustomersReport("2026-08-22");
    const outcome = runReport(definition, { asOfDate: "2026-08-22" }, { invoices: [invoice()] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.d61to90).toBe(200);
    expect(outcome.rows[0]?.current).toBe(0);
    expect(outcome.rows[0]?.total).toBe(200);
  });

  it("buckets 130 days past due as over120", () => {
    const definition = createAgingCustomersReport("2026-10-23");
    const outcome = runReport(definition, { asOfDate: "2026-10-23" }, { invoices: [invoice()] }); // 2026-06-15 -> 2026-10-23 = 130 days
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.over120).toBe(200);
  });

  it("subtracts amountPaid from the outstanding balance", () => {
    const definition = createAgingCustomersReport("2026-08-22");
    const outcome = runReport(definition, { asOfDate: "2026-08-22" }, { invoices: [invoice({ amountPaid: Money.fromMajor("200.00") })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0); // fully paid, no outstanding row
  });

  it("excludes draft and cancelled invoices, and invoices dated after asOfDate", () => {
    const definition = createAgingCustomersReport("2026-08-22");
    const outcome = runReport(
      definition,
      { asOfDate: "2026-08-22" },
      { invoices: [invoice({ id: "draft", status: "draft" }), invoice({ id: "future", date: "2026-09-01" })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("sums multiple invoices for the same customer into one row", () => {
    const definition = createAgingCustomersReport("2026-08-22");
    const outcome = runReport(
      definition,
      { asOfDate: "2026-08-22" },
      { invoices: [invoice({ id: "i1" }), invoice({ id: "i2", dueDate: "2026-06-20" })] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.total).toBe(400);
  });
});

describe("createAgingCustomersReport — the tie to the AR control account (D112)", () => {
  /**
   * The ladder walks invoices; GL 1120 holds what those invoices, their
   * collections and their returns actually posted. Declaring no
   * `reconciliation` meant the first report an accountant opens agreed only
   * with itself.
   */
  const definition = createAgingCustomersReport("2026-08-22");
  const twoInvoices = [
    invoice({ id: "inv-1", customerId: "c1", lines: [line({ unitPrice: Money.fromMajor("1250.50") })] }),
    invoice({ id: "inv-2", customerId: "c2", customerNameAr: "عميل ب", lines: [line({ unitPrice: Money.fromMajor("3400.00") })] }),
  ];

  it("ties when the ladder and the control account hold the same NON-ZERO balance", () => {
    const outcome = runReport(
      definition,
      { asOfDate: "2026-08-22" },
      { invoices: twoInvoices, receivablesControlBalance: () => 4650.5 },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.reconciliation?.reportTotal).toBe(4650.5);
    expect(outcome.reconciliation?.referenceTotal).toBe(4650.5);
    expect(outcome.reconciliation?.diff).toBe(0);
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
  });

  it("flags the difference when a collection hit the GL and never reached the ladder", () => {
    // 1,000.00 was collected and posted to the GL but no allocation reached
    // the report, so the ladder still shows the debt. This is exactly the
    // condition the banner exists to catch, and the one nothing detected.
    const outcome = runReport(
      definition,
      { asOfDate: "2026-08-22" },
      { invoices: twoInvoices, receivablesControlBalance: () => 3650.5 },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.reconciliation?.reportTotal).toBe(4650.5);
    expect(outcome.reconciliation?.referenceTotal).toBe(3650.5);
    expect(outcome.reconciliation?.diff).toBe(1000);
    expect(outcome.reconciliation?.withinTolerance).toBe(false);
  });

  it("recomputes the reference against the params the report RAN with, not its defaults", () => {
    // A reference total computed over the default period would silently stop
    // matching the moment the user moved the date.
    const seen: string[] = [];
    runReport(
      definition,
      { asOfDate: "2026-10-23" },
      {
        invoices: twoInvoices,
        receivablesControlBalance: (params) => {
          seen.push(params.asOfDate);
          return 4650.5;
        },
      },
    );
    expect(seen).toEqual(["2026-10-23"]);
  });
});

describe("a reconciliation whose reference is not wired shows no banner (D112)", () => {
  it("returns null rather than comparing a real total against a defaulted zero", () => {
    // The aging ladder is where this bites: a banner that reads
    // "4,650.50 vs 0.00 — mismatch" on every single run trains everyone to
    // ignore it, which is worse than having none.
    const definition = createAgingCustomersReport("2026-08-22");
    const outcome = runReport(definition, { asOfDate: "2026-08-22" }, { invoices: [invoice()] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.total).toBe(200);
    expect(outcome.reconciliation).toBeNull();
  });
});

describe("createAgingCustomersReport — foreign invoices and leftover credits (D194, D195)", () => {
  const definition = createAgingCustomersReport("2026-08-22");

  it("ages a USD 100 invoice booked at 48.00 at the 4,800.00 it debited 1105 with", () => {
    const outcome = runReport(
      definition,
      { asOfDate: "2026-06-05" },
      { invoices: [invoice({ currency: "USD", fxRate: "48.00", lines: [line({ unitPrice: Money.fromMajor("100") })] })], receivablesControlBalance: () => 4800 },
    );
    if (!outcome.ok) throw new Error("report failed");
    expect(outcome.rows[0]?.total).toBe(4800);
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
  });

  it("keeps an on-account receipt larger than the debt as a negative «جاري», and gives a credit-only customer a row", () => {
    const outcome = runReport(
      definition,
      { asOfDate: "2026-06-05" },
      {
        invoices: [invoice()],
        customers: [{ id: "c1", nameEn: null }, { id: "c2", nameAr: "عميل ب", nameEn: null }],
        unappliedCreditsByCustomerId: new Map([["c1", Money.fromMajor("250")], ["c2", Money.fromMajor("30")]]),
        receivablesControlBalance: () => -80,
      },
    );
    if (!outcome.ok) throw new Error("report failed");
    expect(outcome.rows.find((r) => r.customerId === "c1")).toMatchObject({ current: -50, total: -50 });
    expect(outcome.rows.find((r) => r.customerId === "c2")).toMatchObject({ customerNameAr: "عميل ب", total: -30 });
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
  });

  it("does not invent a row for a credit when the ladder is narrowed to a branch", () => {
    const outcome = runReport(
      definition,
      { asOfDate: "2026-06-05", branchId: "br-1" },
      { invoices: [invoice()], unappliedCreditsByCustomerId: new Map([["c2", Money.fromMajor("30")]]) },
    );
    if (!outcome.ok) throw new Error("report failed");
    expect(outcome.rows.map((r) => r.customerId)).toEqual(["c1"]);
  });

  it("the customers screen's figure is the ladder row itself (D195)", () => {
    const ctx = { invoices: [invoice()], unappliedCreditsByCustomerId: new Map([["c1", Money.fromMajor("100")]]) };
    const balances = customerAgingBalances({ asOfDate: "2026-08-22", branchId: "" }, ctx);
    const outcome = runReport(definition, { asOfDate: "2026-08-22" }, ctx);
    if (!outcome.ok) throw new Error("report failed");
    expect(agingBucketsTotal(balances.get("c1")!).toString()).toBe("100.000000");
    expect(outcome.rows[0]?.total).toBe(100);
  });

  it("names the FX revaluation it excluded from the reference, and omits the item when there is none", () => {
    const withItem = runReport(definition, { asOfDate: "2026-06-05" }, { invoices: [invoice()], receivablesControlBalance: () => 200, fxRevaluationOnControl: () => 12.5 });
    const without = runReport(definition, { asOfDate: "2026-06-05" }, { invoices: [invoice()], receivablesControlBalance: () => 200 });
    if (!withItem.ok || !without.ok) throw new Error("report failed");
    expect(withItem.reconciliation?.reconcilingItems).toEqual([expect.objectContaining({ key: "fxRevaluation", amount: 12.5 })]);
    expect(without.reconciliation).not.toHaveProperty("reconcilingItems");
  });
});
