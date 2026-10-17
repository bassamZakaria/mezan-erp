import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { Activity } from "./activity.js";
import { dueActivityReminders } from "./activity-reminders.js";
import type { Opportunity } from "./opportunity.js";

const TODAY = "2026-10-17";

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "act-1",
    subject: "اتصال متابعة",
    type: "call",
    relatedLeadId: null,
    relatedOpportunityId: null,
    dueDate: TODAY,
    assigneeUserId: "rep-a",
    status: "pending",
    notes: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function deal(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    title: "فرصة",
    customerId: "cust-1",
    branchId: "br-1",
    stageId: "stage-1",
    expectedValue: Money.zero(),
    probability: 50,
    expectedCloseDate: null,
    notes: null,
    ownerUserId: "rep-b",
    lostReason: null,
    lostNote: null,
    status: "open",
    createdAt: "2026-10-01T00:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

describe("dueActivityReminders", () => {
  it("reminds the assignee of a pending activity due today or earlier this week", () => {
    const due = dueActivityReminders([activity(), activity({ id: "act-2", dueDate: "2026-10-12" })], [], TODAY);
    expect(due.map((r) => [r.activity.id, r.recipientUserId])).toEqual([
      ["act-1", "rep-a"],
      ["act-2", "rep-a"],
    ]);
  });

  it("skips future, finished, undated, stale and unowned activities", () => {
    const due = dueActivityReminders(
      [
        activity({ id: "future", dueDate: "2026-10-18" }),
        activity({ id: "done", status: "completed" }),
        activity({ id: "undated", dueDate: null }),
        activity({ id: "stale", dueDate: "2026-09-01" }),
        activity({ id: "nobody", assigneeUserId: null }),
      ],
      [],
      TODAY,
    );
    expect(due).toEqual([]);
  });

  it("falls back to the owner of the deal the activity hangs off", () => {
    const due = dueActivityReminders([activity({ assigneeUserId: null, relatedOpportunityId: "opp-1" })], [deal()], TODAY);
    expect(due[0]?.recipientUserId).toBe("rep-b");
    expect(due[0]?.opportunity?.id).toBe("opp-1");
  });
});
