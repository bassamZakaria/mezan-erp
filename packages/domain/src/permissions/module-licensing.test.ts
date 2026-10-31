import { describe, it, expect } from "vitest";
import { createEntitlements } from "../entitlements/entitlements.js";
import { isModuleLicensed, licensedModules, licensedPermissions } from "./module-licensing.js";

function entitlementsWith(activeModules: string[]) {
  return createEntitlements({
    plan: "STANDARD",
    activeModules,
    features: {},
    seats: 5,
    expiresAt: null,
  });
}

describe("isModuleLicensed", () => {
  it("always licenses the core platform modules regardless of entitlements", () => {
    const ent = entitlementsWith([]);
    for (const core of ["workflow", "admin", "audit", "dashboard"]) {
      expect(isModuleLicensed(core, ent)).toBe(true);
    }
  });

  it("always-licenses the dashboard its one enforced permission gates, and still not transactions — DEC-14 left that no permission", () => {
    const ent = entitlementsWith([]);
    expect(isModuleLicensed("dashboard", ent)).toBe(true);
    expect(isModuleLicensed("transactions", ent)).toBe(false);
  });

  it("gates a licensable module on the matching entitlement", () => {
    const ent = entitlementsWith(["sales"]);
    expect(isModuleLicensed("sales", ent)).toBe(true);
    expect(isModuleLicensed("pos", ent)).toBe(false);
  });

  it("maps the cheques catalog module to the financial_papers entitlement", () => {
    expect(isModuleLicensed("cheques", entitlementsWith(["financial_papers"]))).toBe(true);
    expect(isModuleLicensed("cheques", entitlementsWith(["sales"]))).toBe(false);
  });
});

describe("licensedModules / licensedPermissions", () => {
  it("filters the catalog down to core + active modules only", () => {
    const ent = entitlementsWith(["sales", "financial_papers"]);
    const moduleIds = licensedModules(ent).map((m) => m.id);
    expect(moduleIds).toContain("sales");
    expect(moduleIds).toContain("cheques");
    expect(moduleIds).toContain("admin");
    expect(moduleIds).not.toContain("pos");
    // Sub-modules: the free HR staff list shows HR in the role editor, and only its codes are grantable.
    expect(moduleIds).toContain("hr");
    const hrCodes = licensedPermissions(ent).filter((p) => p.module === "hr");
    expect(hrCodes.every((p) => p.subModule === "hr.people")).toBe(true);

    const permissionModules = new Set(licensedPermissions(ent).map((p) => p.module));
    expect(permissionModules).toEqual(new Set(moduleIds));
  });

  it("licenses nothing extra for an empty tenant beyond the core modules", () => {
    const ent = entitlementsWith([]);
    const moduleIds = licensedModules(ent).map((m) => m.id).sort();
    // `hr` is here for its free staff list (hr.people) only.
    expect(moduleIds).toEqual(["admin", "audit", "dashboard", "hr", "workflow"]);
  });
});
