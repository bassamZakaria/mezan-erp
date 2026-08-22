// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QtyInput } from "./QtyInput";

function ControlledQtyInput({ initial = 5, min = 0, max = 100 }: { initial?: number; min?: number; max?: number }) {
  const [value, setValue] = useState(initial);
  return <QtyInput value={value} onChange={setValue} min={min} max={max} aria-label="الكمية" />;
}

describe("QtyInput", () => {
  it("renders the current value", () => {
    render(<ControlledQtyInput />);
    expect(screen.getByRole("textbox")).toHaveValue("5");
  });

  it("increments on the + button", () => {
    render(<ControlledQtyInput />);
    fireEvent.click(screen.getByRole("button", { name: "زيادة الكمية" }));
    expect(screen.getByRole("textbox")).toHaveValue("6");
  });

  it("decrements on the minus button", () => {
    render(<ControlledQtyInput />);
    fireEvent.click(screen.getByRole("button", { name: "إنقاص الكمية" }));
    expect(screen.getByRole("textbox")).toHaveValue("4");
  });

  it("disables the minus button at min and the plus button at max", () => {
    render(<ControlledQtyInput initial={0} min={0} max={1} />);
    expect(screen.getByRole("button", { name: "إنقاص الكمية" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "زيادة الكمية" }));
    expect(screen.getByRole("button", { name: "زيادة الكمية" })).toBeDisabled();
  });

  it("clamps a typed value to the max on blur", () => {
    const onChange = vi.fn();
    render(<QtyInput value={5} onChange={onChange} min={0} max={10} aria-label="الكمية" />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("renders the unit label when provided", () => {
    render(<QtyInput value={3} onChange={() => {}} unit="قطعة" aria-label="الكمية" />);
    expect(screen.getByText("قطعة")).toBeInTheDocument();
  });
});
