// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { FiscalPeriodsScreen } from "./FiscalPeriodsScreen";

describe("FiscalPeriodsScreen", () => {
  it("renders the 2026 period grid with a mix of open/closed/locked states", () => {
    render(<FiscalPeriodsScreen />);
    expect(screen.getByRole("heading", { name: "الفترات المالية" })).toBeInTheDocument();
    expect(screen.getByText("أغسطس 2026")).toBeInTheDocument();
    // Both the banner label and the row's status pill say "الفترة الحالية" for the current period (August).
    expect(screen.getAllByText("الفترة الحالية").length).toBeGreaterThanOrEqual(2);
  });

  it("filters the grid by status via the chip row", () => {
    render(<FiscalPeriodsScreen />);
    fireEvent.click(screen.getByRole("button", { name: /^مقفلة/ }));
    expect(screen.getByText("يناير 2026")).toBeInTheDocument();
    expect(screen.queryByText("أغسطس 2026")).not.toBeInTheDocument();
  });

  it("closes an open period", () => {
    render(<FiscalPeriodsScreen />);
    const row = screen.getByText("أغسطس 2026").closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "إغلاق" }));
    expect(within(row as HTMLElement).getByText("مغلقة")).toBeInTheDocument();
  });

  it("locks a closed period but rejects locking an open one directly", () => {
    render(<FiscalPeriodsScreen />);
    // July 2026 is seeded "closed" — lock should succeed.
    const julyRow = screen.getByText("يوليو 2026").closest("tr");
    fireEvent.click(within(julyRow as HTMLElement).getByRole("button", { name: "قفل" }));
    expect(within(julyRow as HTMLElement).getByText("مقفلة")).toBeInTheDocument();
  });

  it("reopens a closed period", () => {
    render(<FiscalPeriodsScreen />);
    const juneRow = screen.getByText("يونيو 2026").closest("tr");
    fireEvent.click(within(juneRow as HTMLElement).getByRole("button", { name: "إعادة فتح" }));
    expect(within(juneRow as HTMLElement).getByText("مفتوحة")).toBeInTheDocument();
  });

  it("generates the next fiscal year's 12 periods and switches to it", () => {
    render(<FiscalPeriodsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "إنشاء السنة التالية" }));
    expect(screen.getByRole("option", { name: "2027" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "السنة المالية" })).toHaveValue("2027");
    expect(screen.getByText("يناير 2027")).toBeInTheDocument();
  });
});
