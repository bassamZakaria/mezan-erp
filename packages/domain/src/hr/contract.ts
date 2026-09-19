import type { Money } from "../money/index.js";

/**
 * Contract — docs/archive/catalog/06-crm-hr.md "العقود". The formal employment
 * contract per employee: type/pay-basis/frequency, currency, allowance/
 * deduction line items and optional leave-entitlement overrides (blank =
 * inherit the company leave-policy default, out of scope here — HR-3).
 *
 * `status` is persisted as "active"/"terminated" only — "قريبة الانتهاء"
 * (expiring soon) in the catalog's list summary strip is a DERIVED filter
 * (active + `endDate` within 30 days), not a stored state, computed by
 * `isContractExpiringSoon` below.
 */

export type ContractType = "indefinite" | "fixed_term" | "seasonal" | "probationary";
export type PayBasis = "monthly" | "hourly" | "daily";
export type PayFrequency = "monthly" | "biweekly" | "weekly";
export type ContractStatus = "active" | "terminated";

export interface ContractTypeDefinition {
  readonly code: ContractType;
  readonly labelAr: string;
}

export const CONTRACT_TYPE_DEFINITIONS: readonly ContractTypeDefinition[] = [
  { code: "indefinite", labelAr: "غير محدد المدة" },
  { code: "fixed_term", labelAr: "محدد المدة" },
  { code: "seasonal", labelAr: "موسمي" },
  { code: "probationary", labelAr: "تجريبي" },
] as const;

export function getContractTypeLabel(type: ContractType): string {
  return CONTRACT_TYPE_DEFINITIONS.find((d) => d.code === type)?.labelAr ?? type;
}

const PAY_BASIS_LABELS_AR: Readonly<Record<PayBasis, string>> = {
  monthly: "شهري",
  hourly: "بالساعة",
  daily: "يومي",
};

const PAY_FREQUENCY_LABELS_AR: Readonly<Record<PayFrequency, string>> = {
  monthly: "شهري",
  biweekly: "كل أسبوعين",
  weekly: "أسبوعي",
};

/** Arabic label for a pay basis — payroll warnings embedded the raw code ("hourly") in Arabic prose. */
export function getPayBasisLabel(basis: PayBasis): string {
  return PAY_BASIS_LABELS_AR[basis] ?? basis;
}

export function getPayFrequencyLabel(frequency: PayFrequency): string {
  return PAY_FREQUENCY_LABELS_AR[frequency] ?? frequency;
}

export interface ContractLineItem {
  readonly id: string;
  readonly name: string;
  readonly amount: Money;
  /**
   * The payroll component this line is an instance of (`payroll-component.ts`).
   * Null on lines written before the registry existed; those still post to the
   * run's default account for their kind.
   */
  readonly componentId: string | null;
}

export interface LeaveEntitlementOverrides {
  readonly annualLeaveDays: number | null;
  readonly sickLeaveDays: number | null;
  readonly personalLeaveDays: number | null;
}

export interface Contract {
  readonly id: string;
  /** CTR-#### numbering-engine number. */
  readonly number: string;
  readonly employeeId: string;
  readonly type: ContractType;
  readonly payBasis: PayBasis;
  readonly payFrequency: PayFrequency;
  readonly startDate: string;
  /** Null when `type === "indefinite"` (catalog: "العقد غير محدد المدة لا يحتوي على تاريخ انتهاء"). */
  readonly endDate: string | null;
  /** The rate in the unit of `payBasis` — per month, per hour or per day — in `currency`; payroll reads it that way. */
  readonly monthlySalary: Money;
  readonly currency: string;
  readonly leaveEntitlement: LeaveEntitlementOverrides;
  readonly allowances: readonly ContractLineItem[];
  readonly deductions: readonly ContractLineItem[];
  readonly status: ContractStatus;
  readonly terminatedAt: string | null;
  readonly createdAt: string;
}

/** Persistence port for contracts. The domain depends on this interface only. */
export interface ContractRepository {
  findById(id: string): Promise<Contract | null>;
  list(): Promise<Contract[]>;
  listByEmployeeId(employeeId: string): Promise<Contract[]>;
  create(contract: Contract): Promise<void>;
  update(contract: Contract): Promise<void>;
}

/** Number of days within which an active contract's `endDate` counts as "قريبة الانتهاء" (expiring soon). */
export const CONTRACT_EXPIRING_SOON_WINDOW_DAYS = 30;

/** Derived "expiring soon" status — active, has a fixed end date, and that end date is within the window from `today`. */
export function isContractExpiringSoon(contract: Contract, today: Date = new Date()): boolean {
  if (contract.status !== "active" || contract.endDate === null) return false;
  const end = new Date(`${contract.endDate}T00:00:00Z`);
  const diffDays = Math.ceil((end.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  return diffDays >= 0 && diffDays <= CONTRACT_EXPIRING_SOON_WINDOW_DAYS;
}
