// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DonutChart, TrendChart } from "./charts";

const trendSeries = [
  { key: "revenue", label: "الإيرادات", color: "var(--chart-1)", values: [50, 60, 70, 86.24] },
  { key: "expenses", label: "المصروفات", color: "var(--chart-2)", values: [40, 45, 58, 61.93] },
];

const donutSegments = [
  { key: "cogs", label: "تكلفة البضاعة المباعة", value: 950, color: "var(--chart-1)" },
  { key: "waste", label: "هالك التصنيع", value: 50, color: "var(--chart-3)" },
];

describe.each(["light", "dark"] as const)("charts (%s theme)", (theme) => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("TrendChart renders title, legend and a queryable data table", () => {
    document.documentElement.setAttribute("data-theme", theme);
    render(
      <TrendChart
        title="أداء الفترة"
        hint="الخط المتقطع = الشهر الحالي (جزئي)"
        categories={["مايو", "يونيو", "يوليو", "أغسطس"]}
        series={trendSeries}
        partialFromIndex={3}
      />,
    );
    expect(screen.getByRole("heading", { name: "أداء الفترة" })).toBeInTheDocument();
    expect(screen.getAllByText("الإيرادات").length).toBeGreaterThan(0);
    expect(screen.getAllByText("المصروفات").length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: "أداء الفترة" })).toBeInTheDocument();
    expect(screen.getByText("86.24")).toBeInTheDocument();
  });

  it("TrendChart wires the range toggle", () => {
    document.documentElement.setAttribute("data-theme", theme);
    const onRangeChange = vi.fn();
    render(
      <TrendChart
        title="أداء الفترة"
        categories={["مايو", "يونيو"]}
        series={[{ key: "revenue", label: "الإيرادات", color: "var(--chart-1)", values: [10, 20] }]}
        rangeOptions={[
          { value: "3", label: "3 أشهر" },
          { value: "6", label: "6 أشهر" },
        ]}
        activeRange="6"
        onRangeChange={onRangeChange}
      />,
    );
    expect(screen.getByRole("button", { name: "6 أشهر" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "3 أشهر" }));
    expect(onRangeChange).toHaveBeenCalledWith("3");
  });

  it("DonutChart renders center label and per-segment percentages", () => {
    document.documentElement.setAttribute("data-theme", theme);
    render(
      <DonutChart
        title="توزيع المصروفات"
        segments={donutSegments}
        centerLabel="21.4 ألف"
        centerSub="الإجمالي (ج.م)"
      />,
    );
    expect(screen.getByRole("heading", { name: "توزيع المصروفات" })).toBeInTheDocument();
    expect(screen.getByText("21.4 ألف")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
    expect(screen.getByText("5%")).toBeInTheDocument();
  });

  it("DonutChart falls back to a neutral ring when every segment is zero", () => {
    document.documentElement.setAttribute("data-theme", theme);
    render(<DonutChart title="توزيع المصروفات" segments={[{ key: "x", label: "بدون بيانات", value: 0, color: "var(--chart-1)" }]} centerLabel="0.00" />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});
