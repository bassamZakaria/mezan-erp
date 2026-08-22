// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { BranchesPage } from "./BranchesPage";

describe("BranchesPage", () => {
  it("lists the sample branches", () => {
    render(<BranchesPage />);
    expect(screen.getByRole("heading", { name: "الفروع" })).toBeInTheDocument();
    expect(screen.getByText("MAIN")).toBeInTheDocument();
    expect(screen.getByText("فرع الإسكندرية")).toBeInTheDocument();
  });

  it("opens the Branch 360 detail on row click, with an Overview tab and stub tabs", () => {
    render(<BranchesPage />);
    fireEvent.click(screen.getByText("MAIN"));
    expect(screen.getByRole("heading", { name: /الفرع الرئيسي/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "نظرة عامة" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "المخزون" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "المخزون" }));
    expect(screen.getAllByText("قريباً").length).toBeGreaterThan(0);
  });

  it("returns to the list from the detail view", () => {
    render(<BranchesPage />);
    fireEvent.click(screen.getByText("MAIN"));
    fireEvent.click(screen.getByRole("button", { name: "رجوع لقائمة الفروع" }));
    expect(screen.getByRole("heading", { name: "الفروع" })).toBeInTheDocument();
  });

  it("adds a new branch through the side panel", () => {
    render(<BranchesPage />);
    fireEvent.click(screen.getByRole("button", { name: "إضافة فرع" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة فرع" });
    fireEvent.change(within(dialog).getByLabelText("اسم الفرع"), { target: { value: "فرع الجيزة" } });
    fireEvent.change(within(dialog).getByLabelText("رمز الفرع"), { target: { value: "GIZA" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الفرع" }));

    expect(screen.getByText("فرع الجيزة")).toBeInTheDocument();
  });

  it("shows a domain validation error instead of adding an invalid branch", () => {
    render(<BranchesPage />);
    fireEvent.click(screen.getByRole("button", { name: "إضافة فرع" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة فرع" });
    // Leave name/code empty and try to save.
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الفرع" }));
    expect(within(dialog).getByText(/Invalid branch/)).toBeInTheDocument();
  });
});
