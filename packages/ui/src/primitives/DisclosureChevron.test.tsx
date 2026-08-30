// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DisclosureChevron } from "./DisclosureChevron";

describe("DisclosureChevron", () => {
  it("marks data-collapsed true when collapsed", () => {
    const { container } = render(<DisclosureChevron collapsed />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("data-collapsed", "true");
  });

  it("marks data-collapsed false when expanded", () => {
    const { container } = render(<DisclosureChevron collapsed={false} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("data-collapsed", "false");
  });

  it("is decorative — hidden from the accessibility tree", () => {
    const { container } = render(<DisclosureChevron collapsed />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden");
  });

  it("applies a caller className alongside its own", () => {
    const { container } = render(<DisclosureChevron collapsed className="custom-class" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("custom-class");
    expect(svg?.getAttribute("class")).toContain("mz-disclosure-chevron");
  });
});
