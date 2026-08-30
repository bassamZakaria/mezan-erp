// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandPalette, CommandTrigger, useCommandPaletteShortcut } from "./CommandPalette";
import type { CommandItem } from "./types";

function items(): CommandItem[] {
  return [
    { id: "coa", label: "دليل الحسابات", group: "الانتقال إلى", onSelect: vi.fn() },
    { id: "customers", label: "العملاء", group: "الانتقال إلى", onSelect: vi.fn() },
  ];
}

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    render(<CommandPalette items={items()} open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows every command, grouped, when open", () => {
    render(<CommandPalette items={items()} open onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("دليل الحسابات")).toBeInTheDocument();
    expect(screen.getByText("العملاء")).toBeInTheDocument();
  });

  it("shows the empty state when the query matches nothing", () => {
    render(<CommandPalette items={items()} open onClose={() => {}} />);
    fireEvent.change(screen.getByRole("combobox", { name: "لوحة الأوامر" }), { target: { value: "زززز" } });
    expect(screen.getByText("لا توجد نتائج مطابقة")).toBeInTheDocument();
  });

  it("running a command via click calls onSelect and onClose", () => {
    const list = items();
    const onClose = vi.fn();
    render(<CommandPalette items={list} open onClose={onClose} />);
    fireEvent.click(screen.getByText("العملاء"));
    expect(list[1]?.onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ArrowDown then Enter runs the highlighted command", () => {
    const list = items();
    const onClose = vi.fn();
    render(<CommandPalette items={list} open onClose={onClose} />);
    const input = screen.getByRole("combobox", { name: "لوحة الأوامر" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(list[1]?.onSelect).toHaveBeenCalledOnce();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<CommandPalette items={items()} open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when the scrim (outside the dialog box) is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<CommandPalette items={items()} open onClose={onClose} />);
    const scrim = container.firstElementChild as HTMLElement;
    fireEvent.mouseDown(scrim, { target: scrim });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not close when the dialog box itself is clicked", () => {
    const onClose = vi.fn();
    render(<CommandPalette items={items()} open onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses the placeholder prop over the default when supplied", () => {
    render(<CommandPalette items={items()} open onClose={() => {}} placeholder="دوّر على حاجة" />);
    expect(screen.getByPlaceholderText("دوّر على حاجة")).toBeInTheDocument();
  });
});

describe("CommandTrigger", () => {
  it("carries the full label and Meta+K/Control+K keyboard shortcut when not compact", () => {
    const onOpen = vi.fn();
    render(<CommandTrigger onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: /^بحث وأوامر/ });
    expect(button).toHaveAttribute("aria-keyshortcuts", "Meta+K Control+K");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("compact mode folds the shortcut into the accessible name and shows the short label", () => {
    render(<CommandTrigger onOpen={() => {}} compact />);
    expect(screen.getByText("بحث")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /بحث وأوامر \(.*K\)/ })).toBeInTheDocument();
  });
});

describe("useCommandPaletteShortcut", () => {
  it("Ctrl+K and Cmd+K both call the supplied onOpen", () => {
    const onOpen = vi.fn();
    function Host() {
      useCommandPaletteShortcut(onOpen);
      return null;
    }
    render(<Host />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("wires the real open/close state end to end", () => {
    function Host() {
      const [open, setOpen] = useState(false);
      useCommandPaletteShortcut(() => setOpen(true));
      return <CommandPalette items={items()} open={open} onClose={() => setOpen(false)} />;
    }
    render(<Host />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
