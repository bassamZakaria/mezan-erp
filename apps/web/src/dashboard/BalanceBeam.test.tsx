// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../data/test-support";
import { BalanceBeam, beamTiltDegrees } from "./BalanceBeam";

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn(() => ({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("beamTiltDegrees", () => {
  it("returns 0 when there is no load at all", () => {
    expect(beamTiltDegrees(0, 0, 0)).toBe(0);
  });

  it("returns 0 when net is exactly zero even with load present", () => {
    expect(beamTiltDegrees(1000, 1000, 0)).toBe(0);
  });

  it("tilts positive for a net-profit period and negative for a net-loss period", () => {
    const profit = beamTiltDegrees(2000, 1000, 1000);
    const loss = beamTiltDegrees(1000, 2000, -1000);
    expect(profit).toBeGreaterThan(0);
    expect(loss).toBeLessThan(0);
    expect(profit).toBeCloseTo(-loss, 5);
  });

  it("never exceeds the 14-degree maximum tilt regardless of magnitude", () => {
    const tilt = beamTiltDegrees(1_000_000, 0, 1_000_000);
    expect(Math.abs(tilt)).toBeLessThanOrEqual(14);
  });
});

describe("BalanceBeam", () => {
  it("renders an accessible SVG labelled with the given label", () => {
    mockMatchMedia(true);
    renderWithProviders(<BalanceBeam revenue={5000} expenses={3000} net={2000} revenueAtEnd={false} label="ميزان الشهر" />);
    expect(screen.getByRole("img", { name: "ميزان الشهر" })).toBeInTheDocument();
  });

  it("renders already settled (no zero-tilt flash) when prefers-reduced-motion is set", () => {
    mockMatchMedia(true);
    const { container } = renderWithProviders(
      <BalanceBeam revenue={5000} expenses={1000} net={4000} revenueAtEnd={false} label="ميزان" />,
    );
    const beamGroup = container.querySelectorAll("g")[0];
    const transform = beamGroup?.getAttribute("style") ?? "";
    // Under reduced motion the beam settles immediately: some non-zero rotation
    // should already be present on first paint rather than "rotate(0deg)".
    expect(transform).not.toContain("rotate(0.000deg)");
  });

  it("mirrors the tilt sign depending on which side the revenue pan sits", () => {
    mockMatchMedia(true);
    const { container: end } = renderWithProviders(
      <BalanceBeam revenue={5000} expenses={1000} net={4000} revenueAtEnd label="a" />,
    );
    const { container: start } = renderWithProviders(
      <BalanceBeam revenue={5000} expenses={1000} net={4000} revenueAtEnd={false} label="b" />,
    );
    const endAngle = end.querySelectorAll("g")[0]?.getAttribute("style");
    const startAngle = start.querySelectorAll("g")[0]?.getAttribute("style");
    expect(endAngle).not.toBe(startAngle);
  });
});
