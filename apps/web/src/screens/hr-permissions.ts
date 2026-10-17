import { can, createAuthContext } from "@mezan/domain";
import { useApi } from "../data/ApiContext";

export enum HrPermission {
  ViewSalary = "hr.employee.view_salary",
  EditEmployee = "hr.employee.edit",
  PayrollBankFile = "hr.payroll.bank_file",
}

/** UI affordance only — every one of these is enforced again by the route it calls. */
export function useMayDo(permission: HrPermission): boolean {
  const { session } = useApi();
  if (!session) return false;
  return can(createAuthContext({ userId: session.userId, permissions: session.permissions, branchScope: "*", warehouseScope: "*" }), permission);
}

export const NEW_SEGMENT = "new";
