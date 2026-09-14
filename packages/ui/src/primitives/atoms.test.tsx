// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Money, StatCard, StatusPill } from "./atoms";

describe("Money", () => {
  it("renders a positive amount with the default currency label", () => {
    render(<Money value={1150} />);
    expect(screen.getByText("1,150.00")).toBeInTheDocument();
    expect(screen.getByText("ج.م")).toBeInTheDocument();
  });

  it("keeps the negative sign attached to the LTR-isolated figure", () => {
    render(<Money value={-18087.5} />);
    expect(screen.getByText("-18,087.50")).toBeInTheDocument();
  });

  it("supports both light and dark theme roots without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<Money value={42} />);
    expect(screen.getByText("42.00")).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });
});

describe("StatCard", () => {
  it("renders a 7-digit money figure without clipping — the value row wraps rather than overflowing", () => {
    render(<StatCard label="إجمالي الأرصدة" value={<Money value={12345678} />} />);
    const value = screen.getByText("12,345,678.00");
    expect(screen.getByText("ج.م")).toBeInTheDocument();
    // The wrapping row and the shrinkable card must both give up their
    // default min-content width, or the card refuses to shrink below the
    // figure's intrinsic width and overflow-hidden clips the currency unit.
    const valueRow = value.closest("div");
    expect(valueRow?.className).toContain("flex-wrap");
    expect(valueRow?.className).toContain("min-w-0");
    const card = valueRow?.parentElement;
    expect(card?.className).toContain("min-w-0");
  });
});

describe("StatusPill", () => {
  it("renders the given label", () => {
    render(<StatusPill label="مؤكد" tone="success" />);
    expect(screen.getByText("مؤكد")).toBeInTheDocument();
  });
});
