import { describe, it, expect } from "vitest";
import { NextNumberService } from "../numbering/index.js";
import { submitLeaveRequest } from "./submit-leave-request.js";
import { decideLeaveRequest } from "./decide-leave-request.js";
import { cancelLeaveRequest } from "./cancel-leave-request.js";
import { LeaveRequestNotPendingError } from "./leave-request.js";
import { createInMemoryLeaveRequestRepository } from "./test-helpers/in-memory-leave-request-repository.js";
import { InMemorySequenceStore } from "./test-helpers/in-memory-sequence-store.js";

const WEEKEND = [5, 6];

async function pendingRequest() {
  const requests = createInMemoryLeaveRequestRepository();
  const numbering = new NextNumberService(new InMemorySequenceStore());
  const request = await submitLeaveRequest(
    {
      id: "req-1",
      employeeId: "emp-1",
      leaveTypeCode: "ANNUAL",
      startDate: "2026-08-16",
      endDate: "2026-08-16",
      submittedBy: "user-1",
    },
    {
      requests,
      numbering,
      weekendDays: WEEKEND,
      resolveGateConfig: (actionType) => ({ actionType, steps: [{ role: "hr_manager" }] }),
    },
  );
  return { requests, request };
}

describe("decideLeaveRequest", () => {
  it("approve by the correct role grants the request", async () => {
    const { requests, request } = await pendingRequest();
    const decided = await decideLeaveRequest(
      { id: request.id, actorId: "mgr-1", actorRoles: ["hr_manager"], decision: "approve" },
      { requests },
    );
    expect(decided.status).toBe("APPROVED");
    expect(decided.decidedAt).not.toBeNull();
  });

  it("reject terminates the request", async () => {
    const { requests, request } = await pendingRequest();
    const decided = await decideLeaveRequest(
      { id: request.id, actorId: "mgr-1", actorRoles: ["hr_manager"], decision: "reject", comment: "لا يوجد رصيد كافٍ" },
      { requests },
    );
    expect(decided.status).toBe("REJECTED");
  });

  it("an actor without the required role cannot decide", async () => {
    const { requests, request } = await pendingRequest();
    await expect(
      decideLeaveRequest({ id: request.id, actorId: "u2", actorRoles: ["sales_rep"], decision: "approve" }, { requests }),
    ).rejects.toThrow();
  });

  it("an admin (\"*\") actor bypasses the role check", async () => {
    const { requests, request } = await pendingRequest();
    const decided = await decideLeaveRequest(
      { id: request.id, actorId: "admin-1", actorRoles: ["*"], decision: "approve" },
      { requests },
    );
    expect(decided.status).toBe("APPROVED");
  });

  it("cannot decide an already-decided request", async () => {
    const { requests, request } = await pendingRequest();
    await decideLeaveRequest({ id: request.id, actorId: "mgr-1", actorRoles: ["hr_manager"], decision: "approve" }, { requests });
    await expect(
      decideLeaveRequest({ id: request.id, actorId: "mgr-1", actorRoles: ["hr_manager"], decision: "reject" }, { requests }),
    ).rejects.toBeInstanceOf(LeaveRequestNotPendingError);
  });
});

describe("cancelLeaveRequest", () => {
  it("cancels a PENDING request", async () => {
    const { requests, request } = await pendingRequest();
    const cancelled = await cancelLeaveRequest({ id: request.id }, { requests });
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("cannot cancel an already-decided request", async () => {
    const { requests, request } = await pendingRequest();
    await decideLeaveRequest({ id: request.id, actorId: "mgr-1", actorRoles: ["hr_manager"], decision: "approve" }, { requests });
    await expect(cancelLeaveRequest({ id: request.id }, { requests })).rejects.toBeInstanceOf(LeaveRequestNotPendingError);
  });
});
