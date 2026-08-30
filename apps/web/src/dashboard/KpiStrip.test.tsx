// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../data/test-support";
import { KpiTile, MicroBeam } from "./KpiStrip";

describe("KpiTile", () => {
  it("renders the label and a formatted money value", () => {
    renderWithProviders(
      <KpiTile label="الإيرادات" value={12500.5} direction="up" deltaTone="good" delta="+12%" rtl />,
    );
    expect(screen.getByText("الإيرادات")).toBeInTheDocument();
    expect(screen.getByText("12,500.50")).toBeInTheDocument();
    expect(screen.getByText("+12%")).toBeInTheDocument();
  });

  it("applies the danger tone class when valueTone is bad", () => {
    renderWithProviders(
      <KpiTile label="المصروفات" value={900} valueTone="bad" direction="down" deltaTone="bad" delta="-5%" rtl={false} />,
    );
    const valueNode = screen.getByText("900.00").closest("div.font-display");
    expect(valueNode).toHaveClass("text-danger-ink");
  });

  it("keeps the formatted figure after a re-render with a new value", () => {
    const { rerender } = renderWithProviders(
      <KpiTile label="الإيرادات" value={100} direction="level" deltaTone="neutral" delta="0%" rtl={false} />,
    );
    expect(screen.getByText("100.00")).toBeInTheDocument();

    rerender(<KpiTile label="الإيرادات" value={250.25} direction="up" deltaTone="good" delta="+5%" rtl={false} />);
    expect(screen.getByText("250.25")).toBeInTheDocument();
    expect(screen.queryByText("100.00")).not.toBeInTheDocument();
  });
});

describe("MicroBeam", () => {
  it("renders a flat beam (no rotation) for a level direction", () => {
    const { container } = renderWithProviders(<MicroBeam direction="level" rtl={false} />);
    const g = container.querySelector("g");
    expect(g?.getAttribute("transform")).toBe("rotate(0 10 6)");
  });

  it("mirrors the tilt sign for RTL vs LTR on the same direction", () => {
    const { container: ltr } = renderWithProviders(<MicroBeam direction="up" rtl={false} />);
    const { container: rtl } = renderWithProviders(<MicroBeam direction="up" rtl />);
    const ltrTransform = ltr.querySelector("g")?.getAttribute("transform");
    const rtlTransform = rtl.querySelector("g")?.getAttribute("transform");
    expect(ltrTransform).not.toBe(rtlTransform);
  });
});
