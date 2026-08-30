// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EntityPicker, type EntityPickerOption } from "./EntityPicker";

const options: EntityPickerOption[] = [
  { id: "1", label: "شركة الأمل للتجارة", sublabel: "CUST-001" },
  { id: "2", label: "مؤسسة النور للمقاولات", sublabel: "CUST-002" },
  { id: "3", label: "شركة سياج للصناعات", sublabel: "CUST-003" },
];

describe("EntityPicker", () => {
  it("associates the label with the input via htmlFor/id, even without an explicit id prop", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    expect(screen.getByLabelText("العميل")).toBe(screen.getByRole("combobox"));
  });

  it("uses a caller-supplied id instead of generating one", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" id="picker-customer" />);
    const input = screen.getByLabelText("العميل");
    expect(input).toHaveAttribute("id", "picker-customer");
  });

  it("shows the selected entity as the field's VALUE when closed, never as placeholder ink", () => {
    render(<EntityPicker value={options[0] ?? null} onChange={() => {}} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    expect(input).toHaveValue("شركة الأمل للتجارة");
    expect(input).not.toHaveAttribute("placeholder", "شركة الأمل للتجارة");
  });

  it("opens the listbox on focus and lists all options", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("filters options as the user types", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "سياج" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("شركة سياج للصناعات")).toBeInTheDocument();
  });

  it("calls onChange with the selected option", () => {
    const onChange = vi.fn();
    render(<EntityPicker value={null} onChange={onChange} options={options} label="العميل" />);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("مؤسسة النور للمقاولات"));
    expect(onChange).toHaveBeenCalledWith(options[1]);
  });

  it("shows an empty message when nothing matches", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} emptyMessage="لا نتائج" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xyz-no-match" } });
    expect(screen.getByText("لا نتائج")).toBeInTheDocument();
  });

  it("renders against a dark theme root without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option")).toHaveLength(3);
    document.documentElement.removeAttribute("data-theme");
  });
});

describe("EntityPicker — the keyboard path", () => {
  function open() {
    const onChange = vi.fn();
    render(<EntityPicker value={null} onChange={onChange} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    return { input, onChange };
  }

  it("moves the highlight down with ArrowDown and selects it with Enter", () => {
    const { input, onChange } = open();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(options[1]);
  });

  it("selects the first option with Enter alone, without arrowing", () => {
    const { input, onChange } = open();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(options[0]);
  });

  it("moves back up with ArrowUp and stops at the first option", () => {
    const { input, onChange } = open();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(options[0]);
  });

  it("stops at the last option rather than wrapping past the end", () => {
    const { input, onChange } = open();
    for (let i = 0; i < 10; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(options[2]);
  });

  it("closes on Escape without selecting anything", () => {
    const { input, onChange } = open();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens on ArrowDown from a closed picker, so the list is reachable without the mouse", () => {
    const onChange = vi.fn();
    render(<EntityPicker value={null} onChange={onChange} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("selects within the FILTERED list, not the original one", () => {
    const { input, onChange } = open();
    fireEvent.change(input, { target: { value: "سياج" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(options[2]);
  });

  it("selects nothing when the filter matches nothing", () => {
    const { input, onChange } = open();
    fireEvent.change(input, { target: { value: "لا يوجد" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("EntityPicker — Arabic search (D114)", () => {
  it("LIMITATION (D114): a hamza variant finds nothing, because the filter is a plain substring match", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);

    // «الأمل» typed without the hamza — the way an operator in a hurry types it,
    // and the way the customer list itself matches, because that list runs the
    // app's own normaliser. This picker does not.
    fireEvent.change(input, { target: { value: "الامل" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);

    // Spelled exactly, it matches — so the entity is findable only by someone
    // who reproduces the stored spelling character for character.
    fireEvent.change(input, { target: { value: "الأمل" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("matches on the sublabel too, so a code finds its entity", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "CUST-002" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("ignores case and surrounding space in a Latin query", () => {
    render(<EntityPicker value={null} onChange={() => {}} options={options} label="العميل" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "  cust-003  " } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
