// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MoneyInput } from "./MoneyInput";

function ControlledMoneyInput({ initial = 1150 }: { initial?: number | null }) {
  const [value, setValue] = useState<number | null>(initial);
  return <MoneyInput value={value} onChange={setValue} aria-label="المبلغ" />;
}

describe("MoneyInput", () => {
  it("shows the formatted figure while blurred", () => {
    render(<ControlledMoneyInput />);
    expect(screen.getByRole("textbox")).toHaveValue("1,150.00");
  });

  it("shows a raw editable draft while focused", () => {
    render(<ControlledMoneyInput />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    expect(input).toHaveValue("1150");
  });

  it("commits a parsed number on blur", () => {
    const onChange = vi.fn();
    render(<MoneyInput value={0} onChange={onChange} aria-label="المبلغ" />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2500.5" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(2500.5);
  });

  it("commits null for an empty field", () => {
    const onChange = vi.fn();
    render(<MoneyInput value={10} onChange={onChange} aria-label="المبلغ" />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("renders the currency label and supports a custom one", () => {
    render(<MoneyInput value={5} onChange={() => {}} currencyLabel="ر.س" aria-label="المبلغ" />);
    expect(screen.getByText("ر.س")).toBeInTheDocument();
  });

  it("renders against a dark theme root without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<ControlledMoneyInput />);
    expect(screen.getByRole("textbox")).toHaveValue("1,150.00");
    document.documentElement.removeAttribute("data-theme");
  });
});
