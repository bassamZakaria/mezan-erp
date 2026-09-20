import { describe, expect, it } from "vitest";
import { makeLocalId } from "./local-id";

describe("makeLocalId", () => {
  it("carries the given prefix", () => {
    expect(makeLocalId("line").startsWith("line-")).toBe(true);
  });

  it("never repeats within the same run", () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeLocalId("line")));
    expect(ids.size).toBe(50);
  });
});
