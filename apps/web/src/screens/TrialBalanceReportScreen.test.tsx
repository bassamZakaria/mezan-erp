// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { TrialBalanceReportScreen } from "./TrialBalanceReportScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/** The real screen defaults "حتى تاريخ" to the live clock (apps/web/src/screens/TrialBalanceReportScreen.tsx), not a fixed date. */
const TODAY = new Date().toISOString().slice(0, 10);

const CASH_ROW = { accountId: "1100", code: "1100", nameAr: "النقدية", typeLabel: "الأصول", debit: 147000, credit: 0 };
const REVENUE_ROW = { accountId: "4100", code: "4100", nameAr: "إيرادات المبيعات", typeLabel: "الإيرادات", debit: 0, credit: 147000 };
// Only the opening-capital entry has posted by 2026-01-01 — no revenue booked yet.
const OPENING_ROW = { accountId: "1100", code: "1100", nameAr: "النقدية", typeLabel: "الأصول", debit: 100000, credit: 0 };

function bodyFor(rows: (typeof CASH_ROW)[]) {
  const groups = Object.values(
    rows.reduce<Record<string, { key: string; label: string; rows: typeof rows; totals: { debit: number; credit: number } }>>(
      (acc, row) => {
        const g = (acc[row.typeLabel] ??= { key: row.typeLabel, label: row.typeLabel, rows: [], totals: { debit: 0, credit: 0 } });
        g.rows.push(row);
        g.totals.debit += row.debit;
        g.totals.credit += row.credit;
        return acc;
      },
      {},
    ),
  );
  const debit = rows.reduce((sum, r) => sum + r.debit, 0);
  const credit = rows.reduce((sum, r) => sum + r.credit, 0);
  return {
    rows,
    groups,
    grandTotals: { debit, credit },
    reconciliation: { labelAr: "إجمالي المدين = إجمالي الدائن", reportTotal: debit, referenceTotal: credit, diff: debit - credit, withinTolerance: debit === credit },
  };
}

function renderScreen() {
  const transport = stubTransport({
    "GET /financial-reports/trial-balance": (_init, path) => {
      const asOfDate = new URLSearchParams(path.split("?")[1] ?? "").get("asOfDate") ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
        return { status: 400, body: { error: "VALIDATION_ERROR", message: "تاريخ غير صالح — استخدم الصيغة YYYY-MM-DD" } };
      }
      return { body: bodyFor(asOfDate <= "2026-01-01" ? [OPENING_ROW] : [CASH_ROW, REVENUE_ROW]) };
    },
  });
  return renderWithProviders(<TrialBalanceReportScreen />, { transport, initialSession: testAdminSession });
}

describe("TrialBalanceReportScreen (report engine, wired end to end)", () => {
  it("gates on 'عرض التقرير' before showing any results", () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "ميزان المراجعة" })).toBeInTheDocument();
    expect(screen.getByLabelText("حتى تاريخ")).toHaveValue(TODAY);
    expect(screen.queryByText("النقدية")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "عرض التقرير" })).toBeInTheDocument();
  });

  it("runs the report and renders grouped rows, the grand total, and a balanced reconciliation banner", async () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "عرض التقرير" }));

    // Account rows, grouped by type.
    expect(await screen.findByText("الأصول")).toBeInTheDocument();
    expect(screen.getByText("النقدية")).toBeInTheDocument();
    expect(screen.getByText("إيرادات المبيعات")).toBeInTheDocument();

    // Reconciliation banner: debits = credits at 147,000.00 as of the sample data's full history.
    expect(screen.getByText("إجمالي المدين = إجمالي الدائن")).toBeInTheDocument();
    expect(screen.getByText("=")).toBeInTheDocument();
    expect(screen.getAllByText("147,000.00").length).toBeGreaterThan(0);
  });

  it("recomputes the balance for an earlier as-of date", async () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("حتى تاريخ"), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "عرض التقرير" }));
    // Only the opening-capital entry (100,000) has posted by 2026-01-01.
    expect((await screen.findAllByText("100,000.00")).length).toBeGreaterThan(0);
    expect(screen.queryByText("122,000.00")).not.toBeInTheDocument();
  });

  it("shows a validation error for an invalid as-of date instead of running the query", async () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("حتى تاريخ"), { target: { value: "not-a-date" } });
    fireEvent.click(screen.getByRole("button", { name: "عرض التقرير" }));
    expect(await screen.findByText("تاريخ غير صالح — استخدم الصيغة YYYY-MM-DD")).toBeInTheDocument();
    expect(screen.queryByText("النقدية")).not.toBeInTheDocument();
  });
});
