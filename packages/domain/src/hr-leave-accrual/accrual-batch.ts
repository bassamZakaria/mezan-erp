import type { Money } from "../money/index.js";
import type { LeaveTypeCode } from "../hr-leave-policies/index.js";

/**
 * استحقاقات الإجازات — Leave Accrual Batches (docs/catalog "استحقاقات
 * الإجازات"): "تشغيل استحقاق الآن" credits every eligible employee's leave
 * balance for a period AND posts one journal entry via the REAL GL engine —
 * mirrors `fixed-assets`' draft → posted depreciation run exactly (same
 * idempotent-per-period draft/post split, same GL-posting shape).
 */
export type LeaveAccrualRunType = "MANUAL" | "SCHEDULED";
export type LeaveAccrualBatchStatus = "draft" | "posted" | "cancelled";

export interface LeaveAccrualLine {
  readonly employeeId: string;
  readonly leaveTypeCode: LeaveTypeCode;
  readonly creditedDays: number;
  readonly value: Money;
}

export interface LeaveAccrualBatch {
  readonly id: string;
  /** "YYYY-MM" — the idempotency key: at most one non-cancelled batch per period. */
  readonly period: string;
  /** ISO date (YYYY-MM-DD) the run was triggered on/for. */
  readonly runDate: string;
  readonly runType: LeaveAccrualRunType;
  readonly status: LeaveAccrualBatchStatus;
  readonly lines: readonly LeaveAccrualLine[];
  readonly totalDays: number;
  readonly totalValue: Money;
  readonly journalEntryId: string | null;
  readonly executedBy: string | null;
  readonly createdAt: string;
  readonly postedAt: string | null;
}

/** Persistence port for leave accrual batches. The domain depends on this interface only — no SQL, no driver. */
export interface LeaveAccrualBatchRepository {
  findById(id: string): Promise<LeaveAccrualBatch | null>;
  findByPeriod(period: string): Promise<LeaveAccrualBatch | null>;
  list(): Promise<LeaveAccrualBatch[]>;
  create(batch: LeaveAccrualBatch): Promise<void>;
  update(batch: LeaveAccrualBatch): Promise<void>;
}
