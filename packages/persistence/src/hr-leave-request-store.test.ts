import { describe, it, expect, afterEach } from "vitest";
import { NextNumberService, submitLeaveApplication, decideLeaveApplication, cancelLeaveApplication } from "@mezan/domain";
import { createSqliteLeaveApplicationRepository } from "./hr-leave-request-store.js";
import { createSqliteSequenceStore } from "./sequence-store.js";

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

describe("SqliteLeaveApplicationRepository", () => {
  it("round-trips a submitted, gated (PENDING) request including its approval-chain state", async () => {
    const requests = createSqliteLeaveApplicationRepository();
    handles.push(requests);
    const sequences = createSqliteSequenceStore();
    handles.push(sequences);
    const numbering = new NextNumberService(sequences);

    const submitted = await submitLeaveApplication(
      {
        id: "req-1",
        employeeId: "emp-1",
        leaveTypeCode: "ANNUAL",
        startDate: "2026-08-16",
        endDate: "2026-08-17",
        submittedBy: "user-1",
      },
      { requests, numbering, weekendDays: [5, 6], resolveGateConfig: (actionType) => ({ actionType, steps: [{ role: "hr_manager" }] }) },
    );

    const found = await requests.findById("req-1");
    expect(found).toEqual(submitted);
    expect(found?.status).toBe("PENDING");
    expect(found?.steps).toEqual([{ role: "hr_manager" }]);
  });

  it("decide + cancel persist their status transition", async () => {
    const requests = createSqliteLeaveApplicationRepository();
    handles.push(requests);
    const sequences = createSqliteSequenceStore();
    handles.push(sequences);
    const numbering = new NextNumberService(sequences);

    await submitLeaveApplication(
      { id: "req-1", employeeId: "emp-1", leaveTypeCode: "SICK", startDate: "2026-08-16", endDate: "2026-08-16", submittedBy: "u1" },
      { requests, numbering, weekendDays: [5, 6], resolveGateConfig: (actionType) => ({ actionType, steps: [{ role: "hr_manager" }] }) },
    );
    await submitLeaveApplication(
      { id: "req-2", employeeId: "emp-2", leaveTypeCode: "SICK", startDate: "2026-08-18", endDate: "2026-08-18", submittedBy: "u2" },
      { requests, numbering, weekendDays: [5, 6], resolveGateConfig: (actionType) => ({ actionType, steps: [{ role: "hr_manager" }] }) },
    );

    const decided = await decideLeaveApplication({ id: "req-1", actorId: "mgr", actorRoles: ["hr_manager"], decision: "approve" }, { requests });
    expect(decided.status).toBe("APPROVED");

    const cancelled = await cancelLeaveApplication({ id: "req-2" }, { requests });
    expect(cancelled.status).toBe("CANCELLED");

    expect(await requests.list({ status: "APPROVED" })).toHaveLength(1);
    expect(await requests.list({ employeeId: "emp-2" })).toHaveLength(1);
  });
});
