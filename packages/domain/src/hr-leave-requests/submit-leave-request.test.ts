import { describe, it, expect } from "vitest";
import { NextNumberService } from "../numbering/index.js";
import { submitLeaveRequest, type LeaveGateConfigResolver } from "./submit-leave-request.js";
import { InvalidLeaveRequestError } from "./leave-request.js";
import { createInMemoryLeaveRequestRepository } from "./test-helpers/in-memory-leave-request-repository.js";
import { InMemorySequenceStore } from "./test-helpers/in-memory-sequence-store.js";

const WEEKEND = [5, 6];

function deps(resolveGateConfig: LeaveGateConfigResolver = () => null) {
  return {
    requests: createInMemoryLeaveRequestRepository(),
    numbering: new NextNumberService(new InMemorySequenceStore()),
    weekendDays: WEEKEND,
    resolveGateConfig,
  };
}

describe("submitLeaveRequest", () => {
  it("with no configured gate steps, grants immediately (APPROVED) and allocates an LR- number", async () => {
    const d = deps();
    const request = await submitLeaveRequest(
      {
        id: "req-1",
        employeeId: "emp-1",
        leaveTypeCode: "ANNUAL",
        startDate: "2026-08-16", // Sunday
        endDate: "2026-08-18", // Tuesday
        submittedBy: "user-1",
        now: () => "2026-08-15T00:00:00.000Z",
      },
      d,
    );

    expect(request.requestNo).toBe("LR-000001");
    expect(request.status).toBe("APPROVED");
    expect(request.days).toBe(3);
    expect(request.gateActionType).toBe("HR_LEAVE_APPROVE_ANNUAL");
  });

  it("with a configured single-step gate, holds PENDING", async () => {
    const d = deps((actionType) => ({ actionType, steps: [{ role: "hr_manager" }] }));
    const request = await submitLeaveRequest(
      {
        id: "req-1",
        employeeId: "emp-1",
        leaveTypeCode: "SICK",
        startDate: "2026-08-16",
        endDate: "2026-08-16",
        submittedBy: "user-1",
      },
      d,
    );

    expect(request.status).toBe("PENDING");
    expect(request.decidedAt).toBeNull();
  });

  it("a half-day request is 0.5 days and requires startDate === endDate", async () => {
    const d = deps();
    const request = await submitLeaveRequest(
      {
        id: "req-1",
        employeeId: "emp-1",
        leaveTypeCode: "CASUAL",
        startDate: "2026-08-16",
        endDate: "2026-08-16",
        halfDay: true,
        submittedBy: "user-1",
      },
      d,
    );
    expect(request.days).toBe(0.5);
  });

  it("excludes weekly-off days from the day count", async () => {
    const d = deps();
    const request = await submitLeaveRequest(
      {
        id: "req-1",
        employeeId: "emp-1",
        // 2026-08-14 Fri, 15 Sat, 16 Sun -> only Sunday counts (weekend = Fri/Sat)
        leaveTypeCode: "ANNUAL",
        startDate: "2026-08-14",
        endDate: "2026-08-16",
        submittedBy: "user-1",
      },
      d,
    );
    expect(request.days).toBe(1);
  });

  it("rejects an unknown leave type", async () => {
    const d = deps();
    await expect(
      submitLeaveRequest(
        { id: "req-1", employeeId: "emp-1", leaveTypeCode: "NOT_A_TYPE", startDate: "2026-08-16", endDate: "2026-08-16", submittedBy: "user-1" },
        d,
      ),
    ).rejects.toBeInstanceOf(InvalidLeaveRequestError);
  });

  it("rejects a request entirely within weekly-off days", async () => {
    const d = deps();
    await expect(
      submitLeaveRequest(
        { id: "req-1", employeeId: "emp-1", leaveTypeCode: "ANNUAL", startDate: "2026-08-14", endDate: "2026-08-15", submittedBy: "user-1" },
        d,
      ),
    ).rejects.toBeInstanceOf(InvalidLeaveRequestError);
  });
});
