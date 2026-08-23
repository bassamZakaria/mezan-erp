import { describe, it, expect } from "vitest";
import { createInMemoryLeaveRequestRepository } from "./test-helpers/in-memory-hr-repositories.js";
import { createLeaveRequest, decideLeaveRequest, cancelLeaveRequest } from "./leave-request.js";
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
