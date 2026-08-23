import type { LeaveTypeCode } from "../hr-leave-policies/index.js";
import type { LeaveAccrualCreditSource } from "../hr-leave-requests/index.js";
import type { LeaveAccrualBatchRepository } from "./accrual-batch.js";

/**
 * Adapts a {@link LeaveAccrualBatchRepository} into the narrow
 * {@link LeaveAccrualCreditSource} port `hr-leave-requests/leave-balance.ts`
 * depends on, so that module never needs to import this one's full API.
 */
export function createAccrualCreditSource(batches: LeaveAccrualBatchRepository): LeaveAccrualCreditSource {
  return {
    async sumCreditedDays(employeeId: string, leaveTypeCode: LeaveTypeCode): Promise<number> {
      const all = await batches.list();
      let total = 0;
      for (const batch of all) {
        if (batch.status !== "posted") continue;
        for (const line of batch.lines) {
          if (line.employeeId === employeeId && line.leaveTypeCode === leaveTypeCode) {
            total += line.creditedDays;
          }
        }
      }
      return total;
    },
  };
}
