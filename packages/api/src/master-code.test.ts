import { describe, expect, it } from "vitest";
import { nextMasterCode } from "./master-code.js";

describe("nextMasterCode", () => {
  it("continues after the highest numbered code, not after the count", () => {
    expect(nextMasterCode(["C-0001", "C000002", "C000007", "X000009"], "C")).toBe("C000008");
  });

  it("starts at 1 when no code carries the prefix", () => {
    expect(nextMasterCode(["S-0001", "S-0002"], "S")).toBe("S000001");
  });
});
