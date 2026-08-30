import { describe, it, expect } from "vitest";
import {
  installmentFrequencySchema,
  installmentLineStatusSchema,
  createInstallmentPlanSchema,
  installmentLineSchema,
  installmentPlanDocumentSchema,
  processOverdueInstallmentsSchema,
  processOverdueInstallmentsResultSchema,
  followUpTypeSchema,
  followUpStatusSchema,
  createFollowUpSchema,
  completeFollowUpSchema,
  collectionFollowUpSchema,
} from "./installments.js";

describe("installmentFrequencySchema", () => {
  it("accepts each known frequency", () => {
    for (const f of ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"]) {
      expect(installmentFrequencySchema.safeParse(f).success).toBe(true);
    }
  });

  it("rejects a frequency outside the enum", () => {
    expect(installmentFrequencySchema.safeParse("DAILY").success).toBe(false);
  });
});

describe("createInstallmentPlanSchema", () => {
  const plan = {
    id: "plan-1",
    date: "2026-08-30",
    customerId: "cust-1",
    sourceInvoiceId: "si-1",
    sourceInvoiceNumber: "SI-2026-001",
    invoiceTotal: "12000.000000",
    installmentCount: 12,
    frequency: "MONTHLY" as const,
    startDate: "2026-09-01",
  };

  it("accepts a minimal valid payload and defaults memo and downPayment", () => {
    const result = createInstallmentPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.memo).toBe("");
      expect(result.data.downPayment).toBe("0");
    }
  });

  it("preserves an explicit downPayment", () => {
    const result = createInstallmentPlanSchema.safeParse({ ...plan, downPayment: "2000.000000" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.downPayment).toBe("2000.000000");
  });

  it("rejects a payload missing invoiceTotal", () => {
    const { invoiceTotal, ...rest } = plan;
    const result = createInstallmentPlanSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("invoiceTotal");
  });

  it("rejects invoiceTotal sent as a JS number instead of a string", () => {
    const result = createInstallmentPlanSchema.safeParse({ ...plan, invoiceTotal: 12000 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative invoiceTotal", () => {
    const result = createInstallmentPlanSchema.safeParse({ ...plan, invoiceTotal: "-1" });
    expect(result.success).toBe(false);
  });

  it("rejects a zero installmentCount", () => {
    const result = createInstallmentPlanSchema.safeParse({ ...plan, installmentCount: 0 });
    expect(result.success).toBe(false);
  });
});

describe("installmentLineSchema", () => {
  const line = {
    no: 1,
    customerId: "cust-1",
    sourceInvoiceId: "si-1",
    sourceInvoiceNumber: "SI-2026-001",
    frequency: "MONTHLY" as const,
    downPayment: "0",
    dueDate: "2026-10-01",
    amount: "1000.000000",
    paidAmount: "0",
    status: "pending" as const,
    lateFeeAmount: "0",
  };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = installmentLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("never coerces amount to a float — high-precision decimal string survives verbatim", () => {
    const result = installmentLineSchema.safeParse({ ...line, amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = installmentLineSchema.safeParse({ ...line, amount: 1000 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum status", () => {
    const result = installmentLineSchema.safeParse({ ...line, status: "written_off" });
    expect(result.success).toBe(false);
  });
});

describe("installmentPlanDocumentSchema", () => {
  const document = {
    id: "plan-1",
    docType: "INSTALLMENT_PLAN" as const,
    docNo: "IP-2026-001",
    date: "2026-08-30",
    memo: "",
    status: "confirmed" as const,
    lines: [],
    createdAt: "2026-08-30T10:00:00.000Z",
    confirmedAt: "2026-08-30T10:05:00.000Z",
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
  };

  it("accepts a minimal valid document and preserves every field verbatim", () => {
    const result = installmentPlanDocumentSchema.safeParse(document);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(document);
  });

  it("rejects a docType other than the literal INSTALLMENT_PLAN", () => {
    const result = installmentPlanDocumentSchema.safeParse({ ...document, docType: "SALES_INVOICE" });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum status", () => {
    const result = installmentPlanDocumentSchema.safeParse({ ...document, status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("processOverdueInstallmentsSchema", () => {
  it("accepts a minimal valid payload and preserves it verbatim", () => {
    const result = processOverdueInstallmentsSchema.safeParse({ asOfDate: "2026-08-30" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ asOfDate: "2026-08-30" });
  });

  it("rejects a payload missing asOfDate", () => {
    const result = processOverdueInstallmentsSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("asOfDate");
  });
});

describe("processOverdueInstallmentsResultSchema", () => {
  it("accepts a minimal valid result and preserves every field verbatim", () => {
    const result = { newlyOverdueCount: 3, totalLateFeesApplied: "150.000000" };
    const parsed = processOverdueInstallmentsResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(result);
  });

  it("rejects totalLateFeesApplied sent as a JS number instead of a string", () => {
    const parsed = processOverdueInstallmentsResultSchema.safeParse({ newlyOverdueCount: 3, totalLateFeesApplied: 150 });
    expect(parsed.success).toBe(false);
  });
});

describe("createFollowUpSchema", () => {
  const followUp = { id: "fu-1", customerId: "cust-1", type: "CALL" as const, followUpDate: "2026-08-30" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createFollowUpSchema.safeParse(followUp);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(followUp);
  });

  it("rejects a payload missing type", () => {
    const { type, ...rest } = followUp;
    const result = createFollowUpSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("type");
  });

  it("rejects an out-of-enum type", () => {
    const result = createFollowUpSchema.safeParse({ ...followUp, type: "LETTER" });
    expect(result.success).toBe(false);
  });
});

describe("completeFollowUpSchema", () => {
  it("accepts a minimal valid payload and preserves it verbatim", () => {
    const result = completeFollowUpSchema.safeParse({ outcome: "customer promised to pay next week" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty outcome", () => {
    const result = completeFollowUpSchema.safeParse({ outcome: "" });
    expect(result.success).toBe(false);
  });
});

describe("collectionFollowUpSchema", () => {
  const followUp = {
    id: "fu-1",
    customerId: "cust-1",
    installmentPlanId: null,
    type: "CALL" as const,
    followUpDate: "2026-08-30",
    assignedTo: null,
    notes: null,
    status: "pending" as const,
    outcome: null,
    createdAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid follow-up and preserves every field verbatim", () => {
    const result = collectionFollowUpSchema.safeParse(followUp);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(followUp);
  });

  it("rejects an out-of-enum status", () => {
    const result = collectionFollowUpSchema.safeParse({ ...followUp, status: "archived" });
    expect(result.success).toBe(false);
  });
});
