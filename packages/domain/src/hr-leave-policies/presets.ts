import type { LeaveTypeCode } from "./leave-type.js";
import type { LeaveAccrualFrequency, LeaveCarryoverPolicy, LeavePolicySource } from "./leave-policy.js";

/**
 * Egypt Labour Law presets (docs/catalog "سياسات الإجازات" §"تطبيق إعداد
 * جاهز": "مصر — قانون 12 لسنة 2003" / "مصر — قانون 14 لسنة 2025"). Modeled as
 * VERSIONED DATED DATA per the task brief and `docs/plan.md` §6.2's mitigation
 * for "Egyptian regulatory change" risk — never hardcoded into accrual/request
 * logic, only ever consulted through `LeavePolicyRepository`.
 *
 * ⚠ Figures below are transcribed from the commonly-cited headline provisions
 * of each statute (Law 12/2003 arts. 47/48/51/91; Law 14/2025's reported
 * changes — a shortened 30-day-annual-leave service threshold, an extended
 * maternity allowance, and Egypt's first statutory paternity leave). They are
 * a reasonable starting default, NOT a certified legal reference — a tenant
 * must still have counsel confirm before relying on them, exactly as this
 * repo already flags several other under-specified figures honestly rather
 * than claim false authority (see `tax-rates`' ETA subtype notes). This is
 * why every value here is only ever a *preset a tenant may edit afterward*,
 * never baked into the accrual/approval engines themselves.
 */
export interface LeavePolicyPresetRow {
  readonly leaveTypeCode: LeaveTypeCode;
  readonly baseBalanceDays: number;
  readonly accrualFrequency: LeaveAccrualFrequency;
  readonly carryover: LeaveCarryoverPolicy;
  readonly carryoverMaxDays: number | null;
  readonly payoutOnTermination: boolean;
  readonly legallyMandatory: boolean;
}

export interface LeavePolicyPreset {
  readonly source: LeavePolicySource;
  readonly labelAr: string;
  /** ISO date (YYYY-MM-DD) the statute took/takes effect — every row's `effectiveDate` when applied. */
  readonly effectiveDate: string;
  readonly rows: readonly LeavePolicyPresetRow[];
}

/** قانون العمل رقم 12 لسنة 2003 (in force 2003-07-07 through the 14/2025 transition). */
export const EG_LAW_12_2003_PRESET: LeavePolicyPreset = {
  source: "PRESET_EG_LAW_12_2003",
  labelAr: "مصر — قانون 12 لسنة 2003",
  effectiveDate: "2003-07-07",
  rows: [
    { leaveTypeCode: "ANNUAL", baseBalanceDays: 21, accrualFrequency: "MONTHLY", carryover: "LIMITED", carryoverMaxDays: 6, payoutOnTermination: true, legallyMandatory: true },
    { leaveTypeCode: "CASUAL", baseBalanceDays: 6, accrualFrequency: "ANNUAL", carryover: "NONE", carryoverMaxDays: null, payoutOnTermination: false, legallyMandatory: true },
    { leaveTypeCode: "SICK", baseBalanceDays: 180, accrualFrequency: "ANNUAL", carryover: "NONE", carryoverMaxDays: null, payoutOnTermination: false, legallyMandatory: true },
    { leaveTypeCode: "MATERNITY", baseBalanceDays: 90, accrualFrequency: "NONE", carryover: "NONE", carryoverMaxDays: null, payoutOnTermination: false, legallyMandatory: true },
    { leaveTypeCode: "PATERNITY", baseBalanceDays: 0, accrualFrequency: "NONE", carryover: "NONE", carryoverMaxDays: null, payoutOnTermination: false, legallyMandatory: false },
    { leaveTypeCode: "UNPAID", baseBalanceDays: 180, accrualFrequency: "NONE", carryover: "NONE", carryoverMaxDays: null, payoutOnTermination: false, legallyMandatory: false },
    { leaveTypeCode: "PERSONAL", baseBalanceDays: 0, accrualFrequency: "NONE", carryover: "NONE", carryoverMaxDays: null, payoutOnTermination: false, legallyMandatory: false },
    { leaveTypeCode: "EMERGENCY", baseBalanceDays: 0, accrualFrequency: "NONE", carryover: "NONE", carryoverMaxDays: null, payoutOnTermination: false, legallyMandatory: false },
  ],
};

/** قانون العمل رقم 14 لسنة 2025 (reported effective 2025-09-01). */
export const EG_LAW_14_2025_PRESET: LeavePolicyPreset = {
  source: "PRESET_EG_LAW_14_2025",
  labelAr: "مصر — قانون 14 لسنة 2025",
  effectiveDate: "2025-09-01",
  rows: [
    { leaveTypeCode: "ANNUAL", baseBalanceDays: 21, accrualFrequency: "MONTHLY", carryover: "LIMITED", carryoverMaxDays: 6, payoutOnTermination: true, legallyMandatory: true },
    { leaveTypeCode: "CASUAL", baseBalanceDays: 6, accrualFrequency: "ANNUAL", carryover: "NONE", carryoverMaxDays: null, payoutOnTermination: false, legallyMandatory: true },
    { leaveTypeCode: "SICK", baseBalanceDays: 180, accrualFrequency: "ANNUAL", carryover: "NONE", carryoverMaxDays: null, payoutOnTermination: false, legallyMandatory: true },
    { leaveTypeCode: "MATERNITY", baseBalanceDays: 120, accrualFrequency: "NONE", carryover: "NONE", carryoverMaxDays: null, payoutOnTermination: false, legallyMandatory: true },
    { leaveTypeCode: "PATERNITY", baseBalanceDays: 3, accrualFrequency: "NONE", carryover: "NONE", carryoverMaxDays: null, payoutOnTermination: false, legallyMandatory: true },
    { leaveTypeCode: "UNPAID", baseBalanceDays: 180, accrualFrequency: "NONE", carryover: "NONE", carryoverMaxDays: null, payoutOnTermination: false, legallyMandatory: false },
    { leaveTypeCode: "PERSONAL", baseBalanceDays: 0, accrualFrequency: "NONE", carryover: "NONE", carryoverMaxDays: null, payoutOnTermination: false, legallyMandatory: false },
    { leaveTypeCode: "EMERGENCY", baseBalanceDays: 0, accrualFrequency: "NONE", carryover: "NONE", carryoverMaxDays: null, payoutOnTermination: false, legallyMandatory: false },
  ],
};

export const LEAVE_POLICY_PRESETS: readonly LeavePolicyPreset[] = [EG_LAW_12_2003_PRESET, EG_LAW_14_2025_PRESET];

export function getLeavePolicyPreset(source: LeavePolicySource): LeavePolicyPreset | null {
  return LEAVE_POLICY_PRESETS.find((p) => p.source === source) ?? null;
}
