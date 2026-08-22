// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import type { CommandItem } from "./types";

function makeItems(onSelect: () => void = () => {}): CommandItem[] {
  return [
    { id: "invoice", label: "فاتورة مبيعات جديدة", group: "إجراءات سريعة", onSelect },
    { id: "receipt", label: "سند نقدي جديد", group: "إجراءات سريعة", onSelect },
    { id: "coa", label: "دليل الحسابات", group: "الانتقال إلى", onSelect },
  ];
}

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    render(<CommandPalette open={false} onOpenChange={() => {}} items={makeItems()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists items grouped by their group label when open", () => {
    render(<CommandPalette open onOpenChange={() => {}} items={makeItems()} />);
    expect(screen.getByText("إجراءات سريعة")).toBeInTheDocument();
    expect(screen.getByText("الانتقال إلى")).toBeInTheDocument();
    expect(screen.getByText("دليل الحسابات")).toBeInTheDocument();
  });

  it("filters items as the user types", () => {
    render(<CommandPalette open onOpenChange={() => {}} items={makeItems()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "دليل" } });
    expect(screen.getByText("دليل الحسابات")).toBeInTheDocument();
    expect(screen.queryByText("فاتورة مبيعات جديدة")).not.toBeInTheDocument();
  });

  it("runs onSelect and closes when an item is clicked", () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} items={makeItems(onSelect)} />);
    fireEvent.click(screen.getByText("سند نقدي جديد"));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on Escape", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} items={makeItems()} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("selects the highlighted item on Enter", () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} items={makeItems(onSelect)} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows a no-results message when nothing matches", () => {
    render(<CommandPalette open onOpenChange={() => {}} items={makeItems()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "xyz-no-match" } });
    expect(screen.getByText("لا توجد نتائج مطابقة")).toBeInTheDocument();
  });
});
