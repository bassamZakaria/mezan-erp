import { describe, it, expect } from "vitest";
import { MODULE_CATALOG, isKnownModule } from "./module-catalog.js";

describe("MODULE_CATALOG", () => {
  it("holds the sixteen licensable modules, each once", () => {
    expect(MODULE_CATALOG).toHaveLength(16);
    expect(new Set(MODULE_CATALOG).size).toBe(16);
    expect(MODULE_CATALOG).toContain("accounting");
    expect(MODULE_CATALOG).toContain("hr");
  });

  it("recognises a catalog module and rejects anything else", () => {
    expect(isKnownModule("sales")).toBe(true);
    expect(isKnownModule("pos")).toBe(false);
    expect(isKnownModule("")).toBe(false);
  });
});
