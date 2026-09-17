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

describe("CommandBar — finding a report by its own title (§8.4)", () => {
  const items = [
    { id: "goto-financial-reports", label: "التقارير المالية", group: "انتقل", keywords: ["قائمة الدخل", "الميزانية العمومية"], onSelect: () => {} },
    { id: "goto-customers", label: "العملاء", group: "انتقل", onSelect: () => {} },
  ];

  function type(query: string) {
    render(<CommandBar items={items} />);
    const field = screen.getByRole("combobox");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: query } });
    return screen.queryAllByRole("option").map((o) => o.textContent ?? "");
  }

  it("finds a statement that lives inside another screen", () => {
    // «قائمة الدخل» is a tab within «التقارير المالية» and has no nav label, so
    // the bar used to return nothing at all for it.
    const results = type("قائمة الدخل");
    expect(results.join(" ")).toContain("التقارير المالية");
  });

  it("forgives the hamza the user did not type", () => {
    // A raw `includes` matched nothing here, which in an Arabic product is the
    // common case rather than an edge one.
    expect(type("الميزانيه").join(" ")).toContain("التقارير المالية");
  });

  it("still matches on the label itself", () => {
    expect(type("العملاء").join(" ")).toContain("العملاء");
  });

  it("does not turn a keyword into a false positive for an unrelated command", () => {
    const results = type("قائمة الدخل");
    expect(results.join(" ")).not.toContain("العملاء");
  });
});
