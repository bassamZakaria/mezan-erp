import { describe, expect, it } from "vitest";
import { correctedSeededRolePermissions, detectSodConflicts, getPermission, resolvePermissions, SEEDED_ROLE_CODES, WILDCARD_PERMISSION } from "@mezan/domain";
import { seededRoles } from "./access.js";
import type { SeedLicensing } from "./fragment-registry.js";

const EVERY_MODULE: SeedLicensing = { licensed: () => true, grantable: (codes) => [...codes] };
const roles = seededRoles(EVERY_MODULE);
const grantsOf = (code: string) => resolvePermissions(roles.find((role) => role.code === code)?.permissions ?? []);

describe("seeded roles — segregation of duties", () => {
  it("seeds the roles a shop separates", () => {
    expect(roles.length).toBeGreaterThan(15);
    expect(roles.map((role) => role.code)).toEqual(expect.arrayContaining(["TREASURY_CASHIER", "BRANCH_MANAGER", "FINANCE_MANAGER"]));
  });

  it.each(roles.map((role) => [role.code, role.permissions] as const))("%s trips no SOD_CONFLICT", (_code, permissions) => {
    expect(permissions).not.toContain(WILDCARD_PERMISSION);
    expect(detectSodConflicts(permissions).map((match) => `${match.ruleId}: ${match.matchedA.join(",")} × ${match.matchedB.join(",")}`)).toEqual([]);
  });

  it("the cashier creates a cash voucher and the branch manager confirms it; neither does both", () => {
    const cashier = grantsOf("TREASURY_CASHIER");
    const manager = grantsOf("BRANCH_MANAGER");
    expect(cashier.has("treasury.cash_voucher.create")).toBe(true);
    expect(cashier.has("treasury.cash_voucher.confirm")).toBe(false);
    expect(manager.has("treasury.cash_voucher.confirm")).toBe(true);
    expect(manager.has("treasury.cash_voucher.create")).toBe(false);
  });

  it("every seeded grant is a catalog permission", () => {
    for (const role of roles) for (const code of role.permissions) expect(getPermission(code), `${role.code}: ${code}`).toBeDefined();
  });
});

describe("seeded roles — dashboard.view", () => {
  it("is a catalog permission", () => {
    expect(getPermission("dashboard.view")).toBeDefined();
  });

  it.each(roles.map((role) => [role.code] as const))("%s holds dashboard.view", (code) => {
    const granted = grantsOf(code);
    expect(granted.has("dashboard.view")).toBe(true);
  });
});

describe("seeded roles — the upgrade correction and the seed agree", () => {
  it.each(roles.map((role) => [role.code, role.permissions] as const))("%s is a known seeded code the correction leaves as the seed writes it", (code, permissions) => {
    expect(SEEDED_ROLE_CODES).toContain(code);
    expect(correctedSeededRolePermissions(code, permissions)).toBeNull();
  });
});
