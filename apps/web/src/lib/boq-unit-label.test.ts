import { describe, expect, it } from "vitest";
import { unitLabel } from "./boq-unit-label";

const t = (key: string) => {
  const arabic: Record<string, string> = {
    "boq.unit.m3": "م٣",
    "boq.unit.ton": "طن",
    "boq.unit.lump_sum": "مقطوعية",
  };
  return arabic[key] ?? key;
};

describe("unitLabel", () => {
  it("resolves a stored unit code to its translated label", () => {
    expect(unitLabel("m3", t)).toBe("م٣");
    expect(unitLabel("ton", t)).toBe("طن");
    expect(unitLabel("lump_sum", t)).toBe("مقطوعية");
  });

  it("falls back to the raw code for a unit the map doesn't recognise", () => {
    expect(unitLabel("crate", t)).toBe("crate");
  });

  it("treats a missing unit as an empty string", () => {
    expect(unitLabel(null, t)).toBe("");
    expect(unitLabel(undefined, t)).toBe("");
    expect(unitLabel("", t)).toBe("");
  });
});
