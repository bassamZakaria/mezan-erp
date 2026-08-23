import type { LeaveTypeCode } from "./leave-type.js";

/** How often the policy's entitlement posts via a Leave Accrual Batch. "NONE" = event-granted only (e.g. maternity), never accrued periodically. */
export type LeaveAccrualFrequency = "MONTHLY" | "ANNUAL" | "NONE";

export type LeaveCarryoverPolicy = "NONE" | "LIMITED" | "UNLIMITED";

export type LeavePolicySource = "MANUAL" | "PRESET_EG_LAW_12_2003" | "PRESET_EG_LAW_14_2025";

/**
 * One effective-dated version of one leave type's policy (docs/catalog
 * "سياسات الإجازات" matrix row). Mirrors `exchange-rates/exchange-rate.ts`'s
 * effective-dated-version shape: the policy in force on a given day is the
 * latest version with `effectiveDate <= asOfDate`, never mutated in place —
 * a change creates a NEW version so history stays intact (audit + "what was
 * the rule on 2024-01-01" queries both just work).
 */
export interface LeavePolicyVersion {
  readonly id: string;
  readonly leaveTypeCode: LeaveTypeCode;
  /** ISO date (YYYY-MM-DD) this version takes effect. */
  readonly effectiveDate: string;
  /** Annual base entitlement in days. */
  readonly baseBalanceDays: number;
  readonly accrualFrequency: LeaveAccrualFrequency;
  readonly carryover: LeaveCarryoverPolicy;
  /** Max carryover days into the next year. Only meaningful when `carryover === "LIMITED"`. */
  readonly carryoverMaxDays: number | null;
  readonly payoutOnTermination: boolean;
  /** ⚠ إجباري قانوناً — a legally-mandated minimum a tenant may not configure below. */
  readonly legallyMandatory: boolean;
  readonly source: LeavePolicySource;
  readonly createdAt: string;
}

/** Persistence port for leave policy versions. The domain depends on this interface only — no SQL, no driver. */
export interface LeavePolicyRepository {
  /** Every version for one leave type, any effective date, newest first. */
  listVersions(leaveTypeCode: LeaveTypeCode): Promise<LeavePolicyVersion[]>;
  /** All 8 leave types' latest-effective version as of `asOfDate` (nulls for a type with no version yet). */
  listEffective(asOfDate: string): Promise<LeavePolicyVersion[]>;
  /** The version in force for one leave type on `asOfDate`, or null if none has taken effect yet. */
  findEffective(leaveTypeCode: LeaveTypeCode, asOfDate: string): Promise<LeavePolicyVersion | null>;
  create(version: LeavePolicyVersion): Promise<void>;
}

export class InvalidLeavePolicyError extends Error {
  readonly code = "INVALID_LEAVE_POLICY";
  constructor(message: string) {
    super(message);
    this.name = "InvalidLeavePolicyError";
  }
}
