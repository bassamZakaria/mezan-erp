import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import { Money } from "../money/index.js";
import { salesInvoiceTotals } from "../sales-invoices/totals.js";
import { SALES_INVOICE_ACTIVE_STATUSES, type SalesInvoice } from "../sales-invoices/sales-invoice.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, averageOf } from "./kpi.js";
import { withinDateRange } from "./period-bucket.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, matchesBranch } from "./branch-filter.js";

/**
 * المبيعات حسب العميل — Sales by Customer (docs/archive/catalog/08-reports.md): top
 * customers by revenue and outstanding balance. Revenue is tax-inclusive
 * (`grandTotal`) per the catalog's "عرض الإيرادات: شامل/غير شامل الضريبة"
 * toggle; outstanding is the invoice's own `total − amountPaid`, the SAME
 * figure `recordPayment` maintains — no separate AR sub-ledger required.
 */

export interface SalesByCustomerContext {
  readonly invoices: readonly SalesInvoice[];
  /**
   * The customer list, for the English name only. An invoice stores just the
   * Arabic name it was written with, so without this the report cannot be read
   * in English (D57). Optional: omit it and the Arabic name stands.
   */
  readonly customers?: readonly { readonly id: string; readonly nameEn: string | null }[];
}

export interface SalesByCustomerParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly taxMode: "inc" | "exc";
  readonly branchId: string;
}

export interface SalesByCustomerRow {
  readonly customerId: string;
  readonly customerNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly customerNameEn: string | null;
  readonly count: number;
  readonly total: number;
  readonly outstanding: number;
  readonly contributionPercent: number;
}

const paramsSchema = z.object({
  dateFrom: isoDateParamSchema,
  dateTo: isoDateParamSchema,
  taxMode: z.enum(["inc", "exc"]),
  branchId: branchIdParamSchema,
});

export function createSalesByCustomerReport(
  defaultDateFrom: string,
  defaultDateTo: string,
): ReportDefinition<SalesByCustomerParams, SalesByCustomerRow, SalesByCustomerContext> {
  return {
    id: "sales.by-customer",
    titleAr: "المبيعات حسب العميل",
    descriptionAr: "من هم أهم العملاء من حيث الإيرادات والمديونية.",
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
    rowKey: (row) => row.customerId,
    columns: [
      { key: "customerNameAr", header: "اسم العميل", format: "text", value: (row) => row.customerNameAr, entity: { kind: "customer", id: (row) => row.customerId } },
      { key: "count", header: "عدد المبيعات", format: "qty", align: "end", total: true, value: (row) => row.count },
      { key: "total", header: "الإجمالي", format: "money", align: "end", total: true, value: (row) => row.total },
      { key: "outstanding", header: "المستحق", format: "money", align: "end", total: true, value: (row) => row.outstanding },
      { key: "contributionPercent", header: "نسبة المساهمة", format: "share", align: "end", value: (row) => row.contributionPercent },
    ],
    chart: {
      labelColumn: "customerNameAr",
      valueColumn: "total",
      maxPoints: 8,
      captionAr: "العملاء مرتبون من الأعلى إيراداً في الفترة.",
    },
    kpis: [
      { key: "total", labelAr: "إجمالي الإيرادات", format: "money", value: (rows) => sumRows(rows, (r) => r.total) },
      { key: "outstanding", labelAr: "المستحق على العملاء", format: "money", value: (rows) => sumRows(rows, (r) => r.outstanding), tone: (value) => (value > 0 ? "danger" : "default") },
      { key: "customerCount", labelAr: "عدد العملاء", format: "qty", value: (rows) => rows.length },
      { key: "avgPerCustomer", labelAr: "متوسط الإيراد لكل عميل", hintAr: "الإيراد ÷ عدد العملاء", format: "money", value: (rows) => averageOf(sumRows(rows, (r) => r.total), rows.length) },
    ],
    run: (params, ctx) => {
      const namesEn = new Map((ctx.customers ?? []).map((c) => [c.id, c.nameEn ?? null]));
      const byCustomer = new Map<
        string,
        { customerNameAr: string; count: number; total: Money; outstanding: Money }
      >();
      for (const invoice of ctx.invoices) {
        if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
        if (!withinDateRange(invoice.date, params.dateFrom, params.dateTo)) continue;
        if (!matchesBranch(invoice.branchId, params.branchId)) continue;
        const totals = salesInvoiceTotals(invoice);
        const revenue = params.taxMode === "inc" ? totals.grandTotal : totals.taxableTotal;
        const outstanding = Money.fromScaled(totals.grandTotal.scaled - invoice.amountPaid.scaled);
        const existing = byCustomer.get(invoice.customerId) ?? {
          customerNameAr: invoice.customerNameAr,
          count: 0,
          total: Money.zero(),
          outstanding: Money.zero(),
        };
        byCustomer.set(invoice.customerId, {
          customerNameAr: invoice.customerNameAr,
          count: existing.count + 1,
          total: existing.total.add(revenue),
          outstanding: existing.outstanding.add(outstanding.scaled > 0n ? outstanding : Money.zero()),
        });
      }
      const rows = [...byCustomer.entries()].map(([customerId, agg]) => ({
        customerId,
        customerNameAr: agg.customerNameAr,
        customerNameEn: namesEn.get(customerId) ?? null,
        count: agg.count,
        total: Number(agg.total.toString()),
        outstanding: Number(agg.outstanding.toString()),
      }));
      const totalRevenue = sumRows(rows, (r) => r.total);
      return rows
        .map((r) => ({ ...r, contributionPercent: totalRevenue > 0 ? (r.total / totalRevenue) * 100 : 0 }))
        .sort((a, b) => b.total - a.total);
    },
  };
}
