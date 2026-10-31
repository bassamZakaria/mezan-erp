import { HrSubModule } from "../entitlements/sub-modules.js";

/**
 * Which HR part licenses each `hr.*` permission (spec §2.3). Matched by the
 * code's `hr.<entity>` prefix, except where a single code belongs elsewhere.
 * A new `hr.*` code with no entry fails `hr-sub-modules.test.ts`.
 */
const HR_CODE_SUB_MODULE: Readonly<Record<string, HrSubModule>> = {
  "hr.employee.view_salary": HrSubModule.Payroll,
  "hr.provision.reverse": HrSubModule.Payroll,
  "hr.leave_accrual.run": HrSubModule.Time,
};

const HR_ENTITY_SUB_MODULE: Readonly<Record<string, HrSubModule>> = {
  employee: HrSubModule.People,
  department: HrSubModule.People,
  job_title: HrSubModule.People,
  contract: HrSubModule.Contracts,
  attendance: HrSubModule.Time,
  leave: HrSubModule.Time,
  leave_policy: HrSubModule.Time,
  payroll: HrSubModule.Payroll,
  advance: HrSubModule.Payroll,
  self: HrSubModule.Self,
};

/** The HR part a permission is licensed under; null for a code outside HR or one no part claims. */
export function hrSubModuleOf(code: string): HrSubModule | null {
  if (!code.startsWith("hr.")) return null;
  const exact = HR_CODE_SUB_MODULE[code];
  if (exact) return exact;
  const entity = code.split(".")[1] ?? "";
  return HR_ENTITY_SUB_MODULE[entity] ?? null;
}
