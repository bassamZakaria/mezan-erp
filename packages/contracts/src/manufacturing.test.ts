import { describe, it, expect } from "vitest";
import {
  activationStatusSchema,
  workOrderStatusSchema,
  workOrderStageSchema,
  workOrderPrioritySchema,
  configInstanceStatusSchema,
  pricingMethodSchema,
  itemPolicySchema,
  createBomLineSchema,
  createBomSchema,
  createBomVersionSchema,
  bomLineSchema,
  bomSchema,
  createWorkOrderSchema,
  shopFloorAttributionSchema,
  workOrderLineActionSchema,
  receiveProductSchema,
  issueMaterialsSchema,
  workStationSchema,
  createWorkStationSchema,
  workOrderShopFloorEntrySchema,
  logCostSchema,
  logWasteSchema,
  configInputSchema,
  materialFormulaSchema,
  upsertConfigurableProductSchema,
  createConfigInstanceSchema,
  previewConfigInstanceSchema,
} from "./manufacturing.js";

describe("workOrderStatusSchema", () => {
  it("accepts each known status", () => {
    for (const s of ["planned", "in_progress", "completed", "cancelled"]) {
      expect(workOrderStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(workOrderStatusSchema.safeParse("draft").success).toBe(false);
  });
});

describe("workOrderStageSchema", () => {
  it("accepts each of the five known stages", () => {
    for (const s of ["not_started", "started", "materials_issued", "product_received", "completed"]) {
      expect(workOrderStageSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a stage outside the enum", () => {
    expect(workOrderStageSchema.safeParse("paused").success).toBe(false);
  });
});

describe("activationStatusSchema", () => {
  it("accepts active and inactive", () => {
    expect(activationStatusSchema.safeParse("active").success).toBe(true);
    expect(activationStatusSchema.safeParse("inactive").success).toBe(true);
  });

  it("rejects a status outside the enum", () => {
    expect(activationStatusSchema.safeParse("archived").success).toBe(false);
  });
});

describe("workOrderPrioritySchema", () => {
  it("accepts low, normal and high", () => {
    for (const p of ["low", "normal", "high"]) {
      expect(workOrderPrioritySchema.safeParse(p).success).toBe(true);
    }
  });

  it("rejects a priority outside the enum", () => {
    expect(workOrderPrioritySchema.safeParse("urgent").success).toBe(false);
  });
});

describe("configInstanceStatusSchema", () => {
  it("accepts each of the five known statuses", () => {
    for (const s of ["configured", "in_progress", "produced", "closed", "cancelled"]) {
      expect(configInstanceStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(configInstanceStatusSchema.safeParse("draft").success).toBe(false);
  });
});

describe("pricingMethodSchema", () => {
  it("accepts manual and formula", () => {
    expect(pricingMethodSchema.safeParse("manual").success).toBe(true);
    expect(pricingMethodSchema.safeParse("formula").success).toBe(true);
  });
});

describe("itemPolicySchema", () => {
  it("accepts per_order and per_spec", () => {
    expect(itemPolicySchema.safeParse("per_order").success).toBe(true);
    expect(itemPolicySchema.safeParse("per_spec").success).toBe(true);
  });
});

describe("bomLineSchema", () => {
  const line = { itemId: "item-raw-1", qty: "2.000000", wastePercent: 5, optional: false, notes: null };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = bomLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("rejects a line missing wastePercent — unlike createBomLineSchema, this read shape requires it", () => {
    const { wastePercent, ...rest } = line;
    const result = bomLineSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("createBomLineSchema", () => {
  it("accepts a minimal valid line with optionals omitted", () => {
    const result = createBomLineSchema.safeParse({ itemId: "item-1", qty: "5.000000" });
    expect(result.success).toBe(true);
  });

  it("rejects a negative qty", () => {
    const result = createBomLineSchema.safeParse({ itemId: "item-1", qty: "-1" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative wastePercent", () => {
    const result = createBomLineSchema.safeParse({ itemId: "item-1", qty: "5.000000", wastePercent: -1 });
    expect(result.success).toBe(false);
  });
});

describe("createBomSchema", () => {
  const create = {
    id: "bom-1",
    productItemId: "item-fg-1",
    standardQty: "1.000000",
    unit: "PCS",
    lines: [{ itemId: "item-raw-1", qty: "2.000000" }],
  };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createBomSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects an empty lines array", () => {
    const result = createBomSchema.safeParse({ ...create, lines: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("lines");
  });

  it("never coerces laborCost to a float when supplied", () => {
    const result = createBomSchema.safeParse({ ...create, laborCost: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.laborCost).toBe("0.100001");
  });
});

describe("createBomVersionSchema", () => {
  it("accepts a minimal valid payload with everything but the source omitted", () => {
    const result = createBomVersionSchema.safeParse({ id: "bomv-1", sourceBomId: "bom-1" });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing sourceBomId", () => {
    const result = createBomVersionSchema.safeParse({ id: "bomv-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("sourceBomId");
  });
});

describe("bomSchema", () => {
  const bom = {
    id: "bom-1",
    number: "BOM-2026-001",
    productItemId: "item-fg-1",
    version: 1,
    standardQty: "1.000000",
    unit: "PCS",
    laborCost: "50.000000",
    overheadCost: "20.000000",
    versionNotes: null,
    lines: [{ itemId: "item-raw-1", qty: "2.000000", wastePercent: 5, optional: false, notes: null }],
    status: "active" as const,
    custom: false,
    createdBy: "user-1",
    createdAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid bom and preserves every field verbatim", () => {
    const result = bomSchema.safeParse(bom);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(bom);
  });

  it("rejects a bom missing version", () => {
    const { version, ...rest } = bom;
    const result = bomSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("version");
  });
});

describe("createWorkOrderSchema", () => {
  const create = {
    id: "wo-1",
    bomId: "bom-1",
    plannedQty: "10.000000",
    sourceWarehouseId: "wh-source",
    wipWarehouseId: "wh-wip",
    destinationWarehouseId: "wh-fg",
    scheduledStartDate: "2026-08-30",
  };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createWorkOrderSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing wipWarehouseId — without it issued material has nowhere to sit", () => {
    const { wipWarehouseId, ...rest } = create;
    const result = createWorkOrderSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("wipWarehouseId");
  });

  it("rejects an out-of-enum priority when supplied", () => {
    const result = createWorkOrderSchema.safeParse({ ...create, priority: "urgent" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative plannedQty", () => {
    const result = createWorkOrderSchema.safeParse({ ...create, plannedQty: "-1" });
    expect(result.success).toBe(false);
  });
});

describe("shopFloorAttributionSchema", () => {
  it("accepts an empty payload — both station and operator are optional", () => {
    const result = shopFloorAttributionSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts explicit station and operator ids", () => {
    const result = shopFloorAttributionSchema.safeParse({ stationId: "station-1", operatorId: "emp-1" });
    expect(result.success).toBe(true);
  });
});

describe("workOrderLineActionSchema", () => {
  it("accepts a minimal valid payload extending the shop-floor attribution", () => {
    const result = workOrderLineActionSchema.safeParse({ lines: [{ itemId: "item-1", qty: "2.000000" }] });
    expect(result.success).toBe(true);
  });

  it("rejects an empty lines array", () => {
    const result = workOrderLineActionSchema.safeParse({ lines: [] });
    expect(result.success).toBe(false);
  });

  it("preserves stationId/operatorId alongside the lines", () => {
    const payload = { stationId: "station-1", operatorId: "emp-1", lines: [{ itemId: "item-1", qty: "2.000000" }] };
    const result = workOrderLineActionSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(payload);
  });
});

describe("receiveProductSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = receiveProductSchema.safeParse({ producedQty: "8.000000" });
    expect(result.success).toBe(true);
  });

  it("rejects a negative producedQty", () => {
    const result = receiveProductSchema.safeParse({ producedQty: "-1" });
    expect(result.success).toBe(false);
  });
});

describe("issueMaterialsSchema", () => {
  it("accepts an empty payload — same shape as shopFloorAttributionSchema", () => {
    const result = issueMaterialsSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("workStationSchema", () => {
  const station = { id: "station-1", code: "ST-01", nameAr: "محطة القص", nameEn: null, notes: null, status: "active" as const, createdAt: "2026-08-30T10:00:00.000Z" };

  it("accepts a minimal valid station and preserves every field verbatim", () => {
    const result = workStationSchema.safeParse(station);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(station);
  });
});

describe("createWorkStationSchema", () => {
  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createWorkStationSchema.safeParse({ id: "station-1", code: "ST-01", nameAr: "محطة القص" });
    expect(result.success).toBe(true);
  });
});

describe("workOrderShopFloorEntrySchema", () => {
  const entry = { kind: "issue" as const, stationId: "station-1", operatorId: "emp-1", ref: "issue-1", at: "2026-08-30T10:00:00.000Z" };

  it("accepts a minimal valid entry and preserves every field verbatim", () => {
    const result = workOrderShopFloorEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(entry);
  });

  it("rejects an out-of-enum kind", () => {
    const result = workOrderShopFloorEntrySchema.safeParse({ ...entry, kind: "transfer" });
    expect(result.success).toBe(false);
  });
});

describe("logCostSchema", () => {
  it("accepts a minimal valid payload and never coerces amount to a float", () => {
    const result = logCostSchema.safeParse({ kind: "labor", amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects an out-of-enum kind", () => {
    const result = logCostSchema.safeParse({ kind: "materials", amount: "50.000000" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative amount", () => {
    const result = logCostSchema.safeParse({ kind: "labor", amount: "-1" });
    expect(result.success).toBe(false);
  });
});

describe("logWasteSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = logWasteSchema.safeParse({ lines: [{ itemId: "item-1", qty: "1.000000" }] });
    expect(result.success).toBe(true);
  });

  it("rejects an empty lines array", () => {
    const result = logWasteSchema.safeParse({ lines: [] });
    expect(result.success).toBe(false);
  });
});

describe("configInputSchema", () => {
  it("accepts a minimal valid input with optionals omitted", () => {
    const result = configInputSchema.safeParse({ id: "width", labelAr: "العرض" });
    expect(result.success).toBe(true);
  });

  it("rejects a type other than the literal number", () => {
    const result = configInputSchema.safeParse({ id: "width", labelAr: "العرض", type: "text" });
    expect(result.success).toBe(false);
  });
});

describe("materialFormulaSchema", () => {
  it("accepts a minimal valid formula", () => {
    const result = materialFormulaSchema.safeParse({ itemId: "item-1", qtyFormula: "width * height" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty qtyFormula", () => {
    const result = materialFormulaSchema.safeParse({ itemId: "item-1", qtyFormula: "" });
    expect(result.success).toBe(false);
  });
});

describe("upsertConfigurableProductSchema", () => {
  const upsert = {
    id: "cp-1",
    code: "CUSTOM-DESK",
    nameAr: "مكتب مخصص",
    outputItemId: "item-desk",
    unit: "PCS",
    inputs: [{ id: "width", labelAr: "العرض" }],
    materials: [{ itemId: "item-wood", qtyFormula: "width * 0.01" }],
  };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = upsertConfigurableProductSchema.safeParse(upsert);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(upsert);
  });

  it("rejects an empty inputs array", () => {
    const result = upsertConfigurableProductSchema.safeParse({ ...upsert, inputs: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("inputs");
  });

  it("rejects an empty materials array", () => {
    const result = upsertConfigurableProductSchema.safeParse({ ...upsert, materials: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum pricingMethod", () => {
    const result = upsertConfigurableProductSchema.safeParse({ ...upsert, pricingMethod: "auction" });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum itemPolicy", () => {
    const result = upsertConfigurableProductSchema.safeParse({ ...upsert, itemPolicy: "per_batch" });
    expect(result.success).toBe(false);
  });
});

describe("createConfigInstanceSchema", () => {
  const create = {
    id: "ci-1",
    configurableProductId: "cp-1",
    spec: { width: "120", height: "80" },
    qty: "1.000000",
    sourceWarehouseId: "wh-source",
    wipWarehouseId: "wh-wip",
    destinationWarehouseId: "wh-fg",
    scheduledStartDate: "2026-08-30",
  };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createConfigInstanceSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing spec", () => {
    const { spec, ...rest } = create;
    const result = createConfigInstanceSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("spec");
  });

  it("never coerces sellUnitPrice to a float when supplied", () => {
    const result = createConfigInstanceSchema.safeParse({ ...create, sellUnitPrice: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sellUnitPrice).toBe("0.100001");
  });
});

describe("previewConfigInstanceSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = previewConfigInstanceSchema.safeParse({ configurableProductId: "cp-1", spec: { width: "120" } });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing configurableProductId", () => {
    const result = previewConfigInstanceSchema.safeParse({ spec: {} });
    expect(result.success).toBe(false);
  });
});
