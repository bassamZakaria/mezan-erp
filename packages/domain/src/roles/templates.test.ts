import { describe, expect, it } from "vitest";
import { getPermission, resolvePermissions } from "../permissions/index.js";
import {
  ROLE_TEMPLATES,
  RoleTemplateId,
  findRoleTemplate,
  licensedTemplatePermissions,
  roleTemplateProblems,
} from "./templates.js";
import type { Entitlements } from "../entitlements/entitlements.js";

const WRITE_VERBS = /\.(create|edit|confirm|post|void|reverse|approve|manage|delete|close|reopen|pay|calculate)/;

describe("role templates", () => {
  it("ships the six provisioning templates with unique ids and codes", () => {
    expect(ROLE_TEMPLATES.map((template) => template.id)).toEqual(Object.values(RoleTemplateId));
    expect(new Set(ROLE_TEMPLATES.map((template) => template.code)).size).toBe(ROLE_TEMPLATES.length);
  });

  it.each(ROLE_TEMPLATES.map((template) => [template.id, template] as const))("%s grants only catalog permissions and is segregation-of-duties clean", (_id, template) => {
    expect(template.permissions.length).toBeGreaterThan(0);
    expect(new Set(template.permissions).size).toBe(template.permissions.length);
    for (const code of template.permissions) expect(getPermission(code), code).toBeDefined();
    const problems = roleTemplateProblems(template);
    expect(problems.unknownPermissions).toEqual([]);
    expect(problems.sodConflicts.map((match) => match.ruleId)).toEqual([]);
  });

  it("a template holding both sides of a segregation-of-duties pair is reported", () => {
    const conflicted = { permissions: ["treasury.cash_voucher.create", "treasury.cash_voucher.confirm"] };
    expect(roleTemplateProblems(conflicted).sodConflicts.map((match) => match.ruleId)).toEqual(["voucher_create_approve"]);
  });

  it("a template naming a permission outside the catalog, or the wildcard, is reported", () => {
    expect(roleTemplateProblems({ permissions: ["treasury.cash_voucher.typo", "*"] }).unknownPermissions).toEqual([
      "treasury.cash_voucher.typo",
      "*",
    ]);
  });

  it("the auditor template reads and never writes, even after dependencies resolve", () => {
    const auditor = findRoleTemplate(RoleTemplateId.Auditor)!;
    for (const code of resolvePermissions(auditor.permissions)) expect(WRITE_VERBS.test(code), code).toBe(false);
  });

  it("the cashier writes cash vouchers but cannot confirm them or reconcile the bank", () => {
    const granted = resolvePermissions(findRoleTemplate(RoleTemplateId.Cashier)!.permissions);
    expect(granted.has("treasury.cash_voucher.create")).toBe(true);
    expect(granted.has("treasury.cash_voucher.confirm")).toBe(false);
    expect(granted.has("treasury.reconciliation.match")).toBe(false);
  });

  it("omits permissions of modules the tenant is not licensed for and keeps the platform ones", () => {
    const salesOnly: Entitlements = { plan: "t", activeModules: ["sales"], features: {}, seats: 5, expiresAt: null };
    const { granted, omitted } = licensedTemplatePermissions(findRoleTemplate(RoleTemplateId.SalesRep)!, salesOnly);
    expect(granted).toContain("sales.invoice.create");
    expect(granted).toContain("dashboard.view");
    expect(omitted).toEqual(["inventory.stock.view"]);
  });

  it("answers undefined for an unknown template id", () => {
    expect(findRoleTemplate("not-a-template")).toBeUndefined();
  });
});
