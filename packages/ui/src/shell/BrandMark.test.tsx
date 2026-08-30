// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BrandMark } from "./BrandMark";

describe("BrandMark", () => {
  it("renders as a decorative, hidden-from-screen-readers svg", () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("carries the className through to the svg", () => {
    const { container } = render(<BrandMark className="h-[24px] w-[24px] text-accent" />);
    expect(container.querySelector("svg")).toHaveClass("h-[24px]", "w-[24px]", "text-accent");
  });
});
