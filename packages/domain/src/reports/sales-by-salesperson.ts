import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import { Money } from "../money/index.js";
import { salesInvoiceBaseTotals, salesInvoiceTotals } from "../sales-invoices/totals.js";
import { SALES_INVOICE_ACTIVE_STATUSES, type SalesInvoice } from "../sales-invoices/sales-invoice.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";
import { withinDateRange } from "./period-bucket.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, matchesBranch } from "./branch-filter.js";

/**
 * المبيعات حسب المندوب — Sales by Salesperson (docs/archive/catalog/08-reports.md).
 * One row per HR employee credited on a live invoice in the period: how many
 * sales they closed, what they billed, what of it is still outstanding, and
 * what share of the period's revenue they carried.
 *
 * Revenue and outstanding are read through `salesInvoiceTotals`, the SAME
 * figures the invoice screen, the GL posting and المبيعات حسب العميل use — so
 * this report's grand total reconciles against those by construction, and an
 * invoice that granted a promotion contributes its post-promotion value.
 *
 * Invoices raised before the salesperson field existed, and any sale nobody is
 * credited with, are NOT dropped: they aggregate into an explicit
 * "غير محدد" row so the report's total always equals total period sales.
 */

/** Row key for invoices with no salesperson — a real row, never a silent omission. */
export const UNASSIGNED_SALESPERSON_KEY = "__unassigned__";

export interface SalesBySalespersonContext {
  readonly invoices: readonly SalesInvoice[];
  /** Confirmed sales-return credit per SOURCE invoice, in base; outstanding nets it (D219). */
  readonly returnsByInvoiceId?: ReadonlyMap<string, Money>;
}

export interface SalesBySalespersonParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly taxMode: "inc" | "exc";
  readonly branchId: string;
}

export interface SalesBySalespersonRow {
  readonly salespersonId: string;
  readonly salespersonNameAr: string;
  readonly count: number;
  readonly total: number;
  readonly promotionDiscount: number;
  readonly outstanding: number;
  readonly contributionPercent: number;
}

const paramsSchema = z.object({
  dateFrom: isoDateParamSchema,
  dateTo: isoDateParamSchema,
  taxMode: z.enum(["inc", "exc"]),
  branchId: branchIdParamSchema,
});

export function createSalesBySalespersonReport(
  defaultDateFrom: string,
  defaultDateTo: string,
): ReportDefinition<SalesBySalespersonParams, SalesBySalespersonRow, SalesBySalespersonContext> {
  return {
    id: "sales.by-salesperson",
    titleAr: "المبيعات حسب المندوب",
    descriptionAr:
      "أداء مندوبي المبيعات في الفترة: عدد الفواتير، الإجمالي المُفوتر، خصومات العروض الممنوحة، والمتبقي على العملاء. الفواتير غير المنسوبة لمندوب تظهر في صف «غير محدد» حتى يساوي إجمالي التقرير إجمالي مبيعات الفترة.",
    paramsSchema,
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, taxMode: "inc", branchId: "" },
    paramFields: [
      { kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" },
      {
        kind: "select",
        key: "taxMode",
        label: "عرض الإيرادات",
        options: [
          { value: "inc", label: "شامل الضريبة" },
          { value: "exc", label: "غير شامل الضريبة" },
        ],
      },
      BRANCH_PARAM_FIELD,
    ],
    rowKey: (row) => row.salespersonId,
    columns: [
      { key: "salespersonNameAr", header: "المندوب", format: "text", value: (row) => row.salespersonNameAr },
      { key: "count", header: "عدد الفواتير", format: "qty", align: "end", total: true, value: (row) => row.count },
      { key: "total", header: "الإجمالي", format: "money", align: "end", total: true, value: (row) => row.total },
      { key: "promotionDiscount", header: "خصم العروض", format: "money", align: "end", total: true, value: (row) => row.promotionDiscount },
      { key: "outstanding", header: "المستحق", format: "money", align: "end", total: true, value: (row) => row.outstanding },
      { key: "contributionPercent", header: "نسبة المساهمة", format: "share", align: "end", value: (row) => row.contributionPercent },
    ],
    chart: {
      labelColumn: "salespersonNameAr",
      valueColumn: "total",
      maxPoints: 8,
      captionAr: "حصة كل مندوب من إيراد الفترة.",
    },
    kpis: [
      { key: "total", labelAr: "إجمالي المبيعات", format: "money", value: (rows) => sumRows(rows, (r) => r.total) },
      { key: "outstanding", labelAr: "المستحق", format: "money", value: (rows) => sumRows(rows, (r) => r.outstanding), tone: (value) => (value > 0 ? "danger" : "default") },
      { key: "promotionDiscount", labelAr: "خصم العروض", format: "money", value: (rows) => sumRows(rows, (r) => r.promotionDiscount) },
      { key: "salespersonCount", labelAr: "عدد المندوبين", format: "qty", value: (rows) => rows.length },
    ],
    run: (params, ctx) => {
      const byRep = new Map<
        string,
        { nameAr: string; count: number; total: Money; promotionDiscount: Money; outstanding: Money }
      >();
      for (const invoice of ctx.invoices) {
        if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
        if (!withinDateRange(invoice.date, params.dateFrom, params.dateTo)) continue;
        if (!matchesBranch(invoice.branchId, params.branchId)) continue;
        const totals = salesInvoiceTotals(invoice);
        const base = salesInvoiceBaseTotals(totals, invoice.fxRate);
        const revenue = params.taxMode === "inc" ? base.grandTotal : base.taxableTotal;
        const returned = ctx.returnsByInvoiceId?.get(invoice.id) ?? Money.zero();
        const outstanding = Money.fromScaled(base.grandTotal.scaled - invoice.amountPaid.scaled - returned.scaled);
        const key = invoice.salespersonId ?? UNASSIGNED_SALESPERSON_KEY;
        const nameAr =
          invoice.salespersonId === null ? "غير محدد" : (invoice.salespersonNameAr ?? invoice.salespersonId);
        const existing = byRep.get(key) ?? {
          nameAr,
          count: 0,
          total: Money.zero(),
          promotionDiscount: Money.zero(),
          outstanding: Money.zero(),
        };
        byRep.set(key, {
          nameAr,
          count: existing.count + 1,
          total: existing.total.add(revenue),
          promotionDiscount: existing.promotionDiscount.add(totals.promotionDiscountTotal),
          outstanding: existing.outstanding.add(outstanding.scaled > 0n ? outstanding : Money.zero()),
        });
      }
      const rows = [...byRep.entries()].map(([salespersonId, agg]) => ({
        salespersonId,
        salespersonNameAr: agg.nameAr,
        count: agg.count,
        total: Number(agg.total.toString()),
        promotionDiscount: Number(agg.promotionDiscount.toString()),
        outstanding: Number(agg.outstanding.toString()),
      }));
      const totalRevenue = sumRows(rows, (r) => r.total);
      return rows
        .map((r) => ({ ...r, contributionPercent: totalRevenue > 0 ? (r.total / totalRevenue) * 100 : 0 }))
        .sort((a, b) => {
          // "غير محدد" is a residual bucket, not a performer — it always sorts last.
          if (a.salespersonId === UNASSIGNED_SALESPERSON_KEY) return 1;
          if (b.salespersonId === UNASSIGNED_SALESPERSON_KEY) return -1;
          return b.total - a.total;
        });
    },
  };
}
