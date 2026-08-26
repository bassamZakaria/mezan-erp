import { z } from "zod";
import { Money } from "../money/index.js";
import { salesInvoiceTotals } from "../sales-invoices/totals.js";
import { SALES_INVOICE_ACTIVE_STATUSES, type SalesInvoice } from "../sales-invoices/sales-invoice.js";
import type { ReportDefinition } from "./types.js";
import { withinDateRange } from "./period-bucket.js";

/**
 * المبيعات حسب العميل — Sales by Customer (docs/catalog/08-reports.md): top
 * customers by revenue and outstanding balance. Revenue is tax-inclusive
 * (`grandTotal`) per the catalog's "عرض الإيرادات: شامل/غير شامل الضريبة"
 * toggle; outstanding is the invoice's own `total − amountPaid`, the SAME
 * figure `recordPayment` maintains — no separate AR sub-ledger required.
 */

export interface SalesByCustomerContext {
  readonly invoices: readonly SalesInvoice[];
}

export interface SalesByCustomerParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly taxMode: "inc" | "exc";
}

export interface SalesByCustomerRow {
  readonly customerId: string;
  readonly customerNameAr: string;
  readonly count: number;
  readonly total: number;
  readonly outstanding: number;
  readonly contributionPercent: number;
}

const paramsSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  taxMode: z.enum(["inc", "exc"]),
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
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, taxMode: "inc" },
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
    ],
    rowKey: (row) => row.customerId,
    columns: [
      { key: "customerNameAr", header: "اسم العميل", format: "text", value: (row) => row.customerNameAr },
      { key: "count", header: "عدد المبيعات", format: "qty", align: "end", total: true, value: (row) => row.count },
      { key: "total", header: "الإجمالي", format: "money", align: "end", total: true, value: (row) => row.total },
      { key: "outstanding", header: "المستحق", format: "money", align: "end", total: true, value: (row) => row.outstanding },
      { key: "contributionPercent", header: "نسبة المساهمة", format: "share", align: "end", value: (row) => row.contributionPercent },
    ],
    run: (params, ctx) => {
      const byCustomer = new Map<
        string,
        { customerNameAr: string; count: number; total: Money; outstanding: Money }
      >();
      for (const invoice of ctx.invoices) {
        if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
        if (!withinDateRange(invoice.date, params.dateFrom, params.dateTo)) continue;
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
        count: agg.count,
        total: Number(agg.total.toString()),
        outstanding: Number(agg.outstanding.toString()),
      }));
      const totalRevenue = rows.reduce((sum, r) => sum + r.total, 0);
      return rows
        .map((r) => ({ ...r, contributionPercent: totalRevenue > 0 ? (r.total / totalRevenue) * 100 : 0 }))
        .sort((a, b) => b.total - a.total);
    },
  };
}
