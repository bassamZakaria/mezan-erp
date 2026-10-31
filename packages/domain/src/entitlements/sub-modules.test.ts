import { describe, it, expect } from "vitest";
import { hasAnyPartOf, hasModule, hasReadOnlyModule, parentOf, isSubModule, HrSubModule, type Entitlements } from "./index.js";
import { isKnownModule, moduleName } from "../platform/module-catalog.js";

const ent = (activeModules: string[], readOnlyModules?: string[]): Entitlements => ({
  plan: "P",
  activeModules,
  ...(readOnlyModules ? { readOnlyModules } : {}),
  features: {},
  seats: 1,
  expiresAt: null,
});

describe("sub-module resolution", () => {
  it("a parent implies every part", () => expect(hasModule(ent(["hr"]), HrSubModule.Payroll)).toBe(true));
  it("a part alone does not imply the parent", () => expect(hasModule(ent(["hr.time"]), "hr")).toBe(false));
  it("a part alone does not imply a sibling", () => expect(hasModule(ent(["hr.time"]), "hr.payroll")).toBe(false));
  it("a listed part is held", () => expect(hasModule(ent(["hr.time"]), "hr.time")).toBe(true));
  it("a free part is held by every plan", () => expect(hasModule(ent(["sales"]), HrSubModule.People)).toBe(true));
  it("a free part never implies the parent", () => expect(hasModule(ent([]), "hr")).toBe(false));
  it("read-only parent covers a dropped part", () => expect(hasReadOnlyModule(ent(["sales"], ["hr"]), "hr.payroll")).toBe(true));
  it("free beats read-only", () => expect(hasReadOnlyModule(ent(["sales"], ["hr"]), "hr.people")).toBe(false));
  it("a held part is not read-only", () => expect(hasReadOnlyModule(ent(["hr.payroll"], ["hr"]), "hr.payroll")).toBe(false));
  it("any part shows the parent group", () => {
    expect(hasAnyPartOf(ent(["sales"]), "hr")).toBe(true);
    expect(hasAnyPartOf(ent(["hr.time"]), "hr")).toBe(true);
    expect(hasAnyPartOf(ent(["sales"]), "crm")).toBe(false);
    expect(hasAnyPartOf(ent(["crm"]), "crm")).toBe(true);
  });
  it("parentOf names the parent of a known part only", () => {
    expect(parentOf("hr.time")).toBe("hr");
    expect(parentOf("hr")).toBeNull();
    expect(parentOf("hr.nope")).toBeNull();
    expect(isSubModule("hr.self")).toBe(true);
    expect(isSubModule("sales")).toBe(false);
  });
  it("isKnownModule accepts parts", () => {
    expect(isKnownModule("hr.payroll")).toBe(true);
    expect(isKnownModule("hr.nope")).toBe(false);
  });
  it("moduleName names a part", () => expect(moduleName("hr.payroll")).toEqual({ ar: "الرواتب", en: "Payroll" }));
});
