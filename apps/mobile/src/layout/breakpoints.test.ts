import { describe, expect, it } from "vitest";
import { SIZE_CLASS_MIN_WIDTH, SizeClass, TILE_BASIS, isSplit, sizeClassFor } from "./breakpoints";

describe("sizeClassFor", () => {
  it("calls a phone in portrait compact", () => {
    expect(sizeClassFor(320)).toBe(SizeClass.Compact);
    expect(sizeClassFor(402)).toBe(SizeClass.Compact);
    expect(sizeClassFor(440)).toBe(SizeClass.Compact);
  });

  it("calls a phone in landscape and a small tablet in portrait medium", () => {
    expect(sizeClassFor(600)).toBe(SizeClass.Medium);
    expect(sizeClassFor(744)).toBe(SizeClass.Medium);
    expect(sizeClassFor(839)).toBe(SizeClass.Medium);
  });

  it("calls a tablet expanded", () => {
    expect(sizeClassFor(840)).toBe(SizeClass.Expanded);
    expect(sizeClassFor(1024)).toBe(SizeClass.Expanded);
    expect(sizeClassFor(1366)).toBe(SizeClass.Expanded);
  });

  it("is monotonic across the breakpoint edges", () => {
    for (const sizeClass of Object.values(SizeClass)) {
      expect(sizeClassFor(SIZE_CLASS_MIN_WIDTH[sizeClass])).toBe(sizeClass);
    }
    expect(sizeClassFor(SIZE_CLASS_MIN_WIDTH[SizeClass.Medium] - 1)).toBe(SizeClass.Compact);
    expect(sizeClassFor(SIZE_CLASS_MIN_WIDTH[SizeClass.Expanded] - 1)).toBe(SizeClass.Medium);
  });

  it("never returns a class for a width narrower than its own minimum", () => {
    for (let width = 0; width <= 1600; width += 7) {
      expect(width).toBeGreaterThanOrEqual(SIZE_CLASS_MIN_WIDTH[sizeClassFor(width)]);
    }
  });
});

describe("isSplit", () => {
  it("splits only in the expanded class", () => {
    expect(isSplit(SizeClass.Compact)).toBe(false);
    expect(isSplit(SizeClass.Medium)).toBe(false);
    expect(isSplit(SizeClass.Expanded)).toBe(true);
  });

  it("splits an iPad in portrait and in landscape, and neither phone orientation", () => {
    // iPhone 17 Pro Max 440×956, iPad Air 13-inch 1024×1366.
    expect(isSplit(sizeClassFor(440))).toBe(false);
    expect(isSplit(sizeClassFor(956))).toBe(true);
    expect(isSplit(sizeClassFor(1024))).toBe(true);
    expect(isSplit(sizeClassFor(1366))).toBe(true);
  });
});

describe("TILE_BASIS", () => {
  it("fits more tiles per row as the window widens", () => {
    const percent = (value: string) => Number(value.replace("%", ""));
    expect(percent(TILE_BASIS[SizeClass.Compact])).toBeGreaterThan(percent(TILE_BASIS[SizeClass.Medium]));
    expect(percent(TILE_BASIS[SizeClass.Medium])).toBeGreaterThan(percent(TILE_BASIS[SizeClass.Expanded]));
  });

  it("never lets a single tile fill a whole row", () => {
    for (const basis of Object.values(TILE_BASIS)) expect(Number(basis.replace("%", ""))).toBeLessThan(50);
  });
});
