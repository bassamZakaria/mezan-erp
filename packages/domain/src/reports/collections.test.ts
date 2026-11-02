import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { runReport } from "./engine.js";
import { InvoiceRepRole } from "../sales-invoices/sales-invoice.js";
import {
  UNASSIGNED_COLLECTION_KEY,
  createCollectionsReport,
  createMonthlyCollectionsByRepReport,
  type CollectionInvoiceReps,
  type CollectionReportVoucher,
  type CollectionsContext,
} from "./collections.js";

const m = (v: string) => Money.fromMajor(v);

function reps(docNo: string, salesRep: string | null, promotionRep: string | null = null): CollectionInvoiceReps {
  return {
    docNo,
    salespersonId: salesRep,
    salespersonNameAr: salesRep ? `بائع ${salesRep}` : null,
    salesManagerId: null,
    salesManagerNameAr: null,
    promotionRepId: promotionRep,
    promotionRepNameAr: promotionRep ? `دعاية ${promotionRep}` : null,
    promotionManagerId: null,
    promotionManagerNameAr: null,
  };
}

function voucher(o: Partial<CollectionReportVoucher> & Pick<CollectionReportVoucher, "voucherId">): CollectionReportVoucher {
  return {
    voucherNo: o.voucherId.toUpperCase(),
    date: "2026-08-10",
    branchId: "b1",
    customerId: "c1",
    customerNameAr: "صيدلية النور",
    gross: m("0"),
    commission: m("0"),
    allocations: [],
    ...o,
    postedCredit: o.postedCredit ?? o.gross ?? m("0"),
  };
}

const ctx: CollectionsContext = {
  invoices: new Map([
    ["i1", reps("INV-1", "r1", "p1")],
    ["i2", reps("INV-2", "r2")],
    ["i3", reps("INV-3", null)],
  ]),
  vouchers: [
    voucher({ voucherId: "v1", gross: m("1000"), commission: m("10"), allocations: [{ invoiceId: "i1", amount: m("333.33") }, { invoiceId: "i2", amount: m("666.67") }] }),
    voucher({ voucherId: "v2", date: "2026-08-20", customerId: "c2", customerNameAr: "صيدلية الأمل", gross: m("500"), commission: m("0.01"), allocations: [{ invoiceId: "i2", amount: m("200") }] }),
    voucher({ voucherId: "v3", date: "2026-09-02", gross: m("300"), allocations: [{ invoiceId: "i3", amount: m("300") }] }),
  ],
};

function rowsOf<R>(outcome: { readonly ok: true; readonly rows: readonly R[] } | { readonly ok: false }): readonly R[] {
  if (!outcome.ok) throw new Error("report refused its params");
  return outcome.rows;
}

describe("collections report (#117, #118)", () => {
  const report = createCollectionsReport("2026-08-01", "2026-09-30");

  it("splits every voucher across the invoices it settled, with the unapplied rest as its own share, and each column adds up to the voucher exactly", () => {
    const outcome = runReport(report, report.defaultParams, ctx);
    const rows = rowsOf(outcome);
    expect(rows.map((r) => [r.voucherId, r.invoiceNo, r.repId, r.gross, r.commission, r.net])).toEqual([
      ["v1", "INV-1", "r1", "333.330000", "3.330000", "330.000000"],
      ["v1", "INV-2", "r2", "666.670000", "6.670000", "660.000000"],
      ["v2", "INV-2", "r2", "200.000000", "0.000000", "200.000000"],
      ["v2", "غير مخصص على فاتورة", UNASSIGNED_COLLECTION_KEY, "300.000000", "0.010000", "299.990000"],
      ["v3", "INV-3", UNASSIGNED_COLLECTION_KEY, "300.000000", "0.000000", "300.000000"],
    ]);
    if (!outcome.ok) return;
    expect(outcome.reconciliation).toMatchObject({ reportTotal: "1800.000000", referenceTotal: "1800.000000", withinTolerance: true });
    expect(outcome.kpis.find((k) => k.key === "commission")?.value).toBe("10.010000");
  });

  it("splits the commission in whole piastres, so every displayed column adds up to its total", () => {
    const even = {
      ...ctx,
      vouchers: [
        voucher({
          voucherId: "v7",
          gross: m("999.99"),
          commission: m("10"),
          allocations: [{ invoiceId: "i1", amount: m("333.33") }, { invoiceId: "i2", amount: m("333.33") }, { invoiceId: "i3", amount: m("333.33") }],
        }),
      ],
    };
    const rows = rowsOf(runReport(report, report.defaultParams, even));
    expect(rows.map((r) => r.commission)).toEqual(["3.340000", "3.330000", "3.330000"]);
    expect(rows.map((r) => r.net)).toEqual(["329.990000", "330.000000", "330.000000"]);
    const sum = (k: "gross" | "commission" | "net") => Money.sum(rows.map((r) => m(r[k]))).toString();
    expect([sum("gross"), sum("commission"), sum("net")]).toEqual(["999.990000", "10.000000", "989.990000"]);
  });

  it("merges two allocations of one voucher to the same invoice into one row with a unique key", () => {
    const twice = {
      ...ctx,
      vouchers: [voucher({ voucherId: "v8", gross: m("150"), commission: m("1.50"), allocations: [{ invoiceId: "i1", amount: m("100") }, { invoiceId: "i1", amount: m("50") }] })],
    };
    const rows = rowsOf(runReport(report, report.defaultParams, twice));
    expect(rows.map((r) => [r.key, r.invoiceNo, r.gross, r.commission, r.net])).toEqual([["v8:i1", "INV-1", "150.000000", "1.500000", "148.500000"]]);
  });

  it("narrows to one customer (pharmacy) and to one rep", () => {
    expect(rowsOf(runReport(report, { ...report.defaultParams, customerId: "c2" }, ctx)).map((r) => r.voucherId)).toEqual(["v2", "v2"]);
    const byRep = runReport(report, { ...report.defaultParams, repId: "r2" }, ctx);
    expect(rowsOf(byRep).map((r) => [r.voucherId, r.gross])).toEqual([["v1", "666.670000"], ["v2", "200.000000"]]);
    if (byRep.ok) expect(byRep.reconciliation).toBeNull();
  });

  it("flags a collection whose posted credit to the customer differs from what the report counts", () => {
    const off = { ...ctx, vouchers: [voucher({ voucherId: "v9", gross: m("100"), postedCredit: m("90") })] };
    const outcome = runReport(report, report.defaultParams, off);
    if (!outcome.ok) throw new Error("report refused its params");
    expect(outcome.reconciliation).toMatchObject({ reportTotal: "100.000000", referenceTotal: "90.000000", withinTolerance: false });
  });

  it("attributes by the chosen role on the invoice", () => {
    const rows = rowsOf(runReport(report, { ...report.defaultParams, repRole: InvoiceRepRole.PromotionRep, repId: "p1" }, ctx));
    expect(rows.map((r) => [r.invoiceNo, r.repNameAr])).toEqual([["INV-1", "دعاية p1"]]);
  });

  it("totals each rep per month", () => {
    const monthly = createMonthlyCollectionsByRepReport("2026-08-01", "2026-09-30");
    const rows = rowsOf(runReport(monthly, monthly.defaultParams, ctx));
    expect(rows.map((r) => [r.month, r.repId, r.voucherCount, r.gross, r.commission, r.net])).toEqual([
      ["2026-08", "r1", 1, "333.330000", "3.330000", "330.000000"],
      ["2026-08", "r2", 2, "866.670000", "6.670000", "860.000000"],
      ["2026-08", UNASSIGNED_COLLECTION_KEY, 1, "300.000000", "0.010000", "299.990000"],
      ["2026-09", UNASSIGNED_COLLECTION_KEY, 1, "300.000000", "0.000000", "300.000000"],
    ]);
  });
});
