// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MoneyStringInput } from "./MoneyStringInput";

function type(raw: string, value = "") {
  const onChange = vi.fn();
  const view = render(<MoneyStringInput value={value} onChange={onChange} aria-label="المبلغ" />);
  const input = screen.getByLabelText("المبلغ");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: raw } });
  fireEvent.blur(input);
  view.unmount();
  return onChange;
}

describe("MoneyStringInput — an amount stays the decimal the user typed", () => {
  it("hands back exactly the digits typed, where a binary number would not hold them", () => {
    expect(type("9007199254740993.10")).toHaveBeenLastCalledWith("9007199254740993.10");
    expect(type("0.30")).toHaveBeenLastCalledWith("0.30");
    expect(type("1250.123456")).toHaveBeenLastCalledWith("1250.123456");
  });

  it("drops what is not part of a decimal and a dot left hanging", () => {
    expect(type("1,250.50 ج.م")).toHaveBeenLastCalledWith("1250.50");
    expect(type("48700.")).toHaveBeenLastCalledWith("48700");
    expect(type(".5")).toHaveBeenLastCalledWith("0.5");
  });

  it("answers the empty string for nothing, a bare sign, or more than six decimals", () => {
    expect(type("")).toHaveBeenLastCalledWith("");
    expect(type("-")).toHaveBeenLastCalledWith("");
    expect(type("1.1234567")).toHaveBeenLastCalledWith("");
  });

  it("shows the committed amount grouped, from its own digits", () => {
    render(<MoneyStringInput value="9007199254740993.10" onChange={() => {}} aria-label="المبلغ" />);
    expect(screen.getByLabelText("المبلغ")).toHaveValue("9,007,199,254,740,993.10");
  });
});
