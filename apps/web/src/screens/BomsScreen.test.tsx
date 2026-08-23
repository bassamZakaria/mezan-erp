// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { bomCostEstimate } from "@mezan/domain";
import { BomsScreen } from "./BomsScreen";
import { demoBoms, resolveDemoUnitCost } from "../manufacturing-sample-data";

function fmt(m: { toString(): string }) {
  return Number(m.toString()).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

describe.each(["light", "dark"] as const)("BomsScreen (%s theme)", (theme) => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  function renderScreen() {
    document.documentElement.setAttribute("data-theme", theme);
    return render(<BomsScreen />);
  }

  it("lists both BOM versions with their real estimated cost from bomCostEstimate", () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "قوائم المواد" })).toBeInTheDocument();
    expect(screen.getByText("BOM-0001")).toBeInTheDocument();
    expect(screen.getByText("BOM-0002")).toBeInTheDocument();

    const bomT2 = demoBoms.find((b) => b.id === "bom-t2")!;
    const est = bomCostEstimate(bomT2, resolveDemoUnitCost);
    const row = screen.getByText("BOM-0002").closest("tr") as HTMLElement;
    expect(within(row).getByText(fmt(est.totalCost))).toBeInTheDocument();
    expect(within(row).getByText("نشط")).toBeInTheDocument();
  });

  it("filters by status chip", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("tab", { name: /^غير نشط/ }));
    expect(screen.getByText("BOM-0001")).toBeInTheDocument();
    expect(screen.queryByText("BOM-0002")).not.toBeInTheDocument();
  });

  it("filters by search text against the BOM number", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByPlaceholderText("بحث بالرقم أو اسم المنتج…"), "0001");
    expect(screen.getByText("BOM-0001")).toBeInTheDocument();
    expect(screen.queryByText("BOM-0002")).not.toBeInTheDocument();
  });

  it("opens the detail view and shows the real material/total/unit cost breakdown, waste-adjusted line quantities", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByText("BOM-0002"));
    expect(screen.getByRole("heading", { name: "قائمة مواد BOM-0002" })).toBeInTheDocument();

    const bomT2 = demoBoms.find((b) => b.id === "bom-t2")!;
    const est = bomCostEstimate(bomT2, resolveDemoUnitCost);
    function summaryValue(label: string): HTMLElement {
      // The summary strip renders before the material-lines table, which also
      // has a same-named "تكلفة الوحدة" column header — take the first (summary) match.
      const [labelEl] = screen.getAllByText(label);
      return (labelEl as HTMLElement).parentElement as HTMLElement;
    }
    expect(within(summaryValue("تكلفة المواد")).getByText(fmt(est.materialCost))).toBeInTheDocument();
    expect(within(summaryValue("إجمالي التكلفة")).getByText(fmt(est.totalCost))).toBeInTheDocument();
    expect(within(summaryValue("تكلفة الوحدة")).getByText(fmt(est.unitCost))).toBeInTheDocument();

    // m-paint line: qty 0.5, waste 10% → gross-up to 0.550000
    const paintRow = screen.getByText("دهان (لتر)").closest("tr") as HTMLElement;
    expect(within(paintRow).getByText("0.550000")).toBeInTheDocument();
  });

  it("returns to the list from the detail view", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByText("BOM-0001"));
    await user.click(screen.getByRole("button", { name: "رجوع لقوائم المواد" }));
    expect(screen.getByRole("heading", { name: "قوائم المواد" })).toBeInTheDocument();
  });
});
