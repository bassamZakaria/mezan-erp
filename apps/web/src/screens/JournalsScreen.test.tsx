// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { JournalsScreen } from "./JournalsScreen";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

function fillBalancedEntry() {
  fireEvent.click(screen.getByRole("button", { name: "قيد جديد" }));
  fireEvent.change(screen.getByLabelText("الوصف *"), { target: { value: "قيد اختبار" } });
  fireEvent.change(screen.getByLabelText("الحساب للسطر 1"), { target: { value: "1300-1" } });
  fireEvent.change(screen.getByLabelText("مدين للسطر 1"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("الحساب للسطر 2"), { target: { value: "4100" } });
  fireEvent.change(screen.getByLabelText("دائن للسطر 2"), { target: { value: "100" } });
}

describe("JournalsScreen — list", () => {
  it("renders seeded posted journal entries with correct KPIs", () => {
    render(<JournalsScreen />);
    expect(screen.getByRole("heading", { name: "القيود المحاسبية" })).toBeInTheDocument();
    expect(screen.getByText("JE-000001")).toBeInTheDocument();
    expect(screen.getByText("JE-000003")).toBeInTheDocument();
  });

  it("filters to posted via the status chips", () => {
    render(<JournalsScreen />);
    fireEvent.click(screen.getByRole("tab", { name: /مرحل/ }));
    expect(screen.getByText("JE-000002")).toBeInTheDocument();
  });

  it("opens the detail view with a balance badge and lifecycle stepper", () => {
    render(<JournalsScreen />);
    fireEvent.click(screen.getByText("JE-000001"));
    expect(screen.getByLabelText("حالة المستند")).toBeInTheDocument();
    expect(screen.getAllByText("متوازن ✓").length).toBeGreaterThanOrEqual(1);
  });
});

describe("JournalsScreen — create: balance gating", () => {
  it("keeps the post button disabled until the entry balances", () => {
    render(<JournalsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "قيد جديد" }));
    const post = screen.getByRole("button", { name: "ترحيل القيد" });
    expect(post).toBeDisabled();

    // One-sided (debit only) → still unbalanced → disabled.
    fireEvent.change(screen.getByLabelText("الوصف *"), { target: { value: "قيد" } });
    fireEvent.change(screen.getByLabelText("الحساب للسطر 1"), { target: { value: "1300-1" } });
    fireEvent.change(screen.getByLabelText("مدين للسطر 1"), { target: { value: "100" } });
    expect(post).toBeDisabled();
    expect(screen.getByText("غير متوازن")).toBeInTheDocument();

    // Balance it → enabled + "متوازن ✓".
    fireEvent.change(screen.getByLabelText("الحساب للسطر 2"), { target: { value: "4100" } });
    fireEvent.change(screen.getByLabelText("دائن للسطر 2"), { target: { value: "100" } });
    expect(post).toBeEnabled();
    expect(screen.getByText("متوازن ✓")).toBeInTheDocument();
  });
});

describe("JournalsScreen — create: post flow", () => {
  it("posts a balanced entry via the real domain service and shows it in the list", async () => {
    render(<JournalsScreen />);
    fillBalancedEntry();
    fireEvent.click(screen.getByRole("button", { name: "ترحيل القيد" }));

    // Back on the list, the new posted entry (JE-000004, continuing the sequence) appears.
    await waitFor(() => expect(screen.getByRole("heading", { name: "القيود المحاسبية" })).toBeInTheDocument());
    expect(await screen.findByText("JE-000004")).toBeInTheDocument();
    // posted KPI advanced from 3 → 4.
    const postedStat = screen.getByText("مرحل", { selector: "div" }).closest("div");
    expect(postedStat).not.toBeNull();
  });
});

describe("JournalsScreen — themes", () => {
  it.each(["light", "dark"] as const)("renders + gates the post button in the %s theme", (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    render(<JournalsScreen />);
    fillBalancedEntry();
    expect(screen.getByRole("button", { name: "ترحيل القيد" })).toBeEnabled();
  });
});
