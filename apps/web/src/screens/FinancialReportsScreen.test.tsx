// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FinancialReportsScreen } from "./FinancialReportsScreen";

describe("FinancialReportsScreen", () => {
  it("auto-runs the trial balance tab with a balanced reconciliation banner", () => {
    render(<FinancialReportsScreen />);
    // Trial balance is the default tab and auto-runs.
    expect(screen.getByRole("heading", { name: "ميزان المراجعة" })).toBeInTheDocument();
    expect(screen.getByText("إجمالي المدين = إجمالي الدائن")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "ميزان المراجعة" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to the balance sheet tab and shows the A = L + E check", () => {
    render(<FinancialReportsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "الميزانية العمومية" }));
    expect(screen.getByRole("heading", { name: "الميزانية العمومية" })).toBeInTheDocument();
    expect(screen.getByText("الأصول = الالتزامات + حقوق الملكية")).toBeInTheDocument();
  });

  it("shows the VAT net-payable summary on the VAT tab", () => {
    render(<FinancialReportsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "إقرار ضريبة القيمة المضافة" }));
    expect(screen.getByText(/صافي الضريبة المستحقة الدفع/)).toBeInTheDocument();
  });

  it("gates the on-demand general ledger behind عرض التقرير", () => {
    render(<FinancialReportsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "دفتر الأستاذ العام" }));
    // Placeholder until run.
    expect(screen.getByText(/اضغط "عرض التقرير"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "عرض التقرير" }));
    expect(screen.getByText("إجمالي المدين = إجمالي الدائن")).toBeInTheDocument();
  });

  it("keeps an Excel export control available on every tab", () => {
    render(<FinancialReportsScreen />);
    const exportButton = screen.getByRole("button", { name: "تصدير Excel" });
    expect(exportButton).toBeInTheDocument();
    // The trial balance auto-ran, so export is enabled (rows present).
    expect(exportButton).toBeEnabled();
  });
});
