import type { LeaveAccrualFrequency, LeaveCarryoverPolicy, LeavePolicyRepository, LeavePolicyVersion } from "./leave-policy.js";
import { InvalidLeavePolicyError } from "./leave-policy.js";
import { isLeaveTypeCode, type LeaveTypeCode } from "./leave-type.js";

const ACCRUAL_FREQUENCIES: readonly LeaveAccrualFrequency[] = ["MONTHLY", "ANNUAL", "NONE"];
const CARRYOVER_POLICIES: readonly LeaveCarryoverPolicy[] = ["NONE", "LIMITED", "UNLIMITED"];

export interface SetLeavePolicyCommand {
  readonly id: string;
  readonly leaveTypeCode: LeaveTypeCode | string;
  readonly effectiveDate: string;
  readonly baseBalanceDays: number;
  readonly accrualFrequency: LeaveAccrualFrequency;
  readonly carryover: LeaveCarryoverPolicy;
  readonly carryoverMaxDays?: number | null;
  readonly payoutOnTermination: boolean;
  readonly legallyMandatory: boolean;
  readonly now?: () => string;
}

export interface SetLeavePolicyDeps {
  readonly policies: LeavePolicyRepository;
}

/**
 * Manually sets (creates a new dated version of) one leave type's policy —
 * "تخصيص يدوي" in the catalog's preset dropdown. Never mutates a prior
 * version; the new one simply becomes effective from its own date onward.
 */
export async function setLeavePolicy(cmd: SetLeavePolicyCommand, deps: SetLeavePolicyDeps): Promise<LeavePolicyVersion> {
  if (!isLeaveTypeCode(cmd.leaveTypeCode)) {
    throw new InvalidLeavePolicyError(`Unknown leave type code: "${cmd.leaveTypeCode}"`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cmd.effectiveDate) || Number.isNaN(Date.parse(cmd.effectiveDate))) {
    throw new InvalidLeavePolicyError(`effectiveDate must be a valid ISO date: "${cmd.effectiveDate}"`);
  }
  if (cmd.baseBalanceDays < 0) {
    throw new InvalidLeavePolicyError("baseBalanceDays may not be negative");
  }
  if (!ACCRUAL_FREQUENCIES.includes(cmd.accrualFrequency)) {
    throw new InvalidLeavePolicyError(`Unknown accrualFrequency: "${cmd.accrualFrequency}"`);
  }
  if (!CARRYOVER_POLICIES.includes(cmd.carryover)) {
    throw new InvalidLeavePolicyError(`Unknown carryover policy: "${cmd.carryover}"`);
  }
  if (cmd.carryover === "LIMITED" && (cmd.carryoverMaxDays == null || cmd.carryoverMaxDays < 0)) {
    throw new InvalidLeavePolicyError("carryoverMaxDays is required and non-negative when carryover is LIMITED");
  }

  const version: LeavePolicyVersion = {
    id: cmd.id,
    leaveTypeCode: cmd.leaveTypeCode,
    effectiveDate: cmd.effectiveDate,
    baseBalanceDays: cmd.baseBalanceDays,
    accrualFrequency: cmd.accrualFrequency,
    carryover: cmd.carryover,
    carryoverMaxDays: cmd.carryover === "LIMITED" ? (cmd.carryoverMaxDays ?? null) : null,
    payoutOnTermination: cmd.payoutOnTermination,
    legallyMandatory: cmd.legallyMandatory,
    source: "MANUAL",
    createdAt: cmd.now?.() ?? new Date().toISOString(),
  };
  await deps.policies.create(version);
  return version;
}
