// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppI18nProvider } from "../i18n";
import { ApiProvider } from "../data/ApiContext";
import { createQueryClient } from "../data/queryClient";
import { stubTransport, testAdminSession } from "../data/test-support";
import type { Transport } from "../data/transport";
import {
  expenseSlices,
  periodTotals,
  previousReportWindow,
  reportWindow,
  useAttentionData,
  useCustomerAging,
  useIncomeStatement,
  useStockLevels,
  useSupplierAging,
  useTopProducts,
  useVatReturn,
  type DashboardRangeValue,
} from "./dashboard-hooks";
import type { FinancialReportResult } from "../data/financial-reports-hooks";
import type { IncomeStatementRow } from "@mezan/domain";

function makeWrapper(transport: Transport, session = testAdminSession) {
  const queryClient = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppI18nProvider>
        <QueryClientProvider client={queryClient}>
          <ApiProvider transport={transport} initialSession={session}>
            {children}
          </ApiProvider>
        </QueryClientProvider>
      </AppI18nProvider>
    );
  }
  return { Wrapper, queryClient };
}

const FIXED_NOW = new Date("2026-03-15T12:00:00.000Z");

describe("reportWindow", () => {
  it("returns the first-to-last day of the current month for 'month'", () => {
    expect(reportWindow("month", FIXED_NOW)).toEqual({ from: "2026-03-01", to: "2026-03-31" });
  });

  it("returns Jan 1 to Dec 31 of the current year for 'year'", () => {
    expect(reportWindow("year", FIXED_NOW)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("returns very wide outer bounds for 'all'", () => {
    const window = reportWindow("all", FIXED_NOW);
    expect(window.from).toBe("1900-01-01");
    expect(window.to).toBe("2076-12-31");
  });
});

describe("the dashboard's month is the one on the wall calendar", () => {
  const firstHalfHourOfSeptember = new Date("2026-09-01T00:30:00");

  it("opens on the new month half an hour after it began, not on the month UTC is still in", () => {
    expect(reportWindow("month", firstHalfHourOfSeptember)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousReportWindow("month", firstHalfHourOfSeptember)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("opens on the new year half an hour after it began", () => {
    const firstHalfHourOfTheYear = new Date("2027-01-01T00:30:00");
    expect(reportWindow("year", firstHalfHourOfTheYear)).toEqual({ from: "2027-01-01", to: "2027-12-31" });
    expect(previousReportWindow("year", firstHalfHourOfTheYear)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("previousReportWindow", () => {
  it("returns the previous month for 'month'", () => {
    expect(previousReportWindow("month", FIXED_NOW)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("rolls back across a year boundary for January", () => {
    expect(previousReportWindow("month", new Date("2026-01-15T00:00:00.000Z"))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("returns the previous calendar year for 'year'", () => {
    expect(previousReportWindow("year", FIXED_NOW)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("returns null for 'all' — there is no period before 'all periods'", () => {
    expect(previousReportWindow("all", FIXED_NOW)).toBeNull();
  });
});

function incomeReport(rows: IncomeStatementRow[]): FinancialReportResult<IncomeStatementRow> {
  return { rows, groups: [], grandTotals: {}, reconciliation: null };
}

function incomeRow(overrides: Partial<IncomeStatementRow>): IncomeStatementRow {
  return {
    accountId: "A1",
    code: "5000",
    nameAr: "حساب",
    nameEn: "Account",
    sectionKey: "expenses",
    amount: 0,
    ...overrides,
  } as IncomeStatementRow;
}

describe("expenseSlices", () => {
  it("returns an empty array when there is no report yet", () => {
    expect(expenseSlices(undefined)).toEqual([]);
  });

  it("excludes revenue rows and sorts expense rows largest-first by absolute value", () => {
    const report = incomeReport([
      incomeRow({ accountId: "REV", sectionKey: "revenue", amount: 9000 }),
      incomeRow({ accountId: "SMALL", sectionKey: "cogs", amount: -200, nameEn: "Small" }),
      incomeRow({ accountId: "BIG", sectionKey: "opex", amount: -800, nameEn: "Big" }),
    ]);
    const slices = expenseSlices(report, "en");
    expect(slices.map((s) => s.key)).toEqual(["BIG", "SMALL"]);
    expect(slices[0]?.value).toBe(800);
  });

  it("drops a zero-value expense row", () => {
    const report = incomeReport([incomeRow({ accountId: "Z", sectionKey: "opex", amount: 0 })]);
    expect(expenseSlices(report)).toEqual([]);
  });

  it("uses the English name on the English locale (D46 regression)", () => {
    const report = incomeReport([
      incomeRow({ accountId: "X", sectionKey: "opex", amount: -100, nameAr: "إيجار", nameEn: "Rent" }),
    ]);
    expect(expenseSlices(report, "en")[0]?.label).toBe("Rent");
    expect(expenseSlices(report, "ar")[0]?.label).toBe("إيجار");
  });
});

describe("periodTotals", () => {
  it("returns zeros when there is no report", () => {
    expect(periodTotals(undefined)).toEqual({ revenue: 0, expenses: 0, netProfit: 0 });
  });

  it("sums revenue and expenses (as positive magnitudes) and computes net profit", () => {
    const report = incomeReport([
      incomeRow({ accountId: "R1", sectionKey: "revenue", amount: 5000 }),
      incomeRow({ accountId: "R2", sectionKey: "revenue", amount: 1000 }),
      incomeRow({ accountId: "E1", sectionKey: "cogs", amount: -2000 }),
      incomeRow({ accountId: "E2", sectionKey: "opex", amount: -1500 }),
    ]);
    expect(periodTotals(report)).toEqual({ revenue: 6000, expenses: 3500, netProfit: 2500 });
  });

  it("D229: nets other income (an exchange gain) against expenses rather than counting it as a cost or a sale", () => {
    const report = incomeReport([
      incomeRow({ accountId: "4100", sectionKey: "revenue", amount: 5000 }),
      incomeRow({ accountId: "5200", sectionKey: "opex", amount: -1500 }),
      incomeRow({ accountId: "4920", sectionKey: "otherIncome", amount: 80 }),
      incomeRow({ accountId: "5920", sectionKey: "otherExpense", amount: -30 }),
    ]);
    expect(periodTotals(report)).toEqual({ revenue: 5000, expenses: 1450, netProfit: 3550 });
    expect(expenseSlices(report).map((slice) => slice.key)).toEqual(["5200", "5920"]);
  });
});

const window = { from: "2026-03-01", to: "2026-03-31" };

describe("useIncomeStatement", () => {
  it("requests /financial-reports/income-statement with the period bounds as query params", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /financial-reports/income-statement": (_init, path) => {
        seenPath = path;
        return { body: incomeReport([]) };
      },
    });
    const { result } = renderHook(() => useIncomeStatement(window), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/financial-reports/income-statement?periodFrom=2026-03-01&periodTo=2026-03-31");
    expect(result.current.data?.rows).toEqual([]);
  });

  it("is disabled (no request fires) when the window is null", async () => {
    let called = false;
    const transport = stubTransport({
      "GET /financial-reports/income-statement": () => {
        called = true;
        return { body: incomeReport([]) };
      },
    });
    const { result } = renderHook(() => useIncomeStatement(null), { wrapper: makeWrapper(transport).Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(false);
    expect(result.current.isPending).toBe(true);
  });

  it("surfaces a failed fetch as an ApiError with the response status", async () => {
    const transport = stubTransport({
      "GET /financial-reports/income-statement": () => ({ status: 500, body: { error: "SERVER_ERROR" } }),
    });
    const { result } = renderHook(() => useIncomeStatement(window), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(500);
  });
});

describe("useVatReturn", () => {
  it("requests /financial-reports/vat-return with the window as query params", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /financial-reports/vat-return": (_init, path) => {
        seenPath = path;
        return { body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } };
      },
    });
    const { result } = renderHook(() => useVatReturn(window), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/financial-reports/vat-return?periodFrom=2026-03-01&periodTo=2026-03-31");
  });
});

describe("useCustomerAging / useSupplierAging / useStockLevels", () => {
  it("useCustomerAging requests /reports/aging/customers with no params", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /reports/aging/customers": (_init, path) => {
        seenPath = path;
        return { body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } };
      },
    });
    const { result } = renderHook(() => useCustomerAging(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/reports/aging/customers");
  });

  it("useSupplierAging returns an empty rows array cleanly", async () => {
    const transport = stubTransport({
      "GET /reports/aging/suppliers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
    });
    const { result } = renderHook(() => useSupplierAging(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows).toEqual([]);
  });

  it("useStockLevels requests the stock-levels summary, never the full report", async () => {
    const seen: string[] = [];
    const inner = stubTransport({
      "GET /reports/inventory/stock-levels/summary": () => ({ body: { totalValue: "0", needsAttentionCount: 0, lowCount: 0, attention: [], firstLow: null } }),
    });
    const transport: typeof inner = (path, init) => (seen.push(path), inner(path, init));
    const { result } = renderHook(() => useStockLevels(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen).toContain("/reports/inventory/stock-levels/summary");
    expect(seen.some((path) => path.split("?")[0] === "/reports/inventory/stock-levels")).toBe(false);
  });
});

describe("useTopProducts", () => {
  it("requests /reports/sales/top-products with the window and a limit of 5", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /reports/sales/top-products": (_init, path) => {
        seenPath = path;
        return { body: { rows: [{ itemId: "I1" }], groups: [], grandTotals: {}, reconciliation: null } };
      },
    });
    const { result } = renderHook(() => useTopProducts(window), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/reports/sales/top-products?dateFrom=2026-03-01&dateTo=2026-03-31&limit=5");
    expect(result.current.data?.rows).toEqual([{ itemId: "I1" }]);
  });
});

describe("useAttentionData", () => {

  const invoiceList = vi.fn(() => ({ body: [] }));

  function transportFor(overrides: {
    stats?: unknown;
    vatRows?: unknown[];
    stockSummary?: unknown;
    supplierRows?: unknown[];
  }) {
    return stubTransport({
      "GET /sales-invoices": invoiceList,
      "GET /sales-invoices/stats": () => ({ body: overrides.stats ?? { count: 0, sales: "0", collected: "0", returned: "0", remaining: "0", overdueCount: 0, overdue: "0", dueSoonCount: 0, dueSoon: "0" } }),
      "GET /financial-reports/vat-return": () => ({ status: 200, body: { rows: overrides.vatRows ?? [], groups: [], grandTotals: {}, reconciliation: null } }),
      "GET /reports/inventory/stock-levels/summary": () => ({ body: overrides.stockSummary ?? { totalValue: "0", needsAttentionCount: 0, lowCount: 0, attention: [], firstLow: null } }),
      "GET /reports/aging/suppliers": () => ({ body: { rows: overrides.supplierRows ?? [], groups: [], grandTotals: {}, reconciliation: null } }),
    });
  }

  it("reads overdue and due-soon from the server's money totals, never the invoice list", async () => {
    const transport = transportFor({
      stats: { count: 4, sales: "0", collected: "0", returned: "0", remaining: "0", overdueCount: 1, overdue: "500.000000", dueSoonCount: 2, dueSoon: "300.000000" },
    });
    const { result } = renderHook(() => useAttentionData(window), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.overdueCount).toBe(1));
    expect(result.current).toMatchObject({ overdueAmount: "500.000000", dueSoonCount: 2, dueSoonAmount: "300.000000" });
    expect(invoiceList).not.toHaveBeenCalled();
  });

  it("sums low-stock rows and aged-payables buckets past 30 days", async () => {
    const transport = transportFor({
      stockSummary: {
        totalValue: "0",
        needsAttentionCount: 3,
        lowCount: 2,
        attention: [],
        firstLow: { itemId: "I-LOW", itemNameAr: "صنف منخفض", itemNameEn: "Low item", sku: "L-1", onHand: "2.000000", status: "low" },
      },
      supplierRows: [{ d31to60: "100.000000", d61to90: "50.000000", d91to120: "25.000000", over120: "10.000000" }],
    });
    const { result } = renderHook(() => useAttentionData(window), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.lowStockCount).toBe(2));
    expect(result.current.lowStockFirstName).toBe("صنف منخفض");
    expect(result.current.agedPayables).toBe("185.000000");
  });
});
