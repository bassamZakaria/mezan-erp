import { BranchGatedAction } from "../branch-restriction";
import { useBranchGate } from "../shell/useBranchGate";
import { useMemo } from "react";
import { entityName } from "../lib/entity-names";
import { useAppTranslation } from "../i18n";
import type {
  AgingCustomersRow,
  AgingSuppliersRow,
  IncomeStatementRow,
  InventoryStockLevelsRow,
  TopProductsRow,
  VatReturnRow,
} from "@mezan/domain";
import { Money, vatNetPayable } from "@mezan/domain";
import { useFinancialReport, type FinancialReportResult } from "../data/financial-reports-hooks";
import { useReport, type ReportResult } from "../data/reports-hooks";
import { useSalesInvoices } from "../data/hooks";
import type { ApiError, SalesInvoiceDTO } from "../data/hooks";
import type { UseQueryResult } from "@tanstack/react-query";

/**
 * The dashboard's non-summary data. `GET /dashboard/summary` backs the KPI
 * figures; everything else on the screen (period-over-period comparison,
 * expense split, aging matrix, top items, the "needs attention" queue) is
 * read from the SAME live report endpoints the report screens use, so no
 * figure on the dashboard is invented or duplicated client-side.
 */

export type DashboardRangeValue = "month" | "year" | "all";

export interface ReportWindow {
  readonly from: string;
  readonly to: string;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Concrete bounds for the report endpoints. They default to the CURRENT MONTH
 * when a bound is blank, so "كل الفترات" has to send explicit outer bounds
 * rather than omitting them — otherwise the panels would silently disagree
 * with the summary they sit next to.
 */
export function reportWindow(range: DashboardRangeValue, now = new Date()): ReportWindow {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (range === "month") {
    return { from: isoDate(new Date(Date.UTC(y, m, 1))), to: isoDate(new Date(Date.UTC(y, m + 1, 0))) };
  }
  if (range === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: "1900-01-01", to: `${y + 50}-12-31` };
}

/** The window immediately before {@link reportWindow}'s — `null` for "all periods", which has no predecessor. */
export function previousReportWindow(range: DashboardRangeValue, now = new Date()): ReportWindow | null {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (range === "month") {
    return { from: isoDate(new Date(Date.UTC(y, m - 1, 1))), to: isoDate(new Date(Date.UTC(y, m, 0))) };
  }
  if (range === "year") return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  return null;
}

export function useIncomeStatement(
  window: ReportWindow | null,
): UseQueryResult<FinancialReportResult<IncomeStatementRow>, ApiError> {
  return useFinancialReport<IncomeStatementRow>(
    "dashboard-income-statement",
    "/income-statement",
    { periodFrom: window?.from ?? "", periodTo: window?.to ?? "" },
    { enabled: window !== null },
  );
}

export function useVatReturn(window: ReportWindow): UseQueryResult<FinancialReportResult<VatReturnRow>, ApiError> {
  const gate = useBranchGate();
  return useFinancialReport<VatReturnRow>(
    "dashboard-vat-return",
    "/vat-return",
    { periodFrom: window.from, periodTo: window.to },
    { enabled: gate.allows(BranchGatedAction.VatReturn) },
  );
}

export function useCustomerAging(): UseQueryResult<ReportResult<AgingCustomersRow>, ApiError> {
  return useReport<AgingCustomersRow>("dashboard-aging-customers", "/aging/customers", {});
}

export function useSupplierAging(): UseQueryResult<ReportResult<AgingSuppliersRow>, ApiError> {
  return useReport<AgingSuppliersRow>("dashboard-aging-suppliers", "/aging/suppliers", {});
}

export function useStockLevels(): UseQueryResult<ReportResult<InventoryStockLevelsRow>, ApiError> {
  return useReport<InventoryStockLevelsRow>("dashboard-stock-levels", "/inventory/stock-levels", {});
}

export function useTopProducts(window: ReportWindow): UseQueryResult<ReportResult<TopProductsRow>, ApiError> {
  return useReport<TopProductsRow>("dashboard-top-products", "/sales/top-products", {
    dateFrom: window.from,
    dateTo: window.to,
    limit: "5",
  });
}

export interface ExpenseSlice {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

/**
 * Expense accounts (COGS + operating) from the income statement, largest first.
 * Amounts arrive negative.
 *
 * The label follows the reading language: the row carries the account's own
 * English name, and rendering `nameAr` unconditionally put Arabic account names
 * on the English dashboard (D46).
 */
export function expenseSlices(report: FinancialReportResult<IncomeStatementRow> | undefined, locale = "ar"): ExpenseSlice[] {
  if (!report) return [];
  return report.rows
    .filter((row) => row.sectionKey !== "revenue" && row.sectionKey !== "otherIncome")
    .map((row) => ({ key: row.accountId, label: entityName(row, locale, row.code), value: Math.abs(row.amount) }))
    .filter((slice) => slice.value > 0)
    .sort((a, b) => b.value - a.value);
}

function sectionTotal(report: FinancialReportResult<IncomeStatementRow> | undefined, key: "revenue" | "expenses"): number {
  if (!report) return 0;
  // Other income (D229) nets against expenses so revenue − expenses stays the statement's net income.
  if (key === "expenses") {
    return report.rows
      .filter((row) => row.sectionKey !== "revenue")
      .reduce((sum, row) => sum + (row.sectionKey === "otherIncome" ? -row.amount : Math.abs(row.amount)), 0);
  }
  return report.rows.filter((row) => row.sectionKey === "revenue").reduce((sum, row) => sum + Math.abs(row.amount), 0);
}

export interface PeriodTotals {
  readonly revenue: number;
  readonly expenses: number;
  readonly netProfit: number;
}

export function periodTotals(report: FinancialReportResult<IncomeStatementRow> | undefined): PeriodTotals {
  const revenue = sectionTotal(report, "revenue");
  const expenses = sectionTotal(report, "expenses");
  return { revenue, expenses, netProfit: revenue - expenses };
}

export interface AttentionData {
  readonly overdueCount: number;
  readonly overdueAmount: number;
  readonly dueSoonCount: number;
  readonly dueSoonAmount: number;
  readonly taxDue: number;
  readonly lowStockCount: number;
  readonly lowStockFirstName: string | null;
  /** An exact decimal string: supplier ladder buckets past 30 days (D345). */
  readonly agedPayables: string;
}

const DUE_SOON_DAYS = 30;

function daysUntil(dueDate: string, today: Date): number {
  const due = Date.parse(`${dueDate}T00:00:00.000Z`);
  if (Number.isNaN(due)) return Number.POSITIVE_INFINITY;
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((due - start) / 86_400_000);
}

const SETTLED_STATUSES: readonly SalesInvoiceDTO["status"][] = ["draft", "cancelled", "reversed", "paid"];

function outstanding(invoice: SalesInvoiceDTO): number {
  return Number(invoice.remainingBalance);
}

/**
 * The "needs attention" queue's numbers. Overdue/due-soon come from the live
 * sales-invoice list (its own `remainingBalance` and `dueDate`), tax due from
 * the VAT return, below-reorder from stock levels' own `status` flag, and aged
 * payables from the supplier aging buckets past 30 days.
 */
export function useAttentionData(window: ReportWindow, today = new Date()): AttentionData {
  const { locale } = useAppTranslation();
  const invoices = useSalesInvoices();
  const vat = useVatReturn(window);
  const stock = useStockLevels();
  const suppliers = useSupplierAging();

  return useMemo(() => {
    const open = (invoices.data ?? []).filter((inv) => !SETTLED_STATUSES.includes(inv.status) && outstanding(inv) > 0);
    const overdue = open.filter((inv) => daysUntil(inv.dueDate, today) < 0);
    const dueSoon = open.filter((inv) => {
      const days = daysUntil(inv.dueDate, today);
      return days >= 0 && days <= DUE_SOON_DAYS;
    });
    const low = (stock.data?.rows ?? []).filter((row) => row.status === "low");
    const agedPayables = (suppliers.data?.rows ?? [])
      .reduce(
        (sum, row) => sum.add(Money.fromMajor(row.d31to60)).add(Money.fromMajor(row.d61to90)).add(Money.fromMajor(row.d91to120)).add(Money.fromMajor(row.over120)),
        Money.zero(),
      )
      .toString();

    return {
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((sum, inv) => sum + outstanding(inv), 0),
      dueSoonCount: dueSoon.length,
      dueSoonAmount: dueSoon.reduce((sum, inv) => sum + outstanding(inv), 0),
      // vatNetPayable is output − input,
      // the same figure the VAT return screen shows — without it the dashboard
      // reported tax DUE when the return said REFUNDABLE.
      taxDue: vat.data ? vatNetPayable(vat.data.rows) : 0,
      lowStockCount: low.length,
      lowStockFirstName: low[0] ? entityName({ nameAr: low[0].itemNameAr, nameEn: low[0].itemNameEn }, locale) : null,
      agedPayables,
    };
  }, [invoices.data, vat.data, stock.data, suppliers.data, today, locale]);
}
