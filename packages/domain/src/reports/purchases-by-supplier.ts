import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import { Money } from "../money/index.js";
import { purchaseInvoiceBaseTotal, type PurchaseInvoice } from "../purchasing/purchase-invoice.js";
import type { Supplier } from "../suppliers/supplier.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";
import { withinDateRange } from "./period-bucket.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, matchesBranch } from "./branch-filter.js";

/**
 * المشتريات حسب المورد — Purchases by Supplier (docs/archive/catalog/08-reports.md):
 * supplier concentration and what the period's purchases still owe. «المتبقي من
 * فواتير الفترة» is what each of the period's confirmed invoices still owes —
 * its BASE total less what the allocation sub-ledger settled and less its
 * confirmed returns — the same per-invoice term the supplier aging ladder ages
 * (D217). An invoice returned beyond what it still owed counts as nothing owed,
 * not as a credit: its refund is not in the period's invoice set, so netting it
 * would leave a refunded supplier reading as owing us forever.
 *
 * It is NOT «المستحق»: the supplier's balance is the aging ladder's own row —
 * every open invoice whatever its date, its on-account payments and its opening
 * balance. The two were both labelled «المستحق» and the drill-down panel
 * answered the ladder's figure to a row that showed this one (D286: SUPP-DEMO-1
 * row 2,300.00 vs panel 1,455,097.00). Two facts, two labels.
 */

export interface PurchasesBySupplierContext {
  readonly invoices: readonly PurchaseInvoice[];
  readonly suppliers: readonly Supplier[];
  /** Amount settled per invoice id, from the allocation sub-ledger. */
  readonly allocatedByInvoiceId?: ReadonlyMap<string, Money>;
  /** Confirmed purchase-return debit per SOURCE invoice, in base. */
  readonly returnsByInvoiceId?: ReadonlyMap<string, Money>;
}

/**
 * What ONE confirmed purchase invoice still owes: base total, less the
 * allocation sub-ledger's settlement, less its confirmed returns, floored at
 * nothing owed.
 *
 * Exported because the supplier drill-down panel has to answer the very figure
 * the row it was opened from shows, and a second implementation is how the two
 * drifted apart (D286).
 */
export function purchaseInvoiceRemaining(invoice: PurchaseInvoice, settled: Money, returned: Money): Money {
  const remaining = Money.fromScaled(purchaseInvoiceBaseTotal(invoice).scaled - settled.scaled - returned.scaled);
  return remaining.scaled > 0n ? remaining : Money.zero();
}

/** {@link purchaseInvoiceRemaining} summed over a set of invoices the caller has already filtered. */
export function purchasesRemainingOverPeriod(
  invoices: readonly PurchaseInvoice[],
  allocatedByInvoiceId?: ReadonlyMap<string, Money>,
  returnsByInvoiceId?: ReadonlyMap<string, Money>,
): Money {
  let total = Money.zero();
  for (const invoice of invoices) {
    total = total.add(
      purchaseInvoiceRemaining(
        invoice,
        allocatedByInvoiceId?.get(invoice.id) ?? Money.zero(),
        returnsByInvoiceId?.get(invoice.id) ?? Money.zero(),
      ),
    );
  }
  return total;
}

export interface PurchasesBySupplierParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly branchId: string;
}

export interface PurchasesBySupplierRow {
  readonly supplierId: string;
  readonly supplierNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly supplierNameEn: string | null;
  readonly count: number;
  readonly total: number;
  readonly outstanding: number;
  readonly contributionPercent: number;
}

const paramsSchema = z.object({
  dateFrom: isoDateParamSchema,
  dateTo: isoDateParamSchema,
  branchId: branchIdParamSchema,
});

export function createPurchasesBySupplierReport(
  defaultDateFrom: string,
  defaultDateTo: string,
): ReportDefinition<PurchasesBySupplierParams, PurchasesBySupplierRow, PurchasesBySupplierContext> {
  return {
    id: "purchases.by-supplier",
    titleAr: "المشتريات حسب المورد",
    descriptionAr: "على من نعتمد أكثر في مشترياتنا وما هي المستحقات المتبقية بعد السداد والمرتجعات.",
    paramsSchema,
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, branchId: "" },
    paramFields: [{ kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" }, BRANCH_PARAM_FIELD],
    rowKey: (row) => row.supplierId,
    columns: [
      { key: "supplierNameAr", header: "اسم المورد", format: "text", value: (row) => row.supplierNameAr, entity: { kind: "supplier", id: (row) => row.supplierId } },
      { key: "count", header: "عدد الفواتير", format: "qty", align: "end", total: true, value: (row) => row.count },
      { key: "total", header: "الإجمالي", format: "money", align: "end", total: true, value: (row) => row.total },
      { key: "outstanding", header: "المتبقي من فواتير الفترة", format: "money", align: "end", total: true, value: (row) => row.outstanding },
      { key: "contributionPercent", header: "نسبة المساهمة", format: "share", align: "end", value: (row) => row.contributionPercent },
    ],
    chart: {
      labelColumn: "supplierNameAr",
      valueColumn: "total",
      maxPoints: 8,
      captionAr: "المورّدون مرتبون حسب حجم الإنفاق في الفترة.",
    },
    kpis: [
      { key: "total", labelAr: "إجمالي المشتريات", format: "money", value: (rows) => sumRows(rows, (r) => r.total) },
      { key: "outstanding", labelAr: "المتبقي من فواتير الفترة", format: "money", value: (rows) => sumRows(rows, (r) => r.outstanding), tone: (value) => (value > 0 ? "danger" : "default") },
      { key: "supplierCount", labelAr: "عدد الموردين", format: "qty", value: (rows) => rows.length },
      { key: "topShare", labelAr: "حصة أكبر مورد", format: "percent", value: (rows) => rows[0]?.contributionPercent ?? 0 },
    ],
    run: (params, ctx) => {
      const supplierNames = new Map(ctx.suppliers.map((s) => [s.id, s.nameAr]));
      const supplierNamesEn = new Map(ctx.suppliers.map((s) => [s.id, s.nameEn ?? null]));
      const bySupplier = new Map<string, { count: number; total: Money; outstanding: Money }>();
      for (const invoice of ctx.invoices) {
        if (invoice.status !== "confirmed") continue;
        if (!withinDateRange(invoice.date, params.dateFrom, params.dateTo)) continue;
        if (!matchesBranch(invoice.branchId, params.branchId)) continue;
        const total = purchaseInvoiceBaseTotal(invoice);
        const remaining = purchaseInvoiceRemaining(
          invoice,
          ctx.allocatedByInvoiceId?.get(invoice.id) ?? Money.zero(),
          ctx.returnsByInvoiceId?.get(invoice.id) ?? Money.zero(),
        );
        const existing = bySupplier.get(invoice.supplierId) ?? { count: 0, total: Money.zero(), outstanding: Money.zero() };
        bySupplier.set(invoice.supplierId, {
          count: existing.count + 1,
          total: existing.total.add(total),
          outstanding: existing.outstanding.add(remaining),
        });
      }
      const rows = [...bySupplier.entries()].map(([supplierId, agg]) => ({
        supplierId,
        supplierNameAr: supplierNames.get(supplierId) ?? supplierId,
        supplierNameEn: supplierNamesEn.get(supplierId) ?? null,
        count: agg.count,
        total: Number(agg.total.toString()),
        outstanding: Number(agg.outstanding.toString()),
      }));
      const totalAll = sumRows(rows, (r) => r.total);
      return rows
        .map((r) => ({ ...r, contributionPercent: totalAll > 0 ? (r.total / totalAll) * 100 : 0 }))
        .sort((a, b) => b.total - a.total);
    },
  };
}
