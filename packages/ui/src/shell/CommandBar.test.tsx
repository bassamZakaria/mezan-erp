// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandBar } from "./CommandBar";
import type { CommandItem } from "./types";

function items(): CommandItem[] {
  return [
    { id: "coa", label: "دليل الحسابات", group: "الانتقال إلى", onSelect: vi.fn() },
    { id: "customers", label: "العملاء", group: "الانتقال إلى", onSelect: vi.fn() },
    { id: "sales-invoices", label: "فواتير المبيعات", group: "المستندات", onSelect: vi.fn() },
  ];
}

describe("CommandBar", () => {
  it("opens the results list on focus and shows every item, grouped", () => {
    render(<CommandBar items={items()} />);
    const input = screen.getByRole("combobox", { name: "لوحة الأوامر" });
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("دليل الحسابات")).toBeInTheDocument();
    expect(screen.getByText("العملاء")).toBeInTheDocument();
    expect(screen.getByText("فواتير المبيعات")).toBeInTheDocument();
    expect(screen.getByText("الانتقال إلى")).toBeInTheDocument();
    expect(screen.getByText("المستندات")).toBeInTheDocument();
  });

  it("filters items by the typed query, case-insensitively", () => {
    render(<CommandBar items={items()} />);
    const input = screen.getByRole("combobox", { name: "لوحة الأوامر" });
    fireEvent.change(input, { target: { value: "عملاء" } });
    expect(screen.getByText("العملاء")).toBeInTheDocument();
    expect(screen.queryByText("دليل الحسابات")).toBeNull();
  });

  it("shows the empty state when nothing matches", () => {
    render(<CommandBar items={items()} />);
    const input = screen.getByRole("combobox", { name: "لوحة الأوامر" });
    fireEvent.change(input, { target: { value: "زززز" } });
    expect(screen.getByText("لا توجد نتائج مطابقة")).toBeInTheDocument();
  });

  it("running a command via click calls onSelect and clears + closes the field", () => {
    const list = items();
    render(<CommandBar items={list} />);
    const input = screen.getByRole("combobox", { name: "لوحة الأوامر" }) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.click(screen.getByText("العملاء"));
    expect(list[1]?.onSelect).toHaveBeenCalledOnce();
    expect(input.value).toBe("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("ArrowDown/ArrowUp move the highlight and Enter runs the highlighted command", () => {
    const list = items();
    render(<CommandBar items={list} />);
    const input = screen.getByRole("combobox", { name: "لوحة الأوامر" });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(list[1]?.onSelect).toHaveBeenCalledOnce();
  });

  it("Escape closes the results without clearing the query", () => {
    render(<CommandBar items={items()} />);
    const input = screen.getByRole("combobox", { name: "لوحة الأوامر" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "عملاء" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.value).toBe("عملاء");
  });

  it("opens on Ctrl+K from anywhere and focuses the field", () => {
    render(<CommandBar items={items()} />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox", { name: "لوحة الأوامر" });
    expect(document.activeElement).toBe(input);
  });

  it("closes when a pointer-down lands outside the field", () => {
    render(<CommandBar items={items()} />);
    const input = screen.getByRole("combobox", { name: "لوحة الأوامر" });
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("uses the placeholder prop over the default when supplied", () => {
    render(<CommandBar items={items()} placeholder="دوّر على حاجة" />);
    expect(screen.getByPlaceholderText("دوّر على حاجة")).toBeInTheDocument();
  });
});
