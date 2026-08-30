import { describe, it, expect } from "vitest";
import {
  voucherTypeSchema,
  voucherDirectionSchema,
  voucherPaymentMethodSchema,
  voucherStatusSchema,
  allocationInvoiceKindSchema,
  allocationStatusSchema,
  voucherSchema,
  createVoucherSchema,
  confirmVoucherSchema,
  reverseVoucherSchema,
  openInvoiceSchema,
  voucherAllocationSchema,
  createAllocationSchema,
  allocationSummarySchema,
  voucherListQuerySchema,
} from "./voucher.js";

describe("voucherTypeSchema", () => {
  it("accepts each of the eleven known voucher types", () => {
    for (const t of [
      "customer_collection",
      "supplier_payment",
      "customer_refund",
      "customer_advance",
      "supplier_refund",
      "other_income",
      "other_expense",
      "capital_injection",
      "capital_withdrawal",
      "tax_payment",
      "inter_treasury_transfer",
    ]) {
      expect(voucherTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("rejects a voucher type outside the enum", () => {
    expect(voucherTypeSchema.safeParse("loan").success).toBe(false);
  });
});

describe("voucherSchema", () => {
  const voucher = {
    id: "v-1",
    docNo: "PV-2026-001",
    voucherType: "supplier_payment" as const,
    direction: "payment" as const,
    status: "posted" as const,
    date: "2026-08-30",
    memo: "دفعة لمورد",
    amount: "10000.123456",
    currency: "EGP",
    branchId: "branch-1",
    paymentMethod: "bank" as const,
    treasuryAccountId: "acc-bank",
    treasuryGlAccountId: "acc-gl-bank",
    counterpartyGlAccountId: "acc-ap",
    counterTreasuryAccountId: null,
    counterTreasuryGlAccountId: null,
    customerId: null,
    supplierId: "sup-1",
    referenceNo: null,
    costCenterId: "cc-1",
    withholdingAmount: "500.000000",
    withholdingRatePercent: 5,
    netPaidAmount: "9500.123456",
    journalEntryId: "je-1",
    confirmedAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a full voucher and preserves every field verbatim — including the cost centre and withholding dimensions this format was built to carry", () => {
    const result = voucherSchema.safeParse(voucher);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(voucher);
  });

  it("accepts a null costCenterId and null withholding fields for a voucher without them", () => {
    const result = voucherSchema.safeParse({ ...voucher, costCenterId: null, withholdingAmount: null, withholdingRatePercent: null });
    expect(result.success).toBe(true);
  });

  it("never coerces withholdingAmount to a float — high-precision decimal string survives verbatim", () => {
    const result = voucherSchema.safeParse({ ...voucher, withholdingAmount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.withholdingAmount).toBe("0.100001");
  });

  it("rejects withholdingAmount sent as a JS number instead of a string", () => {
    const result = voucherSchema.safeParse({ ...voucher, withholdingAmount: 500 });
    expect(result.success).toBe(false);
  });

  it("never coerces amount to a float — high-precision decimal string survives verbatim", () => {
    const result = voucherSchema.safeParse({ ...voucher, amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = voucherSchema.safeParse({ ...voucher, amount: 10000.12 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum voucherType", () => {
    const result = voucherSchema.safeParse({ ...voucher, voucherType: "loan" });
    expect(result.success).toBe(false);
  });

  it("rejects a voucher missing branchId", () => {
    const { branchId, ...rest } = voucher;
    const result = voucherSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("branchId");
  });

  it("silently strips withholdingGlAccountId if present — the read shape does not carry it, unlike createVoucherSchema which accepts it", () => {
    const result = voucherSchema.safeParse({ ...voucher, withholdingGlAccountId: "acc-wht" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("withholdingGlAccountId");
  });
});

describe("createVoucherSchema", () => {
  const create = {
    date: "2026-08-30",
    voucherType: "supplier_payment" as const,
    amount: "10000.123456",
    branchId: "branch-1",
    paymentMethod: "bank" as const,
    treasuryAccountId: "acc-bank",
    treasuryGlAccountId: "acc-gl-bank",
  };

  it("accepts a minimal valid payload with all optional dimensions omitted", () => {
    const result = createVoucherSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("PRESERVES costCenterId, withholdingAmount, withholdingRatePercent and withholdingGlAccountId — none of these real dimensions is silently stripped on create", () => {
    const full = {
      ...create,
      costCenterId: "cc-1",
      withholdingAmount: "500.000000",
      withholdingRatePercent: 5,
      withholdingGlAccountId: "acc-wht",
    };
    const result = createVoucherSchema.safeParse(full);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.costCenterId).toBe("cc-1");
      expect(result.data.withholdingAmount).toBe("500.000000");
      expect(result.data.withholdingRatePercent).toBe(5);
      expect(result.data.withholdingGlAccountId).toBe("acc-wht");
    }
  });

  it("never coerces amount to a float — high-precision decimal string survives verbatim", () => {
    const result = createVoucherSchema.safeParse({ ...create, amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = createVoucherSchema.safeParse({ ...create, amount: 10000.12 });
    expect(result.success).toBe(false);
  });

  it("never coerces withholdingAmount to a float when supplied", () => {
    const result = createVoucherSchema.safeParse({ ...create, withholdingAmount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.withholdingAmount).toBe("0.100001");
  });

  it("rejects a withholdingRatePercent outside 0-100", () => {
    expect(createVoucherSchema.safeParse({ ...create, withholdingRatePercent: -1 }).success).toBe(false);
    expect(createVoucherSchema.safeParse({ ...create, withholdingRatePercent: 101 }).success).toBe(false);
  });

  it("rejects a payload missing treasuryAccountId", () => {
    const { treasuryAccountId, ...rest } = create;
    const result = createVoucherSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("treasuryAccountId");
  });

  it("rejects an out-of-enum paymentMethod", () => {
    const result = createVoucherSchema.safeParse({ ...create, paymentMethod: "crypto" });
    expect(result.success).toBe(false);
  });
});

describe("confirmVoucherSchema", () => {
  it("accepts an empty payload", () => {
    const result = confirmVoucherSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("reverseVoucherSchema", () => {
  it("accepts an empty payload — the server generates a reversalId when omitted", () => {
    const result = reverseVoucherSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("openInvoiceSchema", () => {
  const invoice = { id: "si-1", invoiceNo: "SI-2026-001", kind: "sales" as const, partyId: "cust-1", date: "2026-08-01", total: "1000.000000", allocated: "0", outstanding: "1000.000000" };

  it("accepts a minimal valid invoice and preserves every field verbatim", () => {
    const result = openInvoiceSchema.safeParse(invoice);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(invoice);
  });

  it("rejects an out-of-enum kind", () => {
    const result = openInvoiceSchema.safeParse({ ...invoice, kind: "return" });
    expect(result.success).toBe(false);
  });
});

describe("voucherAllocationSchema", () => {
  const allocation = { id: "va-1", voucherId: "v-1", invoiceId: "si-1", amount: "1000.000000", status: "active" as const, createdAt: "2026-08-30T10:00:00.000Z", reversedAt: null };

  it("accepts a minimal valid allocation and preserves every field verbatim", () => {
    const result = voucherAllocationSchema.safeParse(allocation);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(allocation);
  });

  it("rejects an out-of-enum status", () => {
    const result = voucherAllocationSchema.safeParse({ ...allocation, status: "voided" });
    expect(result.success).toBe(false);
  });
});

describe("createAllocationSchema", () => {
  it("accepts a minimal valid payload with allocationId omitted", () => {
    const result = createAllocationSchema.safeParse({ invoiceId: "si-1", amount: "1000.000000" });
    expect(result.success).toBe(true);
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = createAllocationSchema.safeParse({ invoiceId: "si-1", amount: 1000 });
    expect(result.success).toBe(false);
  });
});

describe("allocationSummarySchema", () => {
  const summary = { voucherAmount: "1000.000000", allocated: "600.000000", unallocated: "400.000000", fullyAllocated: false, needsAllocation: true };

  it("accepts a minimal valid summary and preserves every field verbatim", () => {
    const result = allocationSummarySchema.safeParse(summary);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(summary);
  });

  it("rejects a summary missing fullyAllocated", () => {
    const { fullyAllocated, ...rest } = summary;
    const result = allocationSummarySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("voucherListQuerySchema", () => {
  it("accepts an empty query — every field is optional", () => {
    const result = voucherListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a needsAllocation filter of receipt or payment", () => {
    expect(voucherListQuerySchema.safeParse({ needsAllocation: "receipt" }).success).toBe(true);
    expect(voucherListQuerySchema.safeParse({ needsAllocation: "payment" }).success).toBe(true);
  });

  it("rejects an out-of-enum needsAllocation value", () => {
    const result = voucherListQuerySchema.safeParse({ needsAllocation: "both" });
    expect(result.success).toBe(false);
  });
});
