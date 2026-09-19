// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { FinancialReportsScreen } from "./FinancialReportsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/**
 * Proves the financial-statements page goes through the app's REAL data client
 * (`useApi().request` → `useReport`) against the live `/financial-reports/*`
 * API (packages/api reports-routes.ts), not a fixture ledger: the stub
 * transport stands in for the server-computed statements, and each test asserts
 * the screen requests the right endpoint and renders the reconciliation banners
 * the server returned.
 */

/** A server-computed report outcome, as the /financial-reports/* API returns it. */
function reportBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    rows: [{ accountId: "1100", code: "1100", nameAr: "النقدية", debit: 100, credit: 0 }],
    groups: [
      {
        key: "الأصول",
        label: "الأصول",
        rows: [{ accountId: "1100", code: "1100", nameAr: "النقدية", debit: 100, credit: 0 }],
        totals: { debit: 100, credit: 0 },
      },
    ],
    grandTotals: { debit: 100, credit: 100 },
    reconciliation: { labelAr: "إجمالي المدين = إجمالي الدائن", reportTotal: 100, referenceTotal: 100, diff: 0, withinTolerance: true },
    ...overrides,
  };
}

function fullTransport(capture?: { paths: string[] }) {
  const record = (path: string) => {
    capture?.paths.push(path);
  };
  return stubTransport({
    "GET /accounts": () => ({
      body: [
        { id: "1100", code: "1100", nameAr: "النقدية", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
      ],
    }),
    "GET /financial-reports/trial-balance": (_i, p) => (record(p), { body: reportBody() }),
    "GET /financial-reports/income-statement": (_i, p) => (record(p), { body: reportBody() }),
    "GET /financial-reports/balance-sheet": (_i, p) => (
      record(p),
      {
        body: reportBody({
          reconciliation: { labelAr: "الأصول = الالتزامات + حقوق الملكية", reportTotal: 100, referenceTotal: 100, diff: 0, withinTolerance: true },
        }),
      }
    ),
    "GET /financial-reports/cash-flow": (_i, p) => (record(p), { body: reportBody() }),
    "GET /financial-reports/vat-return": (_i, p) => (
      record(p),
      {
        body: reportBody({
          rows: [{ rowId: "output-14", side: "output", sideLabel: "ضريبة المخرجات (المبيعات)", rate: 14, base: 1000, tax: 140 }],
          groups: [
            {
              key: "output",
              label: "ضريبة المخرجات (المبيعات)",
              rows: [{ rowId: "output-14", side: "output", sideLabel: "ضريبة المخرجات (المبيعات)", rate: 14, base: 1000, tax: 140 }],
              totals: { base: 1000, tax: 140 },
            },
          ],
          grandTotals: { base: 1000, tax: 140 },
          reconciliation: null,
        }),
      }
    ),
    "GET /financial-reports/general-ledger": (_i, p) => (record(p), { body: reportBody() }),
    "GET /financial-reports/account-ledger": (_i, p) => (record(p), { body: reportBody({ reconciliation: null }) }),
  });
}

describe("FinancialReportsScreen (real GL API wiring)", () => {
  it("auto-runs the trial balance tab against /financial-reports/trial-balance with its reconciliation banner", async () => {
    const capture = { paths: [] as string[] };
    renderWithProviders(<FinancialReportsScreen />, { transport: fullTransport(capture), initialSession: testAdminSession });

    expect(screen.getByRole("heading", { name: "ميزان المراجعة" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("إجمالي المدين = إجمالي الدائن")).toBeInTheDocument());
    expect(capture.paths.some((p) => p.includes("/financial-reports/trial-balance"))).toBe(true);
    expect(screen.getByRole("tab", { name: "ميزان المراجعة" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to the balance sheet tab and shows the A = L + E check from the server", async () => {
    renderWithProviders(<FinancialReportsScreen />, { transport: fullTransport(), initialSession: testAdminSession });
    fireEvent.click(screen.getByRole("tab", { name: "الميزانية العمومية" }));
    expect(screen.getByRole("heading", { name: "الميزانية العمومية" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("الأصول = الالتزامات + حقوق الملكية")).toBeInTheDocument());
  });

  it("shows the output-vs-input VAT chart AND the net-payable line together (D68)", async () => {
    // The VAT return declares a `chart` and the screen also passes `renderSummary`.
    // ReportScreen used to prefer the chart, so «صافي الضريبة المستحقة الدفع» —
    // the one figure the return exists to produce — never reached the DOM.
    renderWithProviders(<FinancialReportsScreen />, { transport: fullTransport(), initialSession: testAdminSession });
    fireEvent.click(screen.getByRole("tab", { name: "إقرار ضريبة القيمة المضافة" }));
    await waitFor(() => expect(screen.getByText(/الفرق بينهما هو صافي الإقرار/)).toBeInTheDocument());
    expect(screen.getAllByText("ضريبة المخرجات (المبيعات)").length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(
        screen.getByText(/صافي الضريبة (المستحقة الدفع|القابلة للاسترداد)/),
      ).toBeInTheDocument(),
    );
  });

  it("gates the on-demand general ledger behind عرض التقرير", async () => {
    const capture = { paths: [] as string[] };
    renderWithProviders(<FinancialReportsScreen />, { transport: fullTransport(capture), initialSession: testAdminSession });
    fireEvent.click(screen.getByRole("tab", { name: "دفتر الأستاذ العام" }));
    // Placeholder until run — no request fired yet.
    expect(screen.getByText(/اضغط .عرض التقرير./)).toBeInTheDocument();
    expect(capture.paths.some((p) => p.includes("/financial-reports/general-ledger"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "عرض التقرير" }));
    await waitFor(() => expect(capture.paths.some((p) => p.includes("/financial-reports/general-ledger"))).toBe(true));
  });

  it("keeps an Excel export control available on the auto-run trial balance tab", async () => {
    renderWithProviders(<FinancialReportsScreen />, { transport: fullTransport(), initialSession: testAdminSession });
    const exportButton = screen.getByRole("button", { name: "تصدير Excel" });
    expect(exportButton).toBeInTheDocument();
    await waitFor(() => expect(exportButton).toBeEnabled());
  });
});

describe("FinancialReportsScreen — drilling into an account answers for the figure clicked (D281)", () => {
  function drillTransport(drillPaths: string[]) {
    const account = { accountId: "1100", code: "1100", nameAr: "النقدية", debit: 100, credit: 0 };
    const body = (params: Record<string, string>) => ({
      ...reportBody({ rows: [account], groups: [{ key: "الأصول", label: "الأصول", rows: [account], totals: { debit: 100, credit: 0 } }] }),
      params,
    });
    return stubTransport({
      "GET /financial-reports/trial-balance": () => ({ body: body({ asOfDate: "2026-08-24", branchId: "" }) }),
      "GET /financial-reports/income-statement": () => ({ body: body({ periodFrom: "2026-01-01", periodTo: "2026-08-24", compareTo: "previous", branchId: "BR-1" }) }),
      "GET /reports/drill-down/*/*": (_i, path) => {
        drillPaths.push(path);
        return {
          body: {
            kind: "account",
            id: "1100",
            titleAr: "النقدية",
            subtitleAr: "1100",
            facts: [{ key: "asOfDate", labelAr: "حتى تاريخ", value: "2026-08-24", format: "date" }],
            documents: [],
            documentCount: 0,
          },
        };
      },
    });
  }

  it("the trial balance's account link passes the as-of date the balance was computed for", async () => {
    const drillPaths: string[] = [];
    renderWithProviders(<FinancialReportsScreen />, { transport: drillTransport(drillPaths), initialSession: testAdminSession });
    fireEvent.click(await screen.findByRole("button", { name: "النقدية" }));
    await waitFor(() => expect(drillPaths).toEqual(["/reports/drill-down/account/1100?asOfDate=2026-08-24"]));
    expect(await screen.findByText("2026-08-24")).toBeInTheDocument();
  });

  it("the income statement's account link passes its period and branch", async () => {
    const drillPaths: string[] = [];
    renderWithProviders(<FinancialReportsScreen />, { transport: drillTransport(drillPaths), initialSession: testAdminSession });
    fireEvent.click(screen.getByRole("tab", { name: "قائمة الدخل" }));
    fireEvent.click(await screen.findByRole("button", { name: "النقدية" }));
    await waitFor(() =>
      expect(drillPaths).toEqual(["/reports/drill-down/account/1100?fromDate=2026-01-01&asOfDate=2026-08-24&branchId=BR-1"]),
    );
  });
});
