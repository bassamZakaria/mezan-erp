/**
 * `hr.payroll.statutory` — the tenant switch that lets payroll compute salary
 * tax, social insurance, levies and overtime premiums. OFF by default: every
 * statutory row is unverified until a legal review (DEC-12), so turning it on
 * is an admin's explicit, acknowledged and audit-logged decision.
 */
export const PAYROLL_STATUTORY_FLAG_CODE = "hr.payroll.statutory";

export interface PayrollStatutoryFlag {
  readonly enabled: boolean;
  /** Who last changed it, and when; null until anyone has. */
  readonly changedBy: string | null;
  readonly changedAt: string | null;
  /** True when the last enable was made against the unverified-figures acknowledgement. */
  readonly acknowledged: boolean;
}

export const DEFAULT_PAYROLL_STATUTORY_FLAG: PayrollStatutoryFlag = {
  enabled: false,
  changedBy: null,
  changedAt: null,
  acknowledged: false,
};

export interface PayrollStatutoryFlagRepository {
  get(): Promise<PayrollStatutoryFlag>;
  set(flag: PayrollStatutoryFlag): Promise<void>;
}
