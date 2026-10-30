import { describe, expect, it } from "vitest";
import { correctedSeededRolePermissions, CostPermission, detectSodConflicts, getPermission, resolvePermissions, SEEDED_ROLE_CODES, SeededRoleSplit, WILDCARD_PERMISSION } from "@mezan/domain";
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

  it("the cashier writes cash vouchers and the accountant reconciles the bank; neither does both", () => {
    const cashier = grantsOf("TREASURY_CASHIER");
    const accountant = grantsOf("ACCOUNTANT");
    expect(cashier.has("treasury.cash_voucher.create")).toBe(true);
    expect(cashier.has("treasury.reconciliation.match")).toBe(false);
    expect(cashier.has("treasury.reconciliation.post_entry")).toBe(false);
    expect(accountant.has("treasury.reconciliation.match")).toBe(true);
    expect(accountant.has("treasury.reconciliation.post_entry")).toBe(true);
    expect(accountant.has("treasury.cash_voucher.create")).toBe(false);
  });

  it("the storekeeper, described as the one who receives goods, may raise and confirm a goods receipt and read the supplier and the order it is received against", () => {
    const keeper = grantsOf("WAREHOUSE_KEEPER");
    expect(roles.find((role) => role.code === "WAREHOUSE_KEEPER")?.description).toContain("يستلم");
    for (const code of ["purchases.receipt.view", "purchases.receipt.create", "purchases.receipt.confirm", "purchases.supplier.view", "purchases.order.view"]) expect(keeper.has(code), code).toBe(true);
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
    for (const split of Object.values(SeededRoleSplit)) expect(correctedSeededRolePermissions(code, permissions, undefined, split), split).toBeNull();
  });
});

describe("seeded roles — item cost (#119)", () => {
  const COST_HOLDERS = ["FINANCE_MANAGER", "AUDITOR"];

  it.each(roles.map((role) => [role.code] as const))("%s holds inventory.cost.view only if it is a finance manager or an auditor", (code) => {
    expect(grantsOf(code).has(CostPermission.Item)).toBe(COST_HOLDERS.includes(code));
  });

  it("names roles the seed still carries", () => {
    expect(roles.map((role) => role.code)).toEqual(expect.arrayContaining(COST_HOLDERS));
  });
});
