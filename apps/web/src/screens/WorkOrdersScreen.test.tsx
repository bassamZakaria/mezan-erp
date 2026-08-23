// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkOrdersScreen } from "./WorkOrdersScreen";

describe.each(["light", "dark"] as const)("WorkOrdersScreen (%s theme)", (theme) => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  function renderScreen() {
    document.documentElement.setAttribute("data-theme", theme);
    return render(<WorkOrdersScreen />);
  }

  it("lists the seeded work orders with their status, priority and production progress", () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "أوامر التصنيع" })).toBeInTheDocument();
    expect(screen.getByText("WO-0001")).toBeInTheDocument();
    expect(screen.getByText("WO-0003")).toBeInTheDocument();
    // wo-3 is fully produced: 8/8 · 100%
    const row3 = screen.getByText("WO-0003").closest("tr") as HTMLElement;
    expect(within(row3).getByText("8.000000/8.000000 · 100%")).toBeInTheDocument();
    expect(within(row3).getByText("مكتمل")).toBeInTheDocument();
  });

  it("filters by status via the status chips", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("tab", { name: /^مخطط/ }));
    expect(screen.getByText("WO-0004")).toBeInTheDocument();
    expect(screen.queryByText("WO-0001")).not.toBeInTheDocument();
  });

  it("filters by search text against the order number", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByPlaceholderText("بحث في أوامر العمل…"), "0002");
    expect(screen.getByText("WO-0002")).toBeInTheDocument();
    expect(screen.queryByText("WO-0001")).not.toBeInTheDocument();
  });

  it("opens the detail view and shows the real WIP total (materials + labor + overhead + extra)", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByText("WO-0002"));
    expect(screen.getByRole("heading", { name: "أمر تصنيع WO-0002" })).toBeInTheDocument();
    // wo-2: materialCost 635 + laborCost 55 + overheadCost 30 + extraCost 0 = 720.00
    expect(screen.getByText("720.00")).toBeInTheDocument();
  });

  it("advances the work order through its stages and updates the status pill", async () => {
    const user = userEvent.setup();
    renderScreen();
    // wo-4 starts not_started/planned
    await user.click(screen.getByText("WO-0004"));
    expect(screen.getByText("مخطط")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "بدء العمل" }));
    // advancing from not_started moves status to in_progress and offers the next action
    expect(screen.getByText("قيد التنفيذ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "صرف المواد" })).toBeInTheDocument();
  });

  it("returns to the list from the detail view", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByText("WO-0001"));
    await user.click(screen.getByRole("button", { name: "رجوع لأوامر التصنيع" }));
    expect(screen.getByRole("heading", { name: "أوامر التصنيع" })).toBeInTheDocument();
  });
});
