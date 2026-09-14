import { describe, it, expect } from "vitest";
import { isValidSlug } from "./slug.js";

describe("isValidSlug", () => {
  it("accepts lower-case letters, digits and inner hyphens, 3 to 32 long", () => {
    expect(isValidSlug("abc")).toBe(true);
    expect(isValidSlug("cyag-2026")).toBe(true);
    expect(isValidSlug("a".repeat(32))).toBe(true);
  });

  it("rejects upper case, edges hyphens, spaces, Arabic, and bad lengths", () => {
    expect(isValidSlug("Cyag")).toBe(false);
    expect(isValidSlug("-cyag")).toBe(false);
    expect(isValidSlug("cyag-")).toBe(false);
    expect(isValidSlug("cy ag")).toBe(false);
    expect(isValidSlug("سياج")).toBe(false);
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("a".repeat(33))).toBe(false);
  });
});
