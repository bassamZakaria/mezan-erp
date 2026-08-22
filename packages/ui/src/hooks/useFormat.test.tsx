// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useFormat } from "./useFormat";

function FormatProbe({ numerals }: { numerals?: "western" | "arabic" }) {
  const format = useFormat({ numerals });
  return (
    <div>
      <span data-testid="money">{format.money(1150)}</span>
      <span data-testid="number">{format.number(86240)}</span>
      <span data-testid="date">{format.date("2026-08-10T00:00:00")}</span>
      <span data-testid="currency-label">{format.currencyLabel}</span>
    </div>
  );
}

describe("useFormat", () => {
  it("formats money, numbers, and dates with western numerals by default", () => {
    render(<FormatProbe />);
    expect(screen.getByTestId("money")).toHaveTextContent("1,150.00");
    expect(screen.getByTestId("number")).toHaveTextContent("86,240");
    expect(screen.getByTestId("date")).toHaveTextContent("10/08/2026");
    expect(screen.getByTestId("currency-label")).toHaveTextContent("ج.م");
  });

  it("honors an arabic numeral preference for dates", () => {
    render(<FormatProbe numerals="arabic" />);
    expect(screen.getByTestId("date")).toHaveTextContent("١٠/٠٨/٢٠٢٦");
  });
});
