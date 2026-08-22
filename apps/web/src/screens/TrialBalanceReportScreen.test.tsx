// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TrialBalanceReportScreen } from "./TrialBalanceReportScreen";

describe("TrialBalanceReportScreen (report engine, wired end to end)", () => {
  it("gates on 'عرض التقرير' before showing any results", () => {
    render(<TrialBalanceReportScreen />);
    expect(screen.getByRole("heading", { name: "ميزان المراجعة" })).toBeInTheDocument();
    expect(screen.getByLabelText("حتى تاريخ")).toHaveValue("2026-08-22");
    expect(screen.queryByText("النقدية")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "عرض التقرير" })).toBeInTheDocument();
  });

  it("runs the report and renders grouped rows, the grand total, and a balanced reconciliation banner", () => {
    render(<TrialBalanceReportScreen />);
    fireEvent.click(screen.getByRole("button", { name: "عرض التقرير" }));

    // Account rows, grouped by type.
    expect(screen.getByText("الأصول")).toBeInTheDocument();
    expect(screen.getByText("النقدية")).toBeInTheDocument();
    expect(screen.getByText("إيرادات المبيعات")).toBeInTheDocument();

    // Reconciliation banner: debits = credits at 147,000.00 as of the sample data's full history.
    expect(screen.getByText("إجمالي المدين = إجمالي الدائن")).toBeInTheDocument();
    expect(screen.getByText("=")).toBeInTheDocument();
    expect(screen.getAllByText("147,000.00").length).toBeGreaterThan(0);
  });

  it("recomputes the balance for an earlier as-of date", () => {
    render(<TrialBalanceReportScreen />);
    fireEvent.change(screen.getByLabelText("حتى تاريخ"), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "عرض التقرير" }));
    // Only the opening-capital entry (100,000) has posted by 2026-01-01.
    expect(screen.getAllByText("100,000.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("122,000.00")).not.toBeInTheDocument();
  });

  it("shows a validation error for an invalid as-of date instead of running the query", () => {
    render(<TrialBalanceReportScreen />);
    fireEvent.change(screen.getByLabelText("حتى تاريخ"), { target: { value: "not-a-date" } });
    fireEvent.click(screen.getByRole("button", { name: "عرض التقرير" }));
    expect(screen.getByText("تاريخ غير صالح — استخدم الصيغة YYYY-MM-DD")).toBeInTheDocument();
    expect(screen.queryByText("النقدية")).not.toBeInTheDocument();
  });
});
