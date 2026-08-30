import { describe, it, expect } from "vitest";
import { createInMemoryLeaveRequestRepository } from "./test-helpers/in-memory-hr-repositories.js";
import {
  createLeaveRequest,
  decideLeaveRequest,
  cancelLeaveRequest,
  filterLeaveRequests,
  isOnApprovedLeave,
  getLeaveTypeLabel,
  leaveApprovalActionType,
  isUnpaidLeaveType,
  LEAVE_TYPE_DEFINITIONS,
  type LeaveRequest,
  type LeaveType,
} from "./leave-request.js";
import { InvalidLeaveRequestError, InvalidLeaveRequestTransitionError } from "./errors.js";

describe("createLeaveRequest", () => {
  it("computes the inclusive day count and starts 'pending'", async () => {
    const repo = createInMemoryLeaveRequestRepository();
    const req = await createLeaveRequest(
      { id: "lr-1", number: "LR-000001", employeeId: "emp-1", leaveType: "annual", startDate: "2026-08-10", endDate: "2026-08-12" },
      repo,
    );
    expect(req.days).toBe(3);
    expect(req.status).toBe("pending");
    expect(await repo.findById("lr-1")).toEqual(req);
  });

  it("computes 0.5 days for a half-day request", async () => {
    const repo = createInMemoryLeaveRequestRepository();
    const req = await createLeaveRequest(
      { id: "lr-1", number: "LR-000001", employeeId: "emp-1", leaveType: "sick", halfDay: true, startDate: "2026-08-10", endDate: "2026-08-10" },
      repo,
    );
    expect(req.days).toBe(0.5);
  });

  it("rejects an end date before the start date", async () => {
    const repo = createInMemoryLeaveRequestRepository();
    await expect(
      createLeaveRequest(
        { id: "lr-1", number: "LR-000001", employeeId: "emp-1", leaveType: "annual", startDate: "2026-08-12", endDate: "2026-08-10" },
        repo,
      ),
    ).rejects.toThrow(InvalidLeaveRequestError);
  });
});

describe("decideLeaveRequest / cancelLeaveRequest", () => {
  it("approves a pending request", async () => {
    const repo = createInMemoryLeaveRequestRepository();
    const req = await createLeaveRequest(
      { id: "lr-1", number: "LR-000001", employeeId: "emp-1", leaveType: "annual", startDate: "2026-08-10", endDate: "2026-08-10" },
      repo,
    );
    const approved = decideLeaveRequest(req, "approved", "user-1");
    expect(approved.status).toBe("approved");
    expect(approved.decidedBy).toBe("user-1");
    expect(approved.decidedAt).not.toBeNull();
  });

  it("rejects deciding an already-decided request", async () => {
    const repo = createInMemoryLeaveRequestRepository();
    const req = await createLeaveRequest(
      { id: "lr-1", number: "LR-000001", employeeId: "emp-1", leaveType: "annual", startDate: "2026-08-10", endDate: "2026-08-10" },
      repo,
    );
    const rejected = decideLeaveRequest(req, "rejected", "user-1");
    expect(() => decideLeaveRequest(rejected, "approved", "user-1")).toThrow(InvalidLeaveRequestTransitionError);
  });

  it("cancels a pending or approved request", async () => {
    const repo = createInMemoryLeaveRequestRepository();
    const req = await createLeaveRequest(
      { id: "lr-1", number: "LR-000001", employeeId: "emp-1", leaveType: "annual", startDate: "2026-08-10", endDate: "2026-08-10" },
      repo,
    );
    expect(cancelLeaveRequest(req).status).toBe("cancelled");
    const approved = decideLeaveRequest(req, "approved", "user-1");
    expect(cancelLeaveRequest(approved).status).toBe("cancelled");
  });

  it("cannot cancel a rejected or already-cancelled request", async () => {
    const repo = createInMemoryLeaveRequestRepository();
    const req = await createLeaveRequest(
      { id: "lr-1", number: "LR-000001", employeeId: "emp-1", leaveType: "annual", startDate: "2026-08-10", endDate: "2026-08-10" },
      repo,
    );
    const rejected = decideLeaveRequest(req, "rejected", "user-1");
    expect(() => cancelLeaveRequest(rejected)).toThrow(InvalidLeaveRequestTransitionError);
  });
});

describe("getLeaveTypeLabel / leaveApprovalActionType / isUnpaidLeaveType", () => {
  it("returns the Arabic label and the configured approval gate for every defined leave type", () => {
    for (const def of LEAVE_TYPE_DEFINITIONS) {
      expect(getLeaveTypeLabel(def.code)).toBe(def.labelAr);
      expect(leaveApprovalActionType(def.code)).toBe(def.gateActionType);
    }
  });

  it("falls back to the raw code / the cross-type gate for an unknown leave type", () => {
    expect(getLeaveTypeLabel("bogus" as LeaveType)).toBe("bogus");
    expect(leaveApprovalActionType("bogus" as LeaveType)).toBe("HR_LEAVE_APPROVE_ALL");
  });

  it("only 'unpaid' counts as an unpaid leave type", () => {
    expect(isUnpaidLeaveType("unpaid")).toBe(true);
    expect(isUnpaidLeaveType("annual")).toBe(false);
    expect(isUnpaidLeaveType("sick")).toBe(false);
  });
});

function request(overrides: Partial<LeaveRequest> & Pick<LeaveRequest, "employeeId" | "startDate" | "endDate" | "status">): LeaveRequest {
  return {
    id: `${overrides.employeeId}-${overrides.startDate}`,
    number: "LR-000000",
    leaveType: "annual",
    halfDay: false,
    days: 1,
    reason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    ...overrides,
  };
}

describe("filterLeaveRequests", () => {
  const requests: LeaveRequest[] = [
    request({ employeeId: "emp-1", leaveType: "annual", status: "pending", startDate: "2026-08-01", endDate: "2026-08-02" }),
    request({ employeeId: "emp-1", leaveType: "sick", status: "approved", startDate: "2026-08-10", endDate: "2026-08-12" }),
    request({ employeeId: "emp-2", leaveType: "annual", status: "approved", startDate: "2026-08-05", endDate: "2026-08-06" }),
  ];

  it("with no filter, returns everything", () => {
    expect(filterLeaveRequests(requests, {})).toHaveLength(3);
  });

  it("filters by employee", () => {
    expect(filterLeaveRequests(requests, { employeeId: "emp-1" })).toHaveLength(2);
  });

  it("filters by status", () => {
    expect(filterLeaveRequests(requests, { status: "approved" }).map((r) => r.employeeId)).toEqual(["emp-1", "emp-2"]);
  });

  it("filters by leave type", () => {
    expect(filterLeaveRequests(requests, { leaveType: "sick" })).toHaveLength(1);
  });

  it("keeps only requests whose period overlaps [from, to]", () => {
    const overlapping = filterLeaveRequests(requests, { from: "2026-08-06", to: "2026-08-09" });
    // emp-2's request ends 08-06 (touches the window); the 08-01/08-02 request ends before "from" and is excluded;
    // the 08-10/08-12 request starts after "to" and is excluded.
    expect(overlapping.map((r) => r.employeeId)).toEqual(["emp-2"]);
  });

  it("combines multiple filters", () => {
    expect(filterLeaveRequests(requests, { employeeId: "emp-1", status: "pending" })).toHaveLength(1);
    expect(filterLeaveRequests(requests, { employeeId: "emp-1", status: "rejected" })).toHaveLength(0);
  });
});

describe("isOnApprovedLeave", () => {
  it("is true when an approved request covers the date", () => {
    const requests: LeaveRequest[] = [request({ employeeId: "emp-1", status: "approved", startDate: "2026-08-10", endDate: "2026-08-12" })];
    expect(isOnApprovedLeave(requests, "emp-1", "2026-08-11")).toBe(true);
    expect(isOnApprovedLeave(requests, "emp-1", "2026-08-10")).toBe(true); // boundary: start date
    expect(isOnApprovedLeave(requests, "emp-1", "2026-08-12")).toBe(true); // boundary: end date
  });

  it("is false one day outside the request's window", () => {
    const requests: LeaveRequest[] = [request({ employeeId: "emp-1", status: "approved", startDate: "2026-08-10", endDate: "2026-08-12" })];
    expect(isOnApprovedLeave(requests, "emp-1", "2026-08-09")).toBe(false);
    expect(isOnApprovedLeave(requests, "emp-1", "2026-08-13")).toBe(false);
  });

  it("is false for a pending or rejected request covering the same date", () => {
    const requests: LeaveRequest[] = [request({ employeeId: "emp-1", status: "pending", startDate: "2026-08-10", endDate: "2026-08-12" })];
    expect(isOnApprovedLeave(requests, "emp-1", "2026-08-11")).toBe(false);
  });

  it("is false for a different employee's approved leave on the same date", () => {
    const requests: LeaveRequest[] = [request({ employeeId: "emp-2", status: "approved", startDate: "2026-08-10", endDate: "2026-08-12" })];
    expect(isOnApprovedLeave(requests, "emp-1", "2026-08-11")).toBe(false);
  });
});
