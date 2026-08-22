import { describe, it, expect } from "vitest";
import {
  GATEABLE_ACTION_TYPES,
  isGateableActionType,
  startApproval,
  decide,
  resubmit,
  WorkflowError,
  type GateConfig,
} from "./index.js";

describe("gateable action types", () => {
  it("catalogs exactly the 26 documented actions", () => {
    expect(GATEABLE_ACTION_TYPES).toHaveLength(26);
    expect(isGateableActionType("SALES_INVOICE_CONFIRM")).toBe(true);
    expect(isGateableActionType("NOT_A_REAL_ACTION")).toBe(false);
  });

  it("includes the 9 granular leave-type gates", () => {
    const leave = GATEABLE_ACTION_TYPES.filter(
      (a) => a.category === "hr_leave",
    );
    expect(leave).toHaveLength(9);
  });
});

const twoStep: GateConfig = {
  actionType: "SALES_INVOICE_CONFIRM",
  steps: [
    { role: "SUPERVISOR", description: "Supervisor review" },
    { role: "FINANCE_MANAGER", description: "Finance approval" },
  ],
};

describe("multi-step sequential approval", () => {
  it("walks steps in order and grants after the final approval", () => {
    const started = startApproval(twoStep, {
      requestId: "req-1",
      submittedBy: "alice",
    });
    expect(started.request.status).toBe("pending");
    expect(started.request.currentStep).toBe(0);
    expect(started.events[0]?.type).toBe("WORKFLOW_APPROVAL_REQUESTED");
    expect(started.events[0]?.role).toBe("SUPERVISOR");

    const step1 = decide(started.request, {
      actorId: "sup",
      actorRoles: ["SUPERVISOR"],
      decision: "approve",
    });
    expect(step1.request.status).toBe("pending");
    expect(step1.request.currentStep).toBe(1);
    // advancing notifies the next approver
    expect(step1.events[0]?.type).toBe("WORKFLOW_APPROVAL_REQUESTED");
    expect(step1.events[0]?.role).toBe("FINANCE_MANAGER");

    const step2 = decide(step1.request, {
      actorId: "fm",
      actorRoles: ["FINANCE_MANAGER"],
      decision: "approve",
    });
    expect(step2.request.status).toBe("approved");
    expect(step2.events[0]?.type).toBe("WORKFLOW_APPROVAL_GRANTED");
    expect(step2.request.decisions).toHaveLength(2);
  });

  it("rejects the wrong approver for the current step", () => {
    const started = startApproval(twoStep, {
      requestId: "req-2",
      submittedBy: "alice",
    });
    expect(() =>
      decide(started.request, {
        actorId: "fm",
        actorRoles: ["FINANCE_MANAGER"],
        decision: "approve",
      }),
    ).toThrow(WorkflowError);
  });
});

describe("rejection", () => {
  it("terminates the request and emits REJECTED", () => {
    const started = startApproval(twoStep, {
      requestId: "req-3",
      submittedBy: "alice",
    });
    const rejected = decide(started.request, {
      actorId: "sup",
      actorRoles: ["SUPERVISOR"],
      decision: "reject",
      comment: "missing PO",
    });
    expect(rejected.request.status).toBe("rejected");
    expect(rejected.events[0]?.type).toBe("WORKFLOW_APPROVAL_REJECTED");
    expect(rejected.events[0]?.comment).toBe("missing PO");
    // no further decisions allowed
    expect(() =>
      decide(rejected.request, {
        actorId: "sup",
        actorRoles: ["SUPERVISOR"],
        decision: "approve",
      }),
    ).toThrow(WorkflowError);
  });
});

describe("modification requested", () => {
  it("returns to submitter and can be resubmitted from step 0", () => {
    const started = startApproval(twoStep, {
      requestId: "req-4",
      submittedBy: "alice",
    });
    // advance to step 1 first
    const step1 = decide(started.request, {
      actorId: "sup",
      actorRoles: ["SUPERVISOR"],
      decision: "approve",
    });
    const mod = decide(step1.request, {
      actorId: "fm",
      actorRoles: ["FINANCE_MANAGER"],
      decision: "request_modification",
      comment: "fix totals",
    });
    expect(mod.request.status).toBe("modification_requested");
    expect(mod.events[0]?.type).toBe("WORKFLOW_MODIFICATION_REQUESTED");

    const again = resubmit(mod.request, { submittedBy: "alice" });
    expect(again.request.status).toBe("pending");
    expect(again.request.currentStep).toBe(0);
    expect(again.events[0]?.type).toBe("WORKFLOW_APPROVAL_REQUESTED");
    expect(again.events[0]?.role).toBe("SUPERVISOR");
  });

  it("refuses to resubmit a request that is not modification_requested", () => {
    const started = startApproval(twoStep, {
      requestId: "req-5",
      submittedBy: "alice",
    });
    expect(() => resubmit(started.request)).toThrow(WorkflowError);
  });
});

describe("admin bypass", () => {
  it("admin submitter is granted immediately without steps", () => {
    const started = startApproval(twoStep, {
      requestId: "req-6",
      submittedBy: "boss",
      submitterRoles: ["*"],
    });
    expect(started.request.status).toBe("approved");
    expect(started.events[0]?.type).toBe("WORKFLOW_APPROVAL_GRANTED");
  });

  it("admin actor approves the whole request from any step", () => {
    const started = startApproval(twoStep, {
      requestId: "req-7",
      submittedBy: "alice",
    });
    const done = decide(started.request, {
      actorId: "boss",
      actorRoles: ["*"],
      decision: "approve",
    });
    expect(done.request.status).toBe("approved");
    expect(done.request.currentStep).toBe(twoStep.steps.length);
    expect(done.events[0]?.type).toBe("WORKFLOW_APPROVAL_GRANTED");
  });
});

describe("empty gate config", () => {
  it("auto-grants when no steps are configured", () => {
    const started = startApproval(
      { actionType: "ACCOUNTING_JOURNAL_POST", steps: [] },
      { requestId: "req-8", submittedBy: "alice" },
    );
    expect(started.request.status).toBe("approved");
    expect(started.events[0]?.type).toBe("WORKFLOW_APPROVAL_GRANTED");
  });
});
