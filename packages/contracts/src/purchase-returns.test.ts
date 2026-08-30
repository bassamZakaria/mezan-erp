import { describe, it, expect } from "vitest";
import {
  purchaseReturnReasonSchema,
  purchaseReturnLineSchema,
  createPurchaseReturnSchema,
  purchaseReturnRequestedQtySchema,
  buildPurchaseReturnFromInvoiceSchema,
  purchaseReturnDocumentSchema,
} from "./purchase-returns.js";

describe("purchaseReturnReasonSchema", () => {
  it("accepts each known reason", () => {
    for (const r of ["DEFECTIVE", "WRONG_ITEM", "EXCESS_QTY", "QUALITY_ISSUE", "OTHER"]) {
      expect(purchaseReturnReasonSchema.safeParse(r).success).toBe(true);
    }
  });

  it("rejects a reason outside the enum", () => {
    expect(purchaseReturnReasonSchema.safeParse("EXPIRED").success).toBe(false);
  });
});

describe("purchaseReturnLineSchema", () => {
  const line = {
    itemId: "item-1",
    warehouseId: "wh-1",
    supplierId: "sup-1",
    sourceInvoiceId: "pi-1",
    sourceInvoiceNumber: "PI-2026-001",
    reason: "DEFECTIVE" as const,
    availableQty: "10.000000",
    qty: "2.000000",
    unitCost: "50.000000",
    taxAmount: "14.000000",
  };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = purchaseReturnLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("never coerces unitCost to a float — high-precision decimal string survives verbatim", () => {
    const result = purchaseReturnLineSchema.safeParse({ ...line, unitCost: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unitCost).toBe("0.100001");
  });

  it("rejects unitCost sent as a JS number instead of a string", () => {
    const result = purchaseReturnLineSchema.safeParse({ ...line, unitCost: 50 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative qty", () => {
    const result = purchaseReturnLineSchema.safeParse({ ...line, qty: "-1" });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum reason", () => {
    const result = purchaseReturnLineSchema.safeParse({ ...line, reason: "EXPIRED" });
    expect(result.success).toBe(false);
  });

  it("allows qty to exceed availableQty — that invariant is enforced by the domain, not this wire schema", () => {
    const result = purchaseReturnLineSchema.safeParse({ ...line, availableQty: "1.000000", qty: "5.000000" });
    expect(result.success).toBe(true);
  });
});

describe("createPurchaseReturnSchema", () => {
  const create = {
    id: "pr-1",
    date: "2026-08-30",
    lines: [
      {
        itemId: "item-1",
        warehouseId: "wh-1",
        supplierId: "sup-1",
        sourceInvoiceId: "pi-1",
        sourceInvoiceNumber: "PI-2026-001",
        reason: "DEFECTIVE" as const,
        availableQty: "10.000000",
        qty: "2.000000",
        unitCost: "50.000000",
        taxAmount: "14.000000",
      },
    ],
  };

  it("accepts a minimal valid payload and defaults memo to empty string", () => {
    const result = createPurchaseReturnSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.memo).toBe("");
  });

  it("rejects an empty lines array", () => {
    const result = createPurchaseReturnSchema.safeParse({ ...create, lines: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("lines");
  });
});

describe("purchaseReturnRequestedQtySchema", () => {
  it("accepts a minimal valid payload and preserves it verbatim", () => {
    const payload = { itemId: "item-1", qty: "5.000000" };
    const result = purchaseReturnRequestedQtySchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(payload);
  });

  it("rejects a negative qty", () => {
    const result = purchaseReturnRequestedQtySchema.safeParse({ itemId: "item-1", qty: "-1" });
    expect(result.success).toBe(false);
  });
});

describe("buildPurchaseReturnFromInvoiceSchema", () => {
  const build = {
    id: "pr-1",
    date: "2026-08-30",
    sourceInvoiceId: "pi-1",
    warehouseId: "wh-1",
    reason: "DEFECTIVE" as const,
    requested: [{ itemId: "item-1", qty: "2.000000" }],
  };

  it("accepts a minimal valid payload and defaults memo", () => {
    const result = buildPurchaseReturnFromInvoiceSchema.safeParse(build);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.memo).toBe("");
  });

  it("rejects an empty requested array", () => {
    const result = buildPurchaseReturnFromInvoiceSchema.safeParse({ ...build, requested: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing sourceInvoiceId", () => {
    const { sourceInvoiceId, ...rest } = build;
    const result = buildPurchaseReturnFromInvoiceSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("sourceInvoiceId");
  });
});

describe("purchaseReturnDocumentSchema", () => {
  const document = {
    id: "pr-1",
    docType: "PURCHASE_RETURN" as const,
    docNo: "PR-2026-001",
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
  };

  it("accepts a minimal valid document and preserves every field verbatim", () => {
    const result = purchaseReturnDocumentSchema.safeParse(document);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(document);
  });

  it("rejects a docType other than the literal PURCHASE_RETURN", () => {
    const result = purchaseReturnDocumentSchema.safeParse({ ...document, docType: "SALES_RETURN" });
    expect(result.success).toBe(false);
  });
});
