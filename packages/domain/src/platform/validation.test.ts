import { describe, it, expect } from "vitest";
import { isCount, isoTimestamp } from "./validation.js";

describe("isCount", () => {
  it("accepts an integer at the minimum", () => {
    expect(isCount(0, 0)).toBe(true);
    expect(isCount(1, 1)).toBe(true);
  });

  it("rejects a value below the minimum", () => {
    expect(isCount(0, 1)).toBe(false);
    expect(isCount(-1, 0)).toBe(false);
  });

  it("rejects a non-integer", () => {
    expect(isCount(1.5, 0)).toBe(false);
  });
});

describe("isoTimestamp", () => {
  it("normalises a timestamp with no milliseconds to the toISOString form", () => {
    expect(isoTimestamp("2026-10-01T00:00:00Z")).toBe("2026-10-01T00:00:00.000Z");
  });

  it("returns null for garbage", () => {
    expect(isoTimestamp("not-a-date")).toBeNull();
  });
});
