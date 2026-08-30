import { describe, it, expect } from "vitest";
import {
  salesReturnReasonSchema,
  salesReturnLineSchema,
  createSalesReturnSchema,
  salesReturnRequestedQtySchema,
  buildSalesReturnFromInvoiceSchema,
  salesReturnDocumentSchema,
  refundSalesReturnSchema,
} from "./sales-returns.js";

describe("salesReturnReasonSchema", () => {
  it("accepts each known reason", () => {
    for (const r of ["DEFECTIVE", "WRONG_ITEM", "EXCESS_QTY", "CHANGED_MIND", "OTHER"]) {
      expect(salesReturnReasonSchema.safeParse(r).success).toBe(true);
    }
  });

  it("rejects a reason outside the enum", () => {
    expect(salesReturnReasonSchema.safeParse("EXPIRED").success).toBe(false);
  });
});

describe("salesReturnLineSchema", () => {
  const line = {
    itemId: "item-1",
    warehouseId: "wh-1",
    customerId: "cust-1",
    sourceInvoiceId: "si-1",
    sourceInvoiceNumber: "SI-2026-001",
    reason: "DEFECTIVE" as const,
    availableQty: "10.000000",
    qty: "2.000000",
    unitPrice: "199.990000",
    unitCost: "99.990000",
    taxAmount: "27.990000",
  };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = salesReturnLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("never coerces unitPrice to a float — high-precision decimal string survives verbatim", () => {
    const result = salesReturnLineSchema.safeParse({ ...line, unitPrice: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unitPrice).toBe("0.100001");
  });

  it("rejects unitPrice sent as a JS number instead of a string", () => {
    const result = salesReturnLineSchema.safeParse({ ...line, unitPrice: 199.99 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative qty", () => {
    const result = salesReturnLineSchema.safeParse({ ...line, qty: "-1" });
    expect(result.success).toBe(false);
  });
});

describe("createSalesReturnSchema", () => {
  const create = {
    id: "sr-1",
    date: "2026-08-30",
    lines: [
      {
        itemId: "item-1",
        warehouseId: "wh-1",
        customerId: "cust-1",
        sourceInvoiceId: "si-1",
        sourceInvoiceNumber: "SI-2026-001",
        reason: "DEFECTIVE" as const,
        availableQty: "10.000000",
        qty: "2.000000",
        unitPrice: "199.990000",
        unitCost: "99.990000",
        taxAmount: "27.990000",
      },
    ],
  };

  it("accepts a minimal valid payload and defaults memo to empty string", () => {
    const result = createSalesReturnSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.memo).toBe("");
  });

  it("rejects an empty lines array", () => {
    const result = createSalesReturnSchema.safeParse({ ...create, lines: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("lines");
  });
});

describe("salesReturnRequestedQtySchema", () => {
  it("accepts a minimal valid payload with the optional per-line reason omitted", () => {
    const result = salesReturnRequestedQtySchema.safeParse({ itemId: "item-1", qty: "2.000000" });
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum per-line reason", () => {
    const result = salesReturnRequestedQtySchema.safeParse({ itemId: "item-1", qty: "2.000000", reason: "EXPIRED" });
    expect(result.success).toBe(false);
  });
});

describe("buildSalesReturnFromInvoiceSchema", () => {
  const build = {
    id: "sr-1",
    date: "2026-08-30",
    sourceInvoiceId: "si-1",
    warehouseId: "wh-1",
    reason: "DEFECTIVE" as const,
    requested: [{ itemId: "item-1", qty: "2.000000" }],
  };

  it("accepts a minimal valid payload and defaults memo", () => {
    const result = buildSalesReturnFromInvoiceSchema.safeParse(build);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.memo).toBe("");
  });

  it("rejects an empty requested array", () => {
    const result = buildSalesReturnFromInvoiceSchema.safeParse({ ...build, requested: [] });
    expect(result.success).toBe(false);
  });
});

describe("salesReturnDocumentSchema", () => {
  const document = {
    id: "sr-1",
    docType: "SALES_RETURN" as const,
    docNo: "SR-2026-001",
    date: "2026-08-30",
    memo: "",
    status: "posted" as const,
    lines: [],
    createdAt: "2026-08-30T10:00:00.000Z",
    confirmedAt: "2026-08-30T10:05:00.000Z",
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: "je-1",
    awaitingRefund: true,
    refundDue: "227.990000",
    refundedTotal: "0",
    refunds: [],
  };

  it("accepts a minimal valid document and preserves every field verbatim", () => {
    const result = salesReturnDocumentSchema.safeParse(document);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(document);
  });

  it("rejects a docType other than the literal SALES_RETURN", () => {
    const result = salesReturnDocumentSchema.safeParse({ ...document, docType: "PURCHASE_RETURN" });
    expect(result.success).toBe(false);
  });

  it("accepts a fully-refunded document with entries in refunds", () => {
    const result = salesReturnDocumentSchema.safeParse({
      ...document,
      awaitingRefund: false,
      refundedTotal: "227.990000",
      refunds: [{ voucherId: "v-1", voucherNo: "PV-2026-001", date: "2026-08-31", amount: "227.990000" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("refundSalesReturnSchema", () => {
  const refund = { amount: "227.990000", treasuryAccountId: "acc-cash" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = refundSalesReturnSchema.safeParse(refund);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(refund);
  });

  it("never coerces amount to a float — high-precision decimal string survives verbatim", () => {
    const result = refundSalesReturnSchema.safeParse({ ...refund, amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = refundSalesReturnSchema.safeParse({ ...refund, amount: 227.99 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative amount", () => {
    const result = refundSalesReturnSchema.safeParse({ ...refund, amount: "-1" });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum paymentMethod when supplied", () => {
    const result = refundSalesReturnSchema.safeParse({ ...refund, paymentMethod: "crypto" });
    expect(result.success).toBe(false);
  });
});
