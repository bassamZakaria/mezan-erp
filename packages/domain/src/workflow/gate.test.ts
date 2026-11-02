import { describe, it, expect } from "vitest";
import { startApproval, decide, resubmit, WorkflowError, type GateConfig } from "./gate.js";

function captureWorkflowError(fn: () => void): WorkflowError {
  try {
    fn();
  } catch (e) {
    if (e instanceof WorkflowError) return e;
    throw e;
  }
  throw new Error("expected fn to throw a WorkflowError");
}

const oneStep: GateConfig = {
  actionType: "SALES_INVOICE_CONFIRM",
  steps: [{ role: "SUPERVISOR" }],
};

const twoStep: GateConfig = {
  actionType: "SALES_INVOICE_CONFIRM",
  steps: [{ role: "SUPERVISOR" }, { role: "FINANCE_MANAGER" }],
};

describe("segregation of duties — self-approval is always refused", () => {
  it("the submitter cannot approve their own request, even holding the step role", () => {
    const started = startApproval(oneStep, { requestId: "req-1", submittedBy: "alice" });
    expect(() =>
      decide(started.request, { actorId: "alice", actorRoles: ["SUPERVISOR"], decision: "approve" }),
    ).toThrow(WorkflowError);
    try {
      decide(started.request, { actorId: "alice", actorRoles: ["SUPERVISOR"], decision: "approve" });
    } catch (e) {
      expect((e as WorkflowError).code).toBe("SELF_APPROVAL");
    }
  });

  it("the submitter cannot reject their own request", () => {
    const started = startApproval(oneStep, { requestId: "req-2", submittedBy: "alice" });
    expect(() =>
      decide(started.request, { actorId: "alice", actorRoles: ["SUPERVISOR"], decision: "reject" }),
    ).toThrow(WorkflowError);
  });

  it("the submitter cannot request modification on their own request", () => {
    const started = startApproval(oneStep, { requestId: "req-3", submittedBy: "alice" });
    expect(() =>
      decide(started.request, { actorId: "alice", actorRoles: ["SUPERVISOR"], decision: "request_modification" }),
    ).toThrow(WorkflowError);
  });

  it("the admin bypass does not lift self-approval — an admin submitter's OWN pending request still can't be self-decided", () => {
    // startApproval auto-grants an admin submitter, so build a pending request
    // manually to exercise decide()'s self-approval guard for an admin actor.
    const pending = { ...startApproval(oneStep, { requestId: "req-3b", submittedBy: "boss" }).request, status: "pending" as const, currentStep: 0 };
    expect(() => decide(pending, { actorId: "boss", actorRoles: ["*"], decision: "approve" })).toThrow(WorkflowError);
  });
});

describe("the gate names an approver ROLE, not a permission", () => {
  it("a permission-shaped string does not satisfy the step's role requirement", () => {
    const started = startApproval(oneStep, { requestId: "req-4", submittedBy: "alice" });
    expect(() =>
      decide(started.request, {
        actorId: "bob",
        actorRoles: ["sales.invoice.confirm"],
        decision: "approve",
      }),
    ).toThrow(WorkflowError);
  });

  it("an approver outside the named role is refused with WRONG_APPROVER", () => {
    const started = startApproval(oneStep, { requestId: "req-5", submittedBy: "alice" });
    const err = captureWorkflowError(() =>
      decide(started.request, { actorId: "bob", actorRoles: ["CLERK"], decision: "approve" }),
    );
    expect(err.code).toBe("WRONG_APPROVER");
    expect(err.requiredRole).toBe(oneStep.steps[0]?.role);
    expect(err.messageEn).toBe("You do not hold the role this step needs to be decided on.");
  });

  it("a gate with no approver configured (empty steps) grants immediately rather than silently blocking or silently passing an unauthenticated actor", () => {
    const started = startApproval({ actionType: "SALES_INVOICE_CONFIRM", steps: [] }, { requestId: "req-6", submittedBy: "alice" });
    expect(started.request.status).toBe("approved");
    expect(started.request.decisions).toEqual([]);
    expect(started.events).toHaveLength(1);
    expect(started.events[0]?.type).toBe("WORKFLOW_APPROVAL_GRANTED");
  });

  it("holding the exact role code (not a superset or substring) is required", () => {
    const started = startApproval(oneStep, { requestId: "req-7", submittedBy: "alice" });
    // "SUPERVISOR_JUNIOR" contains "SUPERVISOR" as a substring but is not the role
    expect(() =>
      decide(started.request, { actorId: "bob", actorRoles: ["SUPERVISOR_JUNIOR"], decision: "approve" }),
    ).toThrow(WorkflowError);
  });
});

describe("admin bypasses the role check but never the decision itself", () => {
  it("an admin actor can reject a request without holding the step's role", () => {
    const started = startApproval(oneStep, { requestId: "req-8", submittedBy: "alice" });
    const rejected = decide(started.request, { actorId: "boss", actorRoles: ["*"], decision: "reject" });
    expect(rejected.request.status).toBe("rejected");
    expect(rejected.events[0]?.type).toBe("WORKFLOW_APPROVAL_REJECTED");
  });

  it("an admin actor can request modification without holding the step's role", () => {
    const started = startApproval(oneStep, { requestId: "req-9", submittedBy: "alice" });
    const mod = decide(started.request, { actorId: "boss", actorRoles: ["*"], decision: "request_modification" });
    expect(mod.request.status).toBe("modification_requested");
  });
});

describe("decide() on a non-pending request", () => {
  it("throws NOT_PENDING on an already-approved request", () => {
    const started = startApproval({ actionType: "SALES_INVOICE_CONFIRM", steps: [] }, { requestId: "req-10", submittedBy: "alice" });
    const err = captureWorkflowError(() =>
      decide(started.request, { actorId: "bob", actorRoles: ["*"], decision: "approve" }),
    );
    expect(err.code).toBe("NOT_PENDING");
    expect(err.requestStatus).toBe("approved");
    expect(err.message).toBe("حالة هذا الطلب «معتمد» وليس قيد الانتظار، فلا يمكن البتّ فيه.");
    expect(err.messageEn).toBe("This request is approved, not pending, so it cannot be decided on.");
  });
});

describe("event contents", () => {
  it("a REQUESTED event names the requestId, actionType, stepIndex, and the approver role", () => {
    const started = startApproval(twoStep, { requestId: "req-11", submittedBy: "alice", at: 1000 });
    const event = started.events[0];
    expect(event?.requestId).toBe("req-11");
    expect(event?.actionType).toBe("SALES_INVOICE_CONFIRM");
    expect(event?.stepIndex).toBe(0);
    expect(event?.role).toBe("SUPERVISOR");
    expect(event?.at).toBe(1000);
  });

  it("a GRANTED event on final approval carries the actor and comment", () => {
    const started = startApproval(oneStep, { requestId: "req-12", submittedBy: "alice" });
    const granted = decide(started.request, { actorId: "sup", actorRoles: ["SUPERVISOR"], decision: "approve", comment: "ok" });
    expect(granted.events[0]?.actorId).toBe("sup");
    expect(granted.events[0]?.comment).toBe("ok");
    expect(granted.request.decisions[0]?.kind).toBe("approve");
  });
});

describe("resubmit", () => {
  it("throws NOT_MODIFIABLE on a pending request", () => {
    const started = startApproval(oneStep, { requestId: "req-13", submittedBy: "alice" });
    const err = captureWorkflowError(() => resubmit(started.request));
    expect(err.code).toBe("NOT_MODIFIABLE");
  });

  it("resubmitting keeps the original submitter unless overridden", () => {
    const started = startApproval(oneStep, { requestId: "req-14", submittedBy: "alice" });
    const mod = decide(started.request, { actorId: "sup", actorRoles: ["SUPERVISOR"], decision: "request_modification" });
    const again = resubmit(mod.request);
    expect(again.request.submittedBy).toBe("alice");
  });

  it("resubmitting can name a different submitter", () => {
    const started = startApproval(oneStep, { requestId: "req-15", submittedBy: "alice" });
    const mod = decide(started.request, { actorId: "sup", actorRoles: ["SUPERVISOR"], decision: "request_modification" });
    const again = resubmit(mod.request, { submittedBy: "carol" });
    expect(again.request.submittedBy).toBe("carol");
  });
});
