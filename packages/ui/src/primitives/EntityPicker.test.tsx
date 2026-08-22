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

  it("shows the selected value as a placeholder when closed", () => {
    render(<EntityPicker value={options[0] ?? null} onChange={() => {}} options={options} label="العميل" />);
    expect(screen.getByRole("combobox")).toHaveAttribute("placeholder", "شركة الأمل للتجارة");
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
