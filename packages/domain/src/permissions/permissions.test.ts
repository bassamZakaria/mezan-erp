import { describe, it, expect } from "vitest";
import {
  PERMISSIONS,
  MODULES,
  getPermission,
  isSensitive,
  isPlatformAdminOnly,
  assertCatalogIntegrity,
  resolvePermissions,
  dependenciesOf,
  createAuthContext,
  can,
  visibilityTier,
  isTenantAdmin,
  ALL_SCOPE,
} from "./index.js";

describe("permission catalog", () => {
  it("has the documented 268 permissions across 19 modules, plus 2 promotion permissions added in phase5/full-sales and a new 2-permission projects module added in phase11/crm-projects-assets-field", () => {
    expect(PERMISSIONS).toHaveLength(272);
    expect(MODULES).toHaveLength(20);
    const summed = MODULES.reduce((n, m) => n + m.count, 0);
    expect(summed).toBe(272);
  });

  it("passes integrity checks (unique codes, resolvable deps, module counts)", () => {
    expect(() => assertCatalogIntegrity()).not.toThrow();
  });

  it("flags the documented sensitive permissions", () => {
    expect(isSensitive("sales.invoice.view_cost")).toBe(true);
    expect(isSensitive("hr.employee.view_salary")).toBe(true);
    expect(isSensitive("hr.employee.view_personal")).toBe(true);
    expect(isSensitive("pos.delivery.cancel")).toBe(true);
    expect(isSensitive("sales.invoice.view")).toBe(false);
    const sensitiveCount = PERMISSIONS.filter((p) => p.sensitive).length;
    expect(sensitiveCount).toBe(4);
  });

  it("marks the two platform-admin-only permissions", () => {
    expect(isPlatformAdminOnly("admin.tenant.settings.edit")).toBe(true);
    expect(isPlatformAdminOnly("admin.modules.manage")).toBe(true);
    expect(isPlatformAdminOnly("admin.roles.manage")).toBe(false);
    expect(PERMISSIONS.filter((p) => p.platformAdminOnly)).toHaveLength(2);
  });

  it("derives module ownership from the code", () => {
    expect(getPermission("pos.delivery.cancel")?.module).toBe("pos");
    expect(getPermission("admin.tenant.settings.edit")?.module).toBe("admin");
    expect(getPermission("cheques.bounce")?.module).toBe("cheques");
  });
});

describe("dependency resolution", () => {
  it("granting .confirm implies .view_own (single hop)", () => {
    const resolved = resolvePermissions(["sales.invoice.confirm"]);
    expect(resolved.has("sales.invoice.confirm")).toBe(true);
    expect(resolved.has("sales.invoice.view_own")).toBe(true);
  });

  it("resolves transitive chains (pay -> approve -> view)", () => {
    const resolved = resolvePermissions(["hr.payroll.pay"]);
    expect(resolved.has("hr.payroll.pay")).toBe(true);
    expect(resolved.has("hr.payroll.approve")).toBe(true);
    expect(resolved.has("hr.payroll.view")).toBe(true);
  });

  it("resolves multiple dependencies of one permission", () => {
    const resolved = resolvePermissions(["treasury.transfer.create"]);
    expect(resolved.has("treasury.transfer.view")).toBe(true);
    expect(resolved.has("treasury.account.view")).toBe(true);
  });

  it("follows cross-module dependencies", () => {
    const resolved = resolvePermissions(["crm.lead.convert"]);
    expect(resolved.has("crm.lead.view")).toBe(true);
    expect(resolved.has("crm.opportunity.create")).toBe(true);
    expect(resolved.has("crm.opportunity.view")).toBe(true);
  });

  it("preserves the wildcard and unknown codes without expansion", () => {
    const resolved = resolvePermissions(["*", "some.future.permission"]);
    expect(resolved.has("*")).toBe(true);
    expect(resolved.has("some.future.permission")).toBe(true);
  });

  it("dependenciesOf excludes the permission itself", () => {
    const deps = dependenciesOf("sales.invoice.create");
    expect(deps.has("sales.invoice.create")).toBe(false);
    expect(deps.has("sales.invoice.view_own")).toBe(true);
  });
});

describe("AuthContext.can — scoping", () => {
  it("allows a held permission within scope, denies outside scope", () => {
    const ctx = createAuthContext({
      userId: "u1",
      permissions: ["sales.invoice.create"],
      branchScope: ["branch-A"],
      warehouseScope: ["wh-1"],
    });
    // create resolves view_own, so both are held
    expect(can(ctx, "sales.invoice.view_own")).toBe(true);
    expect(can(ctx, "sales.invoice.create", { branch: "branch-A" })).toBe(true);
    expect(can(ctx, "sales.invoice.create", { branch: "branch-B" })).toBe(false);
    expect(
      can(ctx, "sales.invoice.create", { branch: "branch-A", warehouse: "wh-1" }),
    ).toBe(true);
    expect(
      can(ctx, "sales.invoice.create", { branch: "branch-A", warehouse: "wh-9" }),
    ).toBe(false);
  });

  it("denies a permission that is not held even inside scope", () => {
    const ctx = createAuthContext({
      userId: "u2",
      permissions: ["sales.invoice.view"],
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    expect(can(ctx, "sales.invoice.void")).toBe(false);
  });

  it("ALL_SCOPE permits any branch/warehouse", () => {
    const ctx = createAuthContext({
      userId: "u3",
      permissions: ["inventory.transfer.confirm"],
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    expect(
      can(ctx, "inventory.transfer.confirm", {
        branch: "anything",
        warehouse: "anywhere",
      }),
    ).toBe(true);
  });

  it("tenant admin (*) bypasses permission and scope checks", () => {
    const ctx = createAuthContext({
      userId: "admin",
      permissions: ["*"],
      branchScope: [],
      warehouseScope: [],
    });
    expect(isTenantAdmin(ctx)).toBe(true);
    expect(can(ctx, "admin.modules.manage", { branch: "x", warehouse: "y" })).toBe(
      true,
    );
    expect(can(ctx, "any.unknown.permission")).toBe(true);
  });
});

describe("three-tier visibility", () => {
  it("returns the highest tier held", () => {
    const own = createAuthContext({
      userId: "a",
      permissions: ["sales.invoice.view_own"],
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    const inScope = createAuthContext({
      userId: "b",
      permissions: ["sales.invoice.view"],
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    const all = createAuthContext({
      userId: "c",
      permissions: ["sales.invoice.view_all"],
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    const none = createAuthContext({
      userId: "d",
      permissions: [],
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    expect(visibilityTier(own, "sales.invoice")).toBe("own");
    expect(visibilityTier(inScope, "sales.invoice")).toBe("in_scope");
    // view_all resolves view too, so highest tier wins
    expect(visibilityTier(all, "sales.invoice")).toBe("all");
    expect(visibilityTier(none, "sales.invoice")).toBe("none");
  });

  it("admin always sees all", () => {
    const ctx = createAuthContext({
      userId: "admin",
      permissions: ["*"],
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    expect(visibilityTier(ctx, "hr.employee")).toBe("all");
  });
});
