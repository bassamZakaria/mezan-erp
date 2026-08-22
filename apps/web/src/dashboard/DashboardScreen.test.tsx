// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DashboardScreen } from "./DashboardScreen";

describe.each(["light", "dark"] as const)("DashboardScreen (%s theme)", (theme) => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders the greeting header, quick actions and KPI tiles", () => {
    document.documentElement.setAttribute("data-theme", theme);
    render(<DashboardScreen />);
    expect(screen.getByRole("heading", { name: "مرحباً، محمد · طاب يومك" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "فاتورة جديدة" })).toBeInTheDocument();
    expect(screen.getByText("إجمالي الإيرادات · هذا الشهر")).toBeInTheDocument();
    expect(screen.getByText("86,240.00")).toBeInTheDocument();
    expect(screen.getByText("-18,087.50")).toBeInTheDocument();
  });

  it("renders needs-follow-up actions and the company-wide KPI row", () => {
    render(<DashboardScreen />);
    expect(screen.getByText("يحتاج متابعة")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تحصيل الآن" })).toBeInTheDocument();
    expect(screen.getByText("مبالغ لدى العملاء")).toBeInTheDocument();
    expect(screen.getByText("604,950.90")).toBeInTheDocument();
  });

  it("renders the aging widget and recent activity", () => {
    render(<DashboardScreen />);
    expect(screen.getByText("المبالغ المتأخرة")).toBeInTheDocument();
    expect(screen.getByText("العملاء")).toBeInTheDocument();
    expect(screen.getByText("الموردون")).toBeInTheDocument();
    expect(screen.getByText(/اكتمل أمر التصنيع WO-0010/)).toBeInTheDocument();
  });

  it("renders the expense donut with the documented category split", () => {
    render(<DashboardScreen />);
    expect(screen.getByRole("heading", { name: "توزيع المصروفات" })).toBeInTheDocument();
    expect(screen.getByText("21.4 ألف")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
  });

  it("defaults the revenue trend to the 6-month range and switches on toggle", () => {
    render(<DashboardScreen />);
    const trendGroup = screen.getByRole("group", { name: "أداء الفترة" });
    expect(within(trendGroup).getByRole("button", { name: "6 أشهر" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("مارس")).toBeInTheDocument();

    fireEvent.click(within(trendGroup).getByRole("button", { name: "3 أشهر" }));
    expect(screen.queryByText("مارس")).not.toBeInTheDocument();
    expect(screen.getByText("أغسطس")).toBeInTheDocument();
  });

  it("re-sorts top items by quantity and toggles tax-exclusive amounts", () => {
    render(<DashboardScreen />);
    const optionsGroup = screen.getByRole("group", { name: "خيارات العرض · الأصناف الأعلى مبيعاً" });
    expect(screen.getByText("18,900.00")).toBeInTheDocument();

    fireEvent.click(within(optionsGroup).getByRole("button", { name: "غير شامل الضريبة" }));
    expect(screen.getByText("16,578.95")).toBeInTheDocument();
  });

  it("shows the company-wide footer disclaimer", () => {
    render(<DashboardScreen />);
    expect(
      screen.getByText("جميع الأرقام المالية مصدرها القيود المحاسبية المرحلة · نطاق الفرع لا يؤثر على الأرقام على مستوى الشركة"),
    ).toBeInTheDocument();
  });
});
