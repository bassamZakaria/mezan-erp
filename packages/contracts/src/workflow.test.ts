import { describe, it, expect } from "vitest";
import {
  gateStepSchema,
  workflowConfigSchema,
  createWorkflowConfigSchema,
  updateWorkflowConfigSchema,
  approvalStatusSchema,
  decisionKindSchema,
  decisionRecordSchema,
  approvalRequestSchema,
  submitApprovalRequestSchema,
  decideApprovalRequestSchema,
} from "./workflow.js";

describe("gateStepSchema", () => {
  it("accepts a minimal valid step and preserves it verbatim", () => {
    const step = { role: "finance-manager", description: "manager sign-off" };
    const result = gateStepSchema.safeParse(step);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(step);
  });

  it("accepts a step without the optional description", () => {
    const result = gateStepSchema.safeParse({ role: "finance-manager" });
    expect(result.success).toBe(true);
  });

  it("rejects a step missing role", () => {
    const result = gateStepSchema.safeParse({ description: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("role");
  });
});

describe("workflowConfigSchema", () => {
  const config = {
    id: "wf-1",
    actionType: "sales-invoice.post",
    steps: [{ role: "finance-manager" }],
    createdAt: "2026-08-30T10:00:00.000Z",
    updatedAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid config and preserves every field verbatim", () => {
    const result = workflowConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(config);
  });

  it("rejects a config with zero steps", () => {
    const result = workflowConfigSchema.safeParse({ ...config, steps: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("steps");
  });

  it("rejects a config missing actionType", () => {
    const { actionType, ...rest } = config;
    const result = workflowConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("actionType");
  });
});

describe("createWorkflowConfigSchema", () => {
  const create = { actionType: "sales-invoice.post", steps: [{ role: "finance-manager" }] };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = createWorkflowConfigSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("silently strips a caller-supplied id — identity is server-assigned", () => {
    const result = createWorkflowConfigSchema.safeParse({ ...create, id: "wf-caller" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("id");
  });

  it("rejects zero steps", () => {
    const result = createWorkflowConfigSchema.safeParse({ ...create, steps: [] });
    expect(result.success).toBe(false);
  });
});

describe("updateWorkflowConfigSchema", () => {
  it("accepts a minimal valid payload and preserves it verbatim", () => {
    const update = { steps: [{ role: "cfo" }] };
    const result = updateWorkflowConfigSchema.safeParse(update);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(update);
  });

  it("rejects a payload missing steps — steps is required, not partial, on this update schema", () => {
    const result = updateWorkflowConfigSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("steps");
  });

  it("rejects zero steps", () => {
    const result = updateWorkflowConfigSchema.safeParse({ steps: [] });
    expect(result.success).toBe(false);
  });
});

describe("approvalStatusSchema", () => {
  it("accepts each known status", () => {
    for (const status of ["pending", "approved", "rejected", "modification_requested"]) {
      expect(approvalStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(approvalStatusSchema.safeParse("cancelled").success).toBe(false);
  });
});

describe("decisionKindSchema", () => {
  it("accepts each known decision kind", () => {
    for (const kind of ["approve", "reject", "request_modification", "bypass"]) {
      expect(decisionKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("rejects a kind outside the enum", () => {
    expect(decisionKindSchema.safeParse("delegate").success).toBe(false);
  });
});

describe("decisionRecordSchema", () => {
  const record = { stepIndex: 0, kind: "approve" as const, actorId: "user-1" };

  it("accepts a minimal valid record and preserves every field verbatim", () => {
    const result = decisionRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(record);
  });

  it("rejects a negative stepIndex", () => {
    const result = decisionRecordSchema.safeParse({ ...record, stepIndex: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum kind", () => {
    const result = decisionRecordSchema.safeParse({ ...record, kind: "delegate" });
    expect(result.success).toBe(false);
  });
});

describe("approvalRequestSchema", () => {
  const request = {
    id: "req-1",
    actionType: "sales-invoice.post",
    submittedBy: "user-1",
    steps: [{ role: "finance-manager" }],
    currentStep: 0,
    status: "pending" as const,
    decisions: [],
    entityLabel: "SI-2026-001",
    createdAt: "2026-08-30T10:00:00.000Z",
    updatedAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid request and preserves every field verbatim", () => {
    const result = approvalRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(request);
  });

  it("accepts a null entityLabel", () => {
    const result = approvalRequestSchema.safeParse({ ...request, entityLabel: null });
    expect(result.success).toBe(true);
  });

  it("rejects a request missing status", () => {
    const { status, ...rest } = request;
    const result = approvalRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("status");
  });
});

describe("submitApprovalRequestSchema", () => {
  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = submitApprovalRequestSchema.safeParse({ actionType: "sales-invoice.post" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ actionType: "sales-invoice.post" });
  });

  it("rejects a payload missing actionType", () => {
    const result = submitApprovalRequestSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("actionType");
  });
});

describe("decideApprovalRequestSchema", () => {
  it("accepts a minimal valid decision", () => {
    const result = decideApprovalRequestSchema.safeParse({ decision: "approve" });
    expect(result.success).toBe(true);
  });

  it("rejects bypass — bypass is not a caller-issuable decision on this endpoint", () => {
    const result = decideApprovalRequestSchema.safeParse({ decision: "bypass" });
    expect(result.success).toBe(false);
  });

  it("rejects a decision missing decision", () => {
    const result = decideApprovalRequestSchema.safeParse({ comment: "looks fine" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("decision");
  });
});
