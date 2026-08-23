// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { FinancialReportsScreen } from "./FinancialReportsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/**
 * Proves the financial-statements page goes through the app's REAL data client
 * (`useApi().request` → `useReport`) against the live `/reports/accounting/*`
 * API (packages/api reports-routes.ts), not a fixture ledger: the stub
 * transport stands in for the server-computed statements, and each test asserts
 * the screen requests the right endpoint and renders the reconciliation banners
 * the server returned.
 */

/** A server-computed report outcome, as the /reports/accounting/* API returns it. */
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
    "GET /reports/accounting/trial-balance": (_i, p) => (record(p), { body: reportBody() }),
    "GET /reports/accounting/income-statement": (_i, p) => (record(p), { body: reportBody() }),
    "GET /reports/accounting/balance-sheet": (_i, p) => (
      record(p),
      {
        body: reportBody({
          reconciliation: { labelAr: "الأصول = الالتزامات + حقوق الملكية", reportTotal: 100, referenceTotal: 100, diff: 0, withinTolerance: true },
        }),
      }
    ),
    "GET /reports/accounting/cash-flow": (_i, p) => (record(p), { body: reportBody() }),
    "GET /reports/accounting/vat-return": (_i, p) => (
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
    "GET /reports/accounting/general-ledger": (_i, p) => (record(p), { body: reportBody() }),
    "GET /reports/accounting/account-ledger": (_i, p) => (record(p), { body: reportBody({ reconciliation: null }) }),
  });
}

describe("FinancialReportsScreen (real GL API wiring)", () => {
  it("auto-runs the trial balance tab against /reports/accounting/trial-balance with its reconciliation banner", async () => {
    const capture = { paths: [] as string[] };
    renderWithProviders(<FinancialReportsScreen />, { transport: fullTransport(capture), initialSession: testAdminSession });

    expect(screen.getByRole("heading", { name: "ميزان المراجعة" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("إجمالي المدين = إجمالي الدائن")).toBeInTheDocument());
    expect(capture.paths.some((p) => p.includes("/reports/accounting/trial-balance"))).toBe(true);
    expect(screen.getByRole("tab", { name: "ميزان المراجعة" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to the balance sheet tab and shows the A = L + E check from the server", async () => {
    renderWithProviders(<FinancialReportsScreen />, { transport: fullTransport(), initialSession: testAdminSession });
    fireEvent.click(screen.getByRole("tab", { name: "الميزانية العمومية" }));
    expect(screen.getByRole("heading", { name: "الميزانية العمومية" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("الأصول = الالتزامات + حقوق الملكية")).toBeInTheDocument());
  });

  it("shows the VAT net-payable summary computed from the server rows", async () => {
    renderWithProviders(<FinancialReportsScreen />, { transport: fullTransport(), initialSession: testAdminSession });
    fireEvent.click(screen.getByRole("tab", { name: "إقرار ضريبة القيمة المضافة" }));
    await waitFor(() => expect(screen.getByText(/صافي الضريبة المستحقة الدفع/)).toBeInTheDocument());
  });

  it("gates the on-demand general ledger behind عرض التقرير", async () => {
    const capture = { paths: [] as string[] };
    renderWithProviders(<FinancialReportsScreen />, { transport: fullTransport(capture), initialSession: testAdminSession });
    fireEvent.click(screen.getByRole("tab", { name: "دفتر الأستاذ العام" }));
    // Placeholder until run — no request fired yet.
    expect(screen.getByText(/اضغط .عرض التقرير./)).toBeInTheDocument();
    expect(capture.paths.some((p) => p.includes("/reports/accounting/general-ledger"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "عرض التقرير" }));
    await waitFor(() => expect(capture.paths.some((p) => p.includes("/reports/accounting/general-ledger"))).toBe(true));
  });

  it("keeps an Excel export control available on the auto-run trial balance tab", async () => {
    renderWithProviders(<FinancialReportsScreen />, { transport: fullTransport(), initialSession: testAdminSession });
    const exportButton = screen.getByRole("button", { name: "تصدير Excel" });
    expect(exportButton).toBeInTheDocument();
    await waitFor(() => expect(exportButton).toBeEnabled());
  });
});
