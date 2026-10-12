import { WILDCARD_PERMISSION } from "../permissions/catalog.js";

export enum SeededRoleCode {
  Accountant = "ACCOUNTANT",
  WarehouseKeeper = "WAREHOUSE_KEEPER",
  SalesRep = "SALES_REP",
  Supervisor = "SUPERVISOR",
  FinanceManager = "FINANCE_MANAGER",
  PurchasingOfficer = "PURCHASING_OFFICER",
  TreasuryCashier = "TREASURY_CASHIER",
  HrOfficer = "HR_OFFICER",
  PayrollOfficer = "PAYROLL_OFFICER",
  BranchManager = "BRANCH_MANAGER",
  Auditor = "AUDITOR",
  VanSales = "VAN_SALES",
  Employee = "EMPLOYEE",
  TechnicalOffice = "TECHNICAL_OFFICE",
  ConsultantQs = "CONSULTANT_QS",
  ContractsAdmin = "CONTRACTS_ADMIN",
  FinanceContracting = "FINANCE_CONTRACTING",
  CrmManager = "CRM_MANAGER",
  Cashier = "CASHIER",
}

export const SEEDED_ROLE_CODES: readonly string[] = Object.values(SeededRoleCode);

export const DASHBOARD_VIEW_PERMISSION = "dashboard.view";

interface SeededRoleCorrection {
  readonly revoke: readonly string[];
  readonly grant: readonly string[];
}

const DUTY_SPLITS: Readonly<Partial<Record<SeededRoleCode, SeededRoleCorrection>>> = {
  [SeededRoleCode.TreasuryCashier]: { revoke: ["treasury.cash_voucher.confirm"], grant: [] },
  [SeededRoleCode.BranchManager]: { revoke: ["treasury.cash_voucher.create"], grant: [] },
  [SeededRoleCode.FinanceManager]: { revoke: ["accounting.journal.post", "treasury.reconciliation.post_entry", "treasury.reconciliation.match"], grant: [] },
  [SeededRoleCode.Accountant]: { revoke: [], grant: ["accounting.journal.post"] },
  [SeededRoleCode.HrOfficer]: { revoke: ["hr.leave.approve"], grant: [] },
};

const isSeededRoleCode = (code: string): code is SeededRoleCode => SEEDED_ROLE_CODES.includes(code);

export function correctedSeededRolePermissions(code: string, permissions: readonly string[]): string[] | null {
  if (!isSeededRoleCode(code) || permissions.includes(WILDCARD_PERMISSION)) return null;
  const split = DUTY_SPLITS[code] ?? { revoke: [], grant: [] };
  const kept = permissions.filter((permission) => !split.revoke.includes(permission));
  const added = [...split.grant, DASHBOARD_VIEW_PERMISSION].filter((permission) => !kept.includes(permission));
  if (kept.length === permissions.length && added.length === 0) return null;
  return [...kept, ...added];
}
