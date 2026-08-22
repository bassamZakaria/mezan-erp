import { describe, it, expect } from "vitest";
import { createFollowUp, completeFollowUp, cancelFollowUp } from "./follow-up.js";
import { InvalidFollowUpTransitionError } from "./errors.js";

describe("Collection follow-up lifecycle", () => {
  it("creates a pending follow-up defaulting the assignee/plan to null", () => {
    const f = createFollowUp({
      id: "F1",
      customerId: "CUST1",
      type: "CALL",
      followUpDate: "2026-08-21",
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    expect(f.status).toBe("pending");
    expect(f.assignedTo).toBeNull();
    expect(f.installmentPlanId).toBeNull();
    expect(f.outcome).toBeNull();
  });

  it("completes a pending follow-up with an outcome", () => {
    const f = createFollowUp({
      id: "F2",
      customerId: "CUST1",
      type: "VISIT",
      followUpDate: "2026-08-21",
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    const done = completeFollowUp(f, "وعد بالدفع الأسبوع القادم");
    expect(done.status).toBe("completed");
    expect(done.outcome).toBe("وعد بالدفع الأسبوع القادم");
  });

  it("cancels a pending follow-up", () => {
    const f = createFollowUp({
      id: "F3",
      customerId: "CUST1",
      type: "NOTE",
      followUpDate: "2026-08-21",
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    expect(cancelFollowUp(f).status).toBe("cancelled");
  });

  it("rejects completing/cancelling a follow-up that's already terminal", () => {
    const f = createFollowUp({
      id: "F4",
      customerId: "CUST1",
      type: "EMAIL",
      followUpDate: "2026-08-21",
      createdAt: "2026-08-21T00:00:00.000Z",
    });
    const cancelled = cancelFollowUp(f);
    expect(() => completeFollowUp(cancelled, "x")).toThrow(InvalidFollowUpTransitionError);
    expect(() => cancelFollowUp(cancelled)).toThrow(InvalidFollowUpTransitionError);
  });
});
