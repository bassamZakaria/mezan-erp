import { describe, expect, it } from "vitest";
import { createEntitlements } from "../entitlements/entitlements.js";
import { PERMISSIONS, getPermission } from "./catalog.js";
import { isPermissionLicensed, isPermissionReadOnly, licensedPermissions, licensingIdOf } from "./module-licensing.js";
import { ShellRequest, planServesShellRequest } from "./shell-requests.js";

const plan = (activeModules: string[], readOnlyModules?: string[]) =>
  createEntitlements({ plan: "P", activeModules, ...(readOnlyModules ? { readOnlyModules } : {}), features: {}, seats: 1, expiresAt: null });

describe("hr permissions carry their sub-module", () => {
  it("every hr permission maps to a sub-module", () => {
    const unmapped = PERMISSIONS.filter((p) => p.module === "hr" && p.subModule === null).map((p) => p.code);
    expect(unmapped).toEqual([]);
  });

  it("non-hr permissions carry no sub-module", () => {
    expect(getPermission("sales.invoice.view")?.subModule).toBeNull();
  });

  it("maps the staff list, salary visibility and self-service to their parts", () => {
    expect(getPermission("hr.employee.view")?.subModule).toBe("hr.people");
    expect(getPermission("hr.employee.view_salary")?.subModule).toBe("hr.payroll");
    expect(getPermission("hr.advance.approve")?.subModule).toBe("hr.payroll");
    expect(getPermission("hr.leave_accrual.run")?.subModule).toBe("hr.time");
    expect(getPermission("hr.contract.view")?.subModule).toBe("hr.contracts");
    expect(getPermission("hr.self.payslip")?.subModule).toBe("hr.self");
  });

  it("licensingIdOf prefers the sub-module and keeps the entitlement id elsewhere", () => {
    expect(licensingIdOf(getPermission("hr.payroll.view")!)).toBe("hr.payroll");
    expect(licensingIdOf(getPermission("cheques.view")!)).toBe("financial_papers");
  });

  it("a sales-only plan grants the staff list and nothing else of hr", () => {
    const codes = licensedPermissions(plan(["sales"])).map((p) => p.code);
    expect(codes).toContain("hr.employee.view");
    expect(codes).toContain("hr.department.create");
    expect(codes).not.toContain("hr.payroll.view");
    expect(codes).not.toContain("hr.employee.view_salary");
    expect(codes).not.toContain("hr.contract.view");
  });

  it("a plan with hr grants every hr permission", () => {
    const codes = licensedPermissions(plan(["hr"])).filter((p) => p.module === "hr");
    expect(codes).toHaveLength(PERMISSIONS.filter((p) => p.module === "hr").length);
  });

  it("checks one code against a plan", () => {
    expect(isPermissionLicensed("hr.attendance.view", plan(["hr.time"]))).toBe(true);
    expect(isPermissionLicensed("hr.payroll.view", plan(["hr.time"]))).toBe(false);
    expect(isPermissionReadOnly("hr.payroll.view", plan(["sales"], ["hr"]))).toBe(true);
    expect(isPermissionReadOnly("hr.employee.create", plan(["sales"], ["hr"]))).toBe(false);
  });

  it("every plan serves the staff list to other modules' pickers", () => {
    expect(planServesShellRequest(plan(["sales"]), ShellRequest.Employees)).toBe(true);
    expect(planServesShellRequest(plan(["sales"]), ShellRequest.JobTitles)).toBe(true);
  });
});
