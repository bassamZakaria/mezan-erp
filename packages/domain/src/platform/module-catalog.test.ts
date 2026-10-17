import { describe, it, expect } from "vitest";
import { MODULE_CATALOG, isKnownModule } from "./module-catalog.js";

describe("MODULE_CATALOG", () => {
  it("holds the twenty licensable modules, each once, in order", () => {
    expect([...MODULE_CATALOG]).toEqual([
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
      "admin",
      "notifications",
      "projects",
      // Added when the contracting module landed: a module missing from this
      // list cannot be licensed at all, so extracting the catalogue before a
      // module ships silently locks it out.
      "contracting",
      // DEC-23 un-deferred POS: its routes ship and gate on `pos.*` codes, so
      // the module has to be licensable or those gates can never be granted.
      "pos",
      // DEC-27: the integration API, licensable on the cloud edition only.
      "integrations",
    ]);
  });

  it("recognises a catalog module and rejects anything else", () => {
    expect(isKnownModule("sales")).toBe(true);
    expect(isKnownModule("pos")).toBe(true);
    // DEC-14: neither has a permission left to license.
    expect(isKnownModule("dashboard")).toBe(false);
    expect(isKnownModule("transactions")).toBe(false);
    expect(isKnownModule("")).toBe(false);
  });
});
