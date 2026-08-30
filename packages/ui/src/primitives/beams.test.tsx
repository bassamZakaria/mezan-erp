// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { beamDirectionOf, MicroBeam, VarianceBeam } from "./beams";

describe("beamDirectionOf", () => {
  it("reports up for a value above epsilon", () => {
    expect(beamDirectionOf(5)).toBe("up");
  });

  it("reports down for a value below negative epsilon", () => {
    expect(beamDirectionOf(-5)).toBe("down");
  });

  it("reports level for exactly zero", () => {
    expect(beamDirectionOf(0)).toBe("level");
  });

  it("treats a value within a custom epsilon as level", () => {
    expect(beamDirectionOf(0.4, 0.5)).toBe("level");
    expect(beamDirectionOf(-0.4, 0.5)).toBe("level");
  });

  it("treats a value at the epsilon boundary as level (strict inequality)", () => {
    expect(beamDirectionOf(0.5, 0.5)).toBe("level");
    expect(beamDirectionOf(0.50001, 0.5)).toBe("up");
  });
});

describe("MicroBeam", () => {
  it("mirrors under RTL via the rtl: utility class, on every direction", () => {
    for (const direction of ["up", "down", "level"] as const) {
      const { container } = render(<MicroBeam direction={direction} />);
      expect(container.querySelector("svg")).toHaveClass("rtl:-scale-x-100");
    }
  });

  it("is decorative — hidden from the accessibility tree", () => {
    const { container } = render(<MicroBeam direction="up" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden");
  });

  it("tilts the beam group upward for 'up' and downward for 'down'", () => {
    const up = render(<MicroBeam direction="up" />);
    const down = render(<MicroBeam direction="down" />);
    const level = render(<MicroBeam direction="level" />);
    expect(up.container.querySelector("g")?.getAttribute("transform")).toBe("rotate(-13 10 6)");
    expect(down.container.querySelector("g")?.getAttribute("transform")).toBe("rotate(13 10 6)");
    expect(level.container.querySelector("g")?.getAttribute("transform")).toBe("rotate(0 10 6)");
  });
});

describe("VarianceBeam", () => {
  it("uses the success tone for a positive value by default", () => {
    const { container } = render(<VarianceBeam value={10}>+10</VarianceBeam>);
    expect(container.querySelector("span")).toHaveClass("text-success-ink");
  });

  it("uses the danger tone for a negative value by default", () => {
    const { container } = render(<VarianceBeam value={-10}>-10</VarianceBeam>);
    expect(container.querySelector("span")).toHaveClass("text-danger-ink");
  });

  it("inverts the tone when a rise is the bad outcome", () => {
    const { container } = render(
      <VarianceBeam value={10} invertTone>
        +10
      </VarianceBeam>,
    );
    expect(container.querySelector("span")).toHaveClass("text-danger-ink");
  });

  it("never inverts a level tone (invertTone has no effect at zero)", () => {
    const { container } = render(
      <VarianceBeam value={0} invertTone>
        0
      </VarianceBeam>,
    );
    expect(container.querySelector("span")).toHaveClass("text-ink-faint");
  });

  it("renders the children figure beside the beam", () => {
    const { getByText } = render(<VarianceBeam value={5}>+5.00</VarianceBeam>);
    expect(getByText("+5.00")).toBeInTheDocument();
  });
});
