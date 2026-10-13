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
  readonly reasonAr: string;
}

export enum SeededRoleSplit {
  Duties = "duties",
  BankReconciliation = "bank_reconciliation",
}

const SPLITS: Readonly<Record<SeededRoleSplit, Readonly<Partial<Record<SeededRoleCode, SeededRoleCorrection>>>>> = {
  [SeededRoleSplit.Duties]: {
    [SeededRoleCode.TreasuryCashier]: { revoke: ["treasury.cash_voucher.confirm"], grant: [], reasonAr: "من يحرّر السند لا يؤكده؛ التأكيد لمدير الفرع" },
    [SeededRoleCode.BranchManager]: { revoke: ["treasury.cash_voucher.create"], grant: [], reasonAr: "من يؤكد السند لا يحرّره؛ التحرير لأمين الخزنة" },
    [SeededRoleCode.FinanceManager]: {
      revoke: ["accounting.journal.post", "treasury.reconciliation.post_entry", "treasury.reconciliation.match"],
      grant: [],
      reasonAr: "من يعتمد ويراجع لا يرحّل القيود ولا يطابق كشف البنك بنفسه؛ الترحيل للمحاسب",
    },
    [SeededRoleCode.Accountant]: { revoke: [], grant: ["accounting.journal.post"], reasonAr: "ترحيل القيود انتقل إليه من المدير المالي" },
    [SeededRoleCode.HrOfficer]: { revoke: ["hr.leave.approve"], grant: [], reasonAr: "من يسجّل طلب الإجازة لا يعتمده؛ الاعتماد للمدير المباشر أو من يملك صلاحية الاعتماد" },
  },
  [SeededRoleSplit.BankReconciliation]: {
    [SeededRoleCode.TreasuryCashier]: {
      revoke: ["treasury.reconciliation.match", "treasury.reconciliation.post_entry"],
      grant: [],
      reasonAr: "من يحرّر سندات النقدية لا يطابق كشف البنك ولا يرحّل قيوده؛ المطابقة للمحاسب",
    },
    [SeededRoleCode.Accountant]: {
      revoke: [],
      grant: ["treasury.reconciliation.view", "treasury.reconciliation.match", "treasury.reconciliation.post_entry"],
      reasonAr: "مطابقة كشف البنك وترحيل قيوده انتقلا إليه من أمين الخزنة",
    },
  },
};

const GRANTED_WITH: Readonly<Record<SeededRoleSplit, readonly string[]>> = {
  [SeededRoleSplit.Duties]: [DASHBOARD_VIEW_PERMISSION],
  [SeededRoleSplit.BankReconciliation]: [],
};

const NO_SPLIT: SeededRoleCorrection = { revoke: [], grant: [], reasonAr: "" };

export const SEEDED_ROLE_DUTIES_SEPARATED_EVENT = "SEEDED_ROLE_DUTIES_SEPARATED";

export interface SeededRoleDutyChange {
  readonly roleCode: string;
  readonly roleName: string;
  readonly revoked: readonly string[];
  readonly granted: readonly string[];
  readonly reasonAr: string;
}

export type PermissionSuccessors = ReadonlyMap<string, readonly string[]>;

const NO_SUCCESSORS: PermissionSuccessors = new Map();

/**
 * REQUIRED ORDERING: a permission that succeeded another (a document's own
 * reversal right, granted to whoever held the older right) follows the duty it
 * came from. Revoking the older right without it leaves the conflict standing
 * under the newer name.
 */
function splitFor(
  code: SeededRoleCode,
  permissions: readonly string[],
  successors: PermissionSuccessors,
  which: SeededRoleSplit,
): { readonly revoked: string[]; readonly granted: string[] } {
  const split = SPLITS[which][code] ?? NO_SPLIT;
  const kept = permissions.filter((permission) => !split.revoke.includes(permission));
  const stillEarned = new Set(kept.flatMap((permission) => successors.get(permission) ?? []));
  const orphaned = split.revoke.flatMap((permission) => successors.get(permission) ?? []).filter((successor) => !stillEarned.has(successor));
  const revoked = [...new Set([...split.revoke, ...orphaned])].filter((permission) => permissions.includes(permission));
  const granted = [...new Set([...split.grant, ...split.grant.flatMap((permission) => successors.get(permission) ?? [])])].filter((permission) => !permissions.includes(permission));
  return { revoked, granted };
}

/** What the duty split took from, or handed to, a stored seeded role — null when it changes nothing an administrator must hear about. */
export function seededRoleDutyChange(
  role: { readonly code: string; readonly name: string; readonly permissions: readonly string[] },
  successors: PermissionSuccessors = NO_SUCCESSORS,
  which: SeededRoleSplit = SeededRoleSplit.Duties,
): SeededRoleDutyChange | null {
  if (!isSeededRoleCode(role.code) || role.permissions.includes(WILDCARD_PERMISSION)) return null;
  const split = SPLITS[which][role.code];
  if (!split) return null;
  const { revoked, granted } = splitFor(role.code, role.permissions, successors, which);
  if (revoked.length === 0 && granted.length === 0) return null;
  return { roleCode: role.code, roleName: role.name, revoked, granted, reasonAr: split.reasonAr };
}

export function seededRoleDutyNotice(changes: readonly SeededRoleDutyChange[]): { readonly title: string; readonly body: string } {
  const lines = changes.map((change) => {
    const parts = [
      change.revoked.length > 0 ? `سُحبت منه: ${change.revoked.join("، ")}` : null,
      change.granted.length > 0 ? `أُضيفت له: ${change.granted.join("، ")}` : null,
    ].filter((part): part is string => part !== null);
    return `• ${change.roleName} (${change.roleCode}) — ${parts.join("؛ ")}. السبب: ${change.reasonAr}.`;
  });
  return {
    title: "تحديث النظام عدّل صلاحيات أدوار جاهزة تطبيقاً للفصل بين المهام",
    body: [
      "طبّق هذا التحديث قاعدة الفصل بين المهام على الأدوار الجاهزة: من يُنشئ عملية مالية لا يعتمدها بنفسه. راجع المستخدمين المعنيين، وأسند الصلاحية المسحوبة لمن يجب أن يقوم بها إن لزم.",
      ...lines,
    ].join("\n"),
  };
}

const isSeededRoleCode = (code: string): code is SeededRoleCode => SEEDED_ROLE_CODES.includes(code);

export function correctedSeededRolePermissions(
  code: string,
  permissions: readonly string[],
  successors: PermissionSuccessors = NO_SUCCESSORS,
  which: SeededRoleSplit = SeededRoleSplit.Duties,
): string[] | null {
  if (!isSeededRoleCode(code) || permissions.includes(WILDCARD_PERMISSION)) return null;
  const { revoked, granted } = splitFor(code, permissions, successors, which);
  const kept = permissions.filter((permission) => !revoked.includes(permission));
  const added = [...granted, ...GRANTED_WITH[which]].filter((permission) => !kept.includes(permission));
  if (kept.length === permissions.length && added.length === 0) return null;
  return [...kept, ...added];
}
