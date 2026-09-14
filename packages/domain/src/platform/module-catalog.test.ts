import { describe, it, expect } from "vitest";
import { MODULE_CATALOG, isKnownModule } from "./module-catalog.js";

describe("MODULE_CATALOG", () => {
  it("holds the twenty licensable modules, each once, in order", () => {
    expect([...MODULE_CATALOG]).toEqual([
      "dashboard",
      "sales",
      "purchases",
      "inventory",
      "accounting",
      "treasury",
      "installments",
      "financial_papers",
      "crm",
      "hr",
      "manufacturing",
      "assets",
      "field",
      "workflow",
      "audit",
      "transactions",
      "admin",
      "notifications",
      "projects",
      // Added when the contracting module landed: a module missing from this
      // list cannot be licensed at all, so extracting the catalogue before a
      // module ships silently locks it out.
      "contracting",
    ]);
  });

  it("recognises a catalog module and rejects anything else", () => {
    expect(isKnownModule("sales")).toBe(true);
    expect(isKnownModule("pos")).toBe(false);
    expect(isKnownModule("")).toBe(false);
  });
});
