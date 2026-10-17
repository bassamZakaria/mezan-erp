import { describe, it, expect } from "vitest";
import {
  leadStatusSchema,
  leadSourceSchema,
  leadSchema,
  createLeadSchema,
  transitionLeadSchema,
  convertLeadSchema,
  opportunityStatusSchema,
  opportunitySchema,
  createOpportunitySchema,
  moveOpportunityStageSchema,
  pipelineStageSchema,
  createPipelineStageSchema,
  activityTypeSchema,
  activityStatusSchema,
  activitySchema,
  createActivitySchema,
} from "./crm.js";

describe("leadSchema", () => {
  const lead = {
    id: "lead-1",
    name: "أحمد محمد",
    company: null,
    email: null,
    phone: null,
    source: "website" as const,
    expectedValue: "5000.000000",
    interest: null,
    notes: null,
    status: "new" as const,
    convertedCustomerId: null,
    convertedOpportunityId: null,
    createdAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid lead and preserves every field verbatim", () => {
    const result = leadSchema.safeParse(lead);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(lead);
  });

  it("never coerces expectedValue to a float — high-precision decimal string survives verbatim", () => {
    const result = leadSchema.safeParse({ ...lead, expectedValue: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.expectedValue).toBe("0.100001");
  });

  it("rejects expectedValue sent as a JS number instead of a string", () => {
    const result = leadSchema.safeParse({ ...lead, expectedValue: 5000.12 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum status", () => {
    const result = leadSchema.safeParse({ ...lead, status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("createLeadSchema", () => {
  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createLeadSchema.safeParse({ name: "أحمد محمد" });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing name", () => {
    const result = createLeadSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("name");
  });

  it("silently strips status — a new lead always starts at the server default status", () => {
    const result = createLeadSchema.safeParse({ name: "أحمد محمد", status: "qualified" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("status");
  });
});

describe("transitionLeadSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = transitionLeadSchema.safeParse({ status: "qualified" });
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum status", () => {
    const result = transitionLeadSchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("convertLeadSchema", () => {
  it("accepts a minimal valid payload with both sub-objects omitted", () => {
    const result = convertLeadSchema.safeParse({ createCustomer: false, createOpportunity: false });
    expect(result.success).toBe(true);
  });

  it("accepts a full conversion into both a customer and an opportunity", () => {
    const payload = {
      createCustomer: true,
      customer: { id: "cust-1", code: "CUST-001" },
      createOpportunity: true,
      opportunity: { id: "opp-1", title: "صفقة جديدة", stageId: "stage-1", expectedValue: "10000.000000", probability: 50 },
    };
    const result = convertLeadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(payload);
  });

  it("rejects an opportunity probability above 100", () => {
    const result = convertLeadSchema.safeParse({
      createCustomer: false,
      createOpportunity: true,
      opportunity: { id: "opp-1", title: "صفقة", stageId: "stage-1", expectedValue: "10000", probability: 150 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing createCustomer", () => {
    const result = convertLeadSchema.safeParse({ createOpportunity: false });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("createCustomer");
  });
});

describe("opportunitySchema", () => {
  const opportunity = {
    id: "opp-1",
    title: "صفقة جديدة",
    customerId: "cust-1",
    branchId: null,
    stageId: "stage-1",
    expectedValue: "10000.123456",
    probability: 50,
    expectedCloseDate: null,
    notes: null,
    ownerUserId: null,
    lostReason: null,
    lostNote: null,
    status: "open" as const,
    createdAt: "2026-08-30T10:00:00.000Z",
    closedAt: null,
  };

  it("accepts a minimal valid opportunity and preserves every field verbatim", () => {
    const result = opportunitySchema.safeParse(opportunity);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(opportunity);
  });

  it("never coerces expectedValue to a float — high-precision decimal string survives verbatim", () => {
    const result = opportunitySchema.safeParse({ ...opportunity, expectedValue: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.expectedValue).toBe("0.100001");
  });

  it("rejects a probability outside 0-100", () => {
    expect(opportunitySchema.safeParse({ ...opportunity, probability: -1 }).success).toBe(false);
    expect(opportunitySchema.safeParse({ ...opportunity, probability: 101 }).success).toBe(false);
  });

  it("rejects an out-of-enum status", () => {
    const result = opportunitySchema.safeParse({ ...opportunity, status: "stalled" });
    expect(result.success).toBe(false);
  });
});

describe("createOpportunitySchema", () => {
  const create = { title: "صفقة جديدة", customerId: "cust-1", stageId: "stage-1" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createOpportunitySchema.safeParse(create);
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing customerId", () => {
    const { customerId, ...rest } = create;
    const result = createOpportunitySchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("customerId");
  });

  it("rejects a probability outside 0-100 when supplied", () => {
    const result = createOpportunitySchema.safeParse({ ...create, probability: 150 });
    expect(result.success).toBe(false);
  });
});

describe("pipelineStageSchema", () => {
  const stage = {
    id: "stage-1",
    name: "التفاوض",
    order: 2,
    defaultProbability: 50,
    color: "#0f766e",
    isWinStage: false,
    isLossStage: false,
    active: true,
  };

  it("accepts a minimal valid stage and preserves every field verbatim", () => {
    const result = pipelineStageSchema.safeParse(stage);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(stage);
  });

  it("rejects a negative order", () => {
    const result = pipelineStageSchema.safeParse({ ...stage, order: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a defaultProbability outside 0-100", () => {
    const result = pipelineStageSchema.safeParse({ ...stage, defaultProbability: 150 });
    expect(result.success).toBe(false);
  });
});

describe("createPipelineStageSchema", () => {
  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createPipelineStageSchema.safeParse({ name: "التفاوض" });
    expect(result.success).toBe(true);
  });

  it("silently strips order — server assigns the position in the pipeline", () => {
    const result = createPipelineStageSchema.safeParse({ name: "التفاوض", order: 5 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("order");
  });
});

describe("activitySchema", () => {
  const activity = {
    id: "act-1",
    subject: "متابعة العميل",
    type: "call" as const,
    relatedLeadId: "lead-1",
    relatedOpportunityId: null,
    dueDate: "2026-09-01",
    status: "pending" as const,
    notes: null,
    assigneeUserId: null,
    createdAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid activity and preserves every field verbatim", () => {
    const result = activitySchema.safeParse(activity);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(activity);
  });

  it("rejects an out-of-enum type", () => {
    const result = activitySchema.safeParse({ ...activity, type: "chat" });
    expect(result.success).toBe(false);
  });
});

describe("createActivitySchema", () => {
  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createActivitySchema.safeParse({ subject: "متابعة العميل" });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing subject", () => {
    const result = createActivitySchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("subject");
  });
});
