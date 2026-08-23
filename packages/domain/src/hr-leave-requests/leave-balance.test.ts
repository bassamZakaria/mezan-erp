import { describe, it, expect } from "vitest";
import { NextNumberService } from "../numbering/index.js";
import { submitLeaveApplication } from "./submit-leave-request.js";
import { decideLeaveApplication } from "./decide-leave-request.js";
import { computeLeaveBalance, type LeaveAccrualCreditSource } from "./leave-balance.js";
import { createInMemoryLeaveApplicationRepository } from "./test-helpers/in-memory-leave-request-repository.js";
import { InMemorySequenceStore } from "./test-helpers/in-memory-sequence-store.js";

const WEEKEND = [5, 6];

function fakeAccrual(days: number): LeaveAccrualCreditSource {
  return { async sumCreditedDays() { return days; } };
}

describe("computeLeaveBalance", () => {
  it("entitled from accrual, used from approved requests, pending from pending requests", async () => {
    const requests = createInMemoryLeaveApplicationRepository();
    const numbering = new NextNumberService(new InMemorySequenceStore());
    const deps = { requests, numbering, weekendDays: WEEKEND, resolveGateConfig: () => null };

    // Auto-granted (no gate config) -> APPROVED, 1 day.
    await submitLeaveApplication(
      { id: "r1", employeeId: "emp-1", leaveTypeCode: "ANNUAL", startDate: "2026-08-16", endDate: "2026-08-16", submittedBy: "u1" },
      deps,
    );

    // Gated -> PENDING, 1 day.
    await submitLeaveApplication(
      {
        id: "r2",
        employeeId: "emp-1",
        leaveTypeCode: "ANNUAL",
        startDate: "2026-08-17",
        endDate: "2026-08-17",
        submittedBy: "u1",
      },
      { ...deps, resolveGateConfig: (actionType) => ({ actionType, steps: [{ role: "hr_manager" }] }) },
    );

    const balance = await computeLeaveBalance("emp-1", "ANNUAL", { requests, accrual: fakeAccrual(21) });
    expect(balance.entitledDays).toBe(21);
    expect(balance.usedDays).toBe(1);
    expect(balance.pendingDays).toBe(1);
    expect(balance.remainingDays).toBe(19);
  });

  it("a rejected request counts toward neither used nor pending", async () => {
    const requests = createInMemoryLeaveApplicationRepository();
    const numbering = new NextNumberService(new InMemorySequenceStore());
    await submitLeaveApplication(
      { id: "r1", employeeId: "emp-1", leaveTypeCode: "SICK", startDate: "2026-08-16", endDate: "2026-08-16", submittedBy: "u1" },
      { requests, numbering, weekendDays: WEEKEND, resolveGateConfig: (actionType) => ({ actionType, steps: [{ role: "hr_manager" }] }) },
    );
    await decideLeaveApplication({ id: "r1", actorId: "mgr", actorRoles: ["hr_manager"], decision: "reject" }, { requests });

    const balance = await computeLeaveBalance("emp-1", "SICK", { requests, accrual: fakeAccrual(180) });
    expect(balance.usedDays).toBe(0);
    expect(balance.pendingDays).toBe(0);
    expect(balance.remainingDays).toBe(180);
  });
});
