import { describe, expect, it } from "vitest";
import { BAR_INSET, RAIL_WIDTH } from "./metrics";

describe("shell metrics", () => {
  it("RAIL_WIDTH is a fixed Tailwind arbitrary-width class the column and its siblings share", () => {
    expect(RAIL_WIDTH).toBe("w-[256px]");
  });

  it("BAR_INSET is a fixed Tailwind inline-padding class the screens bar shares with the header above it", () => {
    expect(BAR_INSET).toBe("ps-[12px]");
  });
});
