// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CostCentersScreen } from "./CostCentersScreen";

describe("CostCentersScreen", () => {
  it("renders the tree with the sample cost centers, expanded by default", () => {
    render(<CostCentersScreen />);
    expect(screen.getByRole("heading", { name: "مراكز التكلفة" })).toBeInTheDocument();
    expect(screen.getByText("الإدارة العامة")).toBeInTheDocument();
    expect(screen.getByText("المبيعات")).toBeInTheDocument();
    expect(screen.getByText("فرع الإسكندرية")).toBeInTheDocument();
  });

  it("filters the list by type", () => {
    render(<CostCentersScreen />);
    fireEvent.change(screen.getByLabelText("تصفية حسب النوع"), { target: { value: "branch" } });
    expect(screen.getByText("فرع الإسكندرية")).toBeInTheDocument();
    expect(screen.queryByText("الإدارة العامة")).not.toBeInTheDocument();
  });

  it("adds a new root cost center through the side panel", () => {
    render(<CostCentersScreen />);
    fireEvent.click(screen.getByRole("button", { name: "إضافة مركز تكلفة" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة مركز تكلفة" });
    fireEvent.change(within(dialog).getByLabelText("الكود *"), { target: { value: "CC-099" } });
    fireEvent.change(within(dialog).getByLabelText("الاسم *"), { target: { value: "مركز تجريبي" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(screen.getByText("مركز تجريبي")).toBeInTheDocument();
  });

  it("rejects a duplicate cost center code with an inline error", () => {
    render(<CostCentersScreen />);
    fireEvent.click(screen.getByRole("button", { name: "إضافة مركز تكلفة" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة مركز تكلفة" });
    fireEvent.change(within(dialog).getByLabelText("الكود *"), { target: { value: "CC-001" } });
    fireEvent.change(within(dialog).getByLabelText("الاسم *"), { target: { value: "نسخة" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(screen.getByRole("alert")).toHaveTextContent("مستخدم بالفعل");
  });

  it("opens the detail panel on row click and shows its parent and children", () => {
    render(<CostCentersScreen />);
    fireEvent.click(screen.getByText("الإدارة العامة"));
    const panel = screen.getByRole("dialog", { name: /الإدارة العامة/ });
    expect(within(panel).getByText("بدون مركز رئيسي")).toBeInTheDocument();
    expect(within(panel).getByText(/المراكز الفرعية/)).toBeInTheDocument();
  });
});
