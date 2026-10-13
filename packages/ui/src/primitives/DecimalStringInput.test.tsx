// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DecimalStringInput } from "./DecimalStringInput";

function type(raw: string) {
  const onChange = vi.fn();
  const view = render(<DecimalStringInput value="" onChange={onChange} aria-label="الكمية" />);
  const input = screen.getByLabelText("الكمية");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: raw } });
  fireEvent.blur(input);
  view.unmount();
  return onChange;
}

describe("DecimalStringInput — a quantity stays the decimal the user typed", () => {
  it("hands back exactly the digits typed, to six places", () => {
    expect(type("0.333333")).toHaveBeenLastCalledWith("0.333333");
    expect(type("12.50")).toHaveBeenLastCalledWith("12.50");
    expect(type("9007199254740993.10")).toHaveBeenLastCalledWith("9007199254740993.10");
  });

  it("answers the empty string for what is not a decimal", () => {
    expect(type("")).toHaveBeenLastCalledWith("");
    expect(type("1.1234567")).toHaveBeenLastCalledWith("");
  });

  function Held({ maximumFractionDigits, allowNegative }: { maximumFractionDigits?: number; allowNegative?: boolean }) {
    const [value, setValue] = useState("");
    return <DecimalStringInput value={value} onChange={setValue} aria-label="الكمية" maximumFractionDigits={maximumFractionDigits} allowNegative={allowNegative} />;
  }
  function typeInto(raw: string) {
    const input = screen.getByLabelText("الكمية");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: raw } });
    fireEvent.blur(input);
    return input;
  }

  it("keeps what was typed when it has more decimals than the field holds, and says so in Arabic instead of clearing it", () => {
    render(<Held />);
    const input = typeInto("1.2345678");
    expect(input).toHaveValue("1.2345678");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("حتى 6 خانات عشرية على الأكثر");

    typeInto("1.234567");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).toHaveValue("1.234567");
    expect(input).not.toHaveAttribute("aria-invalid", "true");
  });

  it("holds a field to the number of decimals it is given", () => {
    render(<Held maximumFractionDigits={2} />);
    const input = typeInto("7.125");
    expect(input).toHaveValue("7.125");
    expect(screen.getByRole("alert")).toHaveTextContent("حتى 2 خانات عشرية على الأكثر");
  });

  it("reads Eastern Arabic and Persian digits and the Arabic decimal separator as the number they are", () => {
    expect(type("٣")).toHaveBeenLastCalledWith("3");
    expect(type("١٢٫٥")).toHaveBeenLastCalledWith("12.5");
    expect(type("١٬٢٥٠٫٧٥")).toHaveBeenLastCalledWith("1250.75");
    expect(type("۴۲")).toHaveBeenLastCalledWith("42");
  });

  it("keeps a typed minus where no negative figure is allowed and says so in Arabic, instead of quietly making it positive", () => {
    expect(type("-5")).toHaveBeenLastCalledWith("");
    render(<Held />);
    const input = typeInto("-5");
    expect(input).toHaveValue("-5");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("لا تُقبل القيم السالبة");

    typeInto("5");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).toHaveValue("5");
  });

  it("takes a minus sign where the field allows a negative figure", () => {
    const onChange = vi.fn();
    render(<DecimalStringInput value="" onChange={onChange} aria-label="الفرق" allowNegative />);
    const input = screen.getByLabelText("الفرق");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith("-5");
  });

  it("shows a committed quantity without padding it to two places, and carries no currency beside it", () => {
    render(<DecimalStringInput value="1250" onChange={() => {}} aria-label="الكمية" />);
    expect(screen.getByLabelText("الكمية")).toHaveValue("1,250");
    expect(screen.queryByText("ج.م")).not.toBeInTheDocument();
  });

  it("shows the unit it is given beside the figure", () => {
    render(<DecimalStringInput value="0.5" onChange={() => {}} aria-label="الكمية" suffix="كجم" />);
    expect(screen.getByText("كجم")).toBeInTheDocument();
    expect(screen.getByLabelText("الكمية")).toHaveValue("0.5");
  });
});
