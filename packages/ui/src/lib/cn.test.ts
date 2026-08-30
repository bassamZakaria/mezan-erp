import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins truthy string values with a space", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("drops false, null, undefined and empty string", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("keeps a literal 0 rather than treating it as falsy", () => {
    expect(cn("a", 0, "b")).toBe("a 0 b");
  });

  it("flattens nested arrays to any depth", () => {
    expect(cn("a", ["b", ["c", ["d"]]], "e")).toBe("a b c d e");
  });

  it("drops falsy entries inside a nested array", () => {
    expect(cn(["a", false, null, undefined, "b"])).toBe("a b");
  });

  it("returns an empty string when every input is falsy", () => {
    expect(cn(false, null, undefined, "")).toBe("");
  });

  it("returns an empty string when called with no arguments", () => {
    expect(cn()).toBe("");
  });
});
