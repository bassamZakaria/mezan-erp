import type { LeaveTypeCode } from "../hr-leave-policies/index.js";
import type { LeaveApplicationRepository } from "./leave-request.js";

/**
 * استهلاك الإجازات — a DERIVED read-model (docs/catalog HR Dashboard's
 * "استهلاك الإجازات" table: المستحق/المستخدم/قيد الانتظار), never a mutable
 * balance row: `entitledDays` sums posted Leave Accrual Batch credit lines for
 * this employee/type (hr-leave-accrual), `usedDays` sums APPROVED leave
 * request days, `pendingDays` sums still-PENDING request days. Nothing here
 * writes state — approving a request or posting a batch never needs a
 * separate "now update the balance" step, so the two can never drift apart.
 */
export interface LeaveBalance {
  readonly employeeId: string;
  readonly leaveTypeCode: LeaveTypeCode;
  readonly entitledDays: number;
  readonly usedDays: number;
  readonly pendingDays: number;
  readonly remainingDays: number;
}

/** Minimal read port onto posted accrual credits — satisfied by `hr-leave-accrual`'s repository without this module depending on that package's full API. */
export interface LeaveAccrualCreditSource {
  sumCreditedDays(employeeId: string, leaveTypeCode: LeaveTypeCode): Promise<number>;
}

export interface ComputeLeaveBalanceDeps {
  readonly requests: LeaveApplicationRepository;
  readonly accrual: LeaveAccrualCreditSource;
}

export async function computeLeaveBalance(
  employeeId: string,
  leaveTypeCode: LeaveTypeCode,
  deps: ComputeLeaveBalanceDeps,
): Promise<LeaveBalance> {
  const entitledDays = await deps.accrual.sumCreditedDays(employeeId, leaveTypeCode);
  const requests = await deps.requests.list({ employeeId, leaveTypeCode });

  let usedDays = 0;
  let pendingDays = 0;
  for (const request of requests) {
    if (request.status === "APPROVED") usedDays += request.days;
    else if (request.status === "PENDING") pendingDays += request.days;
  }

  return {
    employeeId,
    leaveTypeCode,
    entitledDays,
    usedDays,
    pendingDays,
    remainingDays: entitledDays - usedDays - pendingDays,
  };
}
