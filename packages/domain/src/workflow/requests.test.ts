import { describe, it, expect } from "vitest";
import { DuplicateRecordIdError } from "../records/duplicate-record-id.js";
import { WorkflowError, type GateConfig } from "./gate.js";
import {
  submitApproval,
  decideApproval,
  resubmitApproval,
  ApprovalRequestNotFoundError,
  type ApprovalRequestRecord,
  type ApprovalRequestRepository,
} from "./requests.js";

function fakeRepo(): ApprovalRequestRepository & { readonly rows: Map<string, ApprovalRequestRecord> } {
  const rows = new Map<string, ApprovalRequestRecord>();
  return {
    rows,
    async list() {
      return [...rows.values()];
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async insert(record) {
      if (rows.has(record.id)) throw new DuplicateRecordIdError(record.id);
      rows.set(record.id, record);
    },
    async save(record) {
      rows.set(record.id, record);
    },
    async listPendingForRoles(roles) {
      return [...rows.values()].filter((r) => {
        if (r.status !== "pending") return false;
        if (roles.includes("*")) return true;
        const role = r.steps[r.currentStep]?.role;
        return role !== undefined && roles.includes(role);
      });
    },
    async listBySubmitter(submittedBy) {
      return [...rows.values()].filter((r) => r.submittedBy === submittedBy);
    },
  };
}

const twoStep: GateConfig = {
  actionType: "SALES_INVOICE_CONFIRM",
  steps: [{ role: "SUPERVISOR" }, { role: "FINANCE_MANAGER" }],
};

describe("submitApproval", () => {
  it("persists a pending request at step 0", async () => {
    const repo = fakeRepo();
    const record = await submitApproval(
      { requestId: "req-1", actionType: "SALES_INVOICE_CONFIRM", submittedBy: "alice", entityLabel: "فاتورة INV-001" },
      twoStep,
      repo,
    );
    expect(record.status).toBe("pending");
    expect(record.currentStep).toBe(0);
    expect(record.entityLabel).toBe("فاتورة INV-001");
    expect((await repo.findById("req-1"))?.status).toBe("pending");
  });

  it("grants immediately with no configured steps", async () => {
    const repo = fakeRepo();
    const record = await submitApproval(
      { requestId: "req-1", actionType: "SALES_INVOICE_CONFIRM", submittedBy: "alice" },
      { actionType: "SALES_INVOICE_CONFIRM", steps: [] },
      repo,
    );
    expect(record.status).toBe("approved");
  });

  it("bypasses the gate for an admin submitter", async () => {
    const repo = fakeRepo();
    const record = await submitApproval(
      { requestId: "req-1", actionType: "SALES_INVOICE_CONFIRM", submittedBy: "admin", submitterRoles: ["*"] },
      twoStep,
      repo,
    );
    expect(record.status).toBe("approved");
  });
});

describe("decideApproval", () => {
  it("advances to the next step on approve", async () => {
    const repo = fakeRepo();
    await submitApproval({ requestId: "req-1", actionType: "SALES_INVOICE_CONFIRM", submittedBy: "alice" }, twoStep, repo);
    const record = await decideApproval(
      "req-1",
      { actorId: "sup-1", actorRoles: ["SUPERVISOR"], decision: "approve" },
      repo,
    );
    expect(record.status).toBe("pending");
    expect(record.currentStep).toBe(1);
  });

  it("grants after the final approval and keeps the entity label", async () => {
    const repo = fakeRepo();
    await submitApproval(
      { requestId: "req-1", actionType: "SALES_INVOICE_CONFIRM", submittedBy: "alice", entityLabel: "فاتورة INV-002" },
      twoStep,
      repo,
    );
    await decideApproval("req-1", { actorId: "sup-1", actorRoles: ["SUPERVISOR"], decision: "approve" }, repo);
    const record = await decideApproval("req-1", { actorId: "fin-1", actorRoles: ["FINANCE_MANAGER"], decision: "approve" }, repo);
    expect(record.status).toBe("approved");
    expect(record.entityLabel).toBe("فاتورة INV-002");
  });

  it("rejects a decision from the wrong role", async () => {
    const repo = fakeRepo();
    await submitApproval({ requestId: "req-1", actionType: "SALES_INVOICE_CONFIRM", submittedBy: "alice" }, twoStep, repo);
    await expect(
      decideApproval("req-1", { actorId: "x", actorRoles: ["FINANCE_MANAGER"], decision: "approve" }, repo),
    ).rejects.toBeInstanceOf(WorkflowError);
  });

  it("throws for an unknown request id", async () => {
    const repo = fakeRepo();
    await expect(
      decideApproval("nope", { actorId: "x", actorRoles: ["SUPERVISOR"], decision: "approve" }, repo),
    ).rejects.toBeInstanceOf(ApprovalRequestNotFoundError);
  });
});

describe("resubmitApproval", () => {
  it("restarts a modification_requested request from step 0", async () => {
    const repo = fakeRepo();
    await submitApproval({ requestId: "req-1", actionType: "SALES_INVOICE_CONFIRM", submittedBy: "alice" }, twoStep, repo);
    await decideApproval(
      "req-1",
      { actorId: "sup-1", actorRoles: ["SUPERVISOR"], decision: "request_modification" },
      repo,
    );
    const record = await resubmitApproval("req-1", {}, repo);
    expect(record.status).toBe("pending");
    expect(record.currentStep).toBe(0);
  });
});

describe("submitApproval never replaces a standing request", () => {
  it("refuses a second submission under an id already held and leaves the first as it was", async () => {
    const repo = fakeRepo();
    await submitApproval({ requestId: "r-held", actionType: "SALES_INVOICE_CONFIRM", submittedBy: "clerk" }, twoStep, repo);
    const before = await repo.findById("r-held");
    await expect(
      submitApproval({ requestId: "r-held", actionType: "TREASURY_VOUCHER_CONFIRM", submittedBy: "clerk" }, { actionType: "TREASURY_VOUCHER_CONFIRM", steps: [] }, repo),
    ).rejects.toBeInstanceOf(DuplicateRecordIdError);
    expect(await repo.findById("r-held")).toEqual(before);
  });
});
