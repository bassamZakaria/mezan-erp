import { describe, it, expect } from "vitest";
import {
  landedCostTypeSchema,
  landedCostDistributionMethodSchema,
  landedCostItemEntrySchema,
  landedCostTargetSchema,
  createLandedCostSchema,
  landedCostLineSchema,
  landedCostDocumentSchema,
} from "./landed-costs.js";

describe("landedCostTypeSchema", () => {
  it("accepts each known cost type", () => {
    for (const t of ["SHIPPING", "CUSTOMS", "INSURANCE", "CLEARANCE", "OTHER"]) {
      expect(landedCostTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("rejects a type outside the enum", () => {
    expect(landedCostTypeSchema.safeParse("HANDLING").success).toBe(false);
  });
});

describe("landedCostItemEntrySchema", () => {
  const entry = { costType: "SHIPPING" as const, description: "شحن بحري", amount: "5000.123456" };

  it("accepts a minimal valid entry and preserves every field verbatim", () => {
    const result = landedCostItemEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(entry);
  });

  it("never coerces amount to a float — high-precision decimal string survives verbatim", () => {
    const result = landedCostItemEntrySchema.safeParse({ ...entry, amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = landedCostItemEntrySchema.safeParse({ ...entry, amount: 5000.12 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative amount", () => {
    const result = landedCostItemEntrySchema.safeParse({ ...entry, amount: "-1" });
    expect(result.success).toBe(false);
  });
});

describe("landedCostTargetSchema", () => {
  const target = {
    itemId: "item-1",
    warehouseId: "wh-1",
    sourceInvoiceId: "pi-1",
    sourceInvoiceNumber: "PI-2026-001",
    qty: "100.000000",
    unitCost: "50.000000",
  };

  it("accepts a minimal valid target and defaults weight to 0", () => {
    const result = landedCostTargetSchema.safeParse(target);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.weight).toBe("0");
  });

  it("preserves an explicit weight", () => {
    const result = landedCostTargetSchema.safeParse({ ...target, weight: "120.500000" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.weight).toBe("120.500000");
  });

  it("rejects a negative qty", () => {
    const result = landedCostTargetSchema.safeParse({ ...target, qty: "-1" });
    expect(result.success).toBe(false);
  });
});

describe("createLandedCostSchema", () => {
  const create = {
    id: "lc-1",
    date: "2026-08-30",
    distributionMethod: "BY_VALUE" as const,
    costItems: [{ costType: "SHIPPING" as const, description: "شحن بحري", amount: "5000.000000" }],
    targets: [
      {
        itemId: "item-1",
        warehouseId: "wh-1",
        sourceInvoiceId: "pi-1",
        sourceInvoiceNumber: "PI-2026-001",
        qty: "100.000000",
        unitCost: "50.000000",
      },
    ],
  };

  it("accepts a minimal valid payload and defaults memo to empty string", () => {
    const result = createLandedCostSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.memo).toBe("");
  });

  it("rejects an empty costItems array — the client supplies the raw inputs, not the computed allocation", () => {
    const result = createLandedCostSchema.safeParse({ ...create, costItems: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("costItems");
  });

  it("rejects an empty targets array", () => {
    const result = createLandedCostSchema.safeParse({ ...create, targets: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum distributionMethod", () => {
    const result = createLandedCostSchema.safeParse({ ...create, distributionMethod: "BY_VOLUME" });
    expect(result.success).toBe(false);
  });

  it("silently strips a caller-supplied allocatedAmount on a target — the API computes it server-side", () => {
    const result = createLandedCostSchema.safeParse({
      ...create,
      targets: [{ ...create.targets[0], allocatedAmount: "999999" }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.targets[0]).not.toHaveProperty("allocatedAmount");
  });
});

describe("landedCostLineSchema", () => {
  const line = {
    itemId: "item-1",
    warehouseId: "wh-1",
    sourceInvoiceId: "pi-1",
    sourceInvoiceNumber: "PI-2026-001",
    qty: "100.000000",
    unitCost: "50.000000",
    weight: "0",
    allocatedAmount: "500.000000",
    newUnitCost: "55.000000",
    distributionMethod: "BY_VALUE" as const,
    costItems: [],
  };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = landedCostLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("never coerces newUnitCost to a float — high-precision decimal string survives verbatim", () => {
    const result = landedCostLineSchema.safeParse({ ...line, newUnitCost: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.newUnitCost).toBe("0.100001");
  });
});

describe("landedCostDocumentSchema", () => {
  const document = {
    id: "lc-1",
    docType: "LANDED_COST" as const,
    docNo: "LC-2026-001",
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
    const result = landedCostDocumentSchema.safeParse(document);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(document);
  });

  it("rejects a docType other than the literal LANDED_COST", () => {
    const result = landedCostDocumentSchema.safeParse({ ...document, docType: "PURCHASE_INVOICE" });
    expect(result.success).toBe(false);
  });
});
