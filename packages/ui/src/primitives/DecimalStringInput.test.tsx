// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
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
