import { describe, it, expect } from "vitest";
import { createInMemoryActivityRepository } from "./test-helpers/in-memory-crm-repositories.js";
import { createActivity, completeActivity, cancelActivity, type Activity } from "./activity.js";
import { InvalidActivityError, ActivityNotPendingError } from "./errors.js";

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "act-1",
    subject: "متابعة العميل",
    type: "call",
    relatedLeadId: null,
    relatedOpportunityId: null,
    dueDate: null,
    assigneeUserId: null,
    status: "pending",
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("createActivity", () => {
  it("creates an activity with defaults, starting status 'pending'", async () => {
    const repo = createInMemoryActivityRepository();
    const act = await createActivity({ id: "act-1", subject: "متابعة العميل" }, repo);
    expect(act).toMatchObject({
      id: "act-1",
      subject: "متابعة العميل",
      type: "todo",
      relatedLeadId: null,
      relatedOpportunityId: null,
      status: "pending",
    });
    expect(await repo.findById("act-1")).toEqual(act);
  });

  it("creates an activity linked to a lead and opportunity", async () => {
    const repo = createInMemoryActivityRepository();
    const act = await createActivity(
      { id: "act-2", subject: "اجتماع", type: "meeting", relatedLeadId: "lead-1", relatedOpportunityId: "opp-1" },
      repo,
    );
    expect(act.relatedLeadId).toBe("lead-1");
    expect(act.relatedOpportunityId).toBe("opp-1");
    expect(act.type).toBe("meeting");
  });

  it("rejects an empty subject", async () => {
    const repo = createInMemoryActivityRepository();
    await expect(createActivity({ id: "act-3", subject: "  " }, repo)).rejects.toThrow(InvalidActivityError);
  });
});

describe("completeActivity / cancelActivity", () => {
  it("completes a pending activity", () => {
    const next = completeActivity(activity());
    expect(next.status).toBe("completed");
  });

  it("cancels a pending activity", () => {
    const next = cancelActivity(activity());
    expect(next.status).toBe("cancelled");
  });

  it("throws ActivityNotPendingError when completing a non-pending activity", () => {
    expect(() => completeActivity(activity({ status: "completed" }))).toThrow(ActivityNotPendingError);
    expect(() => completeActivity(activity({ status: "cancelled" }))).toThrow(ActivityNotPendingError);
  });

  it("throws ActivityNotPendingError when cancelling a non-pending activity", () => {
    expect(() => cancelActivity(activity({ status: "completed" }))).toThrow(ActivityNotPendingError);
  });
});
