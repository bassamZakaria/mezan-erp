import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { Money, Qty } from "@mezan/domain";
import { createSqliteManufacturingStores } from "./manufacturing-stores.js";

function makeStores() {
  return createSqliteManufacturingStores();
}

describe("SqliteBomStore", () => {
  it("round-trips Money/Qty at scale 1e-6 through the JSON lines column", async () => {
    const stores = makeStores();
    try {
      await stores.boms.create({
        id: "bom-1",
        number: "BOM-0001",
        productItemId: "itm-1",
        version: 1,
        standardQty: Qty.fromMajor("10.123456"),
        unit: "PCS",
        laborCost: Money.fromMajor("12.500001"),
        overheadCost: Money.fromMajor("3.000002"),
        versionNotes: null,
        lines: [
          { itemId: "itm-2", qty: Qty.fromMajor("2.333333"), wastePercent: 5, optional: false, notes: null },
        ],
        status: "active",
        custom: false,
        createdBy: "user-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const loaded = await stores.boms.findById("bom-1");
      expect(loaded?.standardQty.toString()).toBe("10.123456");
      expect(loaded?.laborCost.toString()).toBe("12.500001");
      expect(loaded?.overheadCost.toString()).toBe("3.000002");
      expect(loaded!.lines[0]!.qty.toString()).toBe("2.333333");
      expect(loaded!.lines[0]!.qty.scaled).toBe(2333333n);
    } finally {
      stores.close();
    }
  });

  it("round-trips versionNotes and line notes as null, not empty string", async () => {
    const stores = makeStores();
    try {
      await stores.boms.create({
        id: "bom-1",
        number: "BOM-0001",
        productItemId: "itm-1",
        version: 1,
        standardQty: Qty.fromMajor("1"),
        unit: "PCS",
        laborCost: Money.zero(),
        overheadCost: Money.zero(),
        versionNotes: null,
        lines: [{ itemId: "itm-2", qty: Qty.fromMajor("1"), wastePercent: 0, optional: true, notes: null }],
        status: "active",
        custom: false,
        createdBy: "user-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const loaded = await stores.boms.findById("bom-1");
      expect(loaded?.versionNotes).toBeNull();
      expect(loaded!.lines[0]!.notes).toBeNull();
    } finally {
      stores.close();
    }
  });

  it("enforces uniqueness of the BOM number", async () => {
    const stores = makeStores();
    try {
      const bom = {
        id: "bom-1",
        number: "BOM-0001",
        productItemId: "itm-1",
        version: 1,
        standardQty: Qty.fromMajor("1"),
        unit: "PCS",
        laborCost: Money.zero(),
        overheadCost: Money.zero(),
        versionNotes: null,
        lines: [],
        status: "active" as const,
        custom: false,
        createdBy: "user-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      await stores.boms.create(bom);
      await expect(stores.boms.create({ ...bom, id: "bom-2" })).rejects.toThrow();
      const all = await stores.boms.list();
      expect(all).toHaveLength(1);
    } finally {
      stores.close();
    }
  });

  it("listByProduct filters by product and returns empty for a product with no BOM", async () => {
    const stores = makeStores();
    try {
      const base = {
        version: 1,
        standardQty: Qty.fromMajor("1"),
        unit: "PCS",
        laborCost: Money.zero(),
        overheadCost: Money.zero(),
        versionNotes: null,
        lines: [],
        status: "active" as const,
        custom: false,
        createdBy: "user-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      await stores.boms.create({ ...base, id: "bom-1", number: "BOM-0001", productItemId: "itm-A" });
      await stores.boms.create({ ...base, id: "bom-2", number: "BOM-0002", productItemId: "itm-B" });
      const forA = await stores.boms.listByProduct("itm-A");
      expect(forA.map((b) => b.id)).toEqual(["bom-1"]);
      const forNone = await stores.boms.listByProduct("itm-does-not-exist");
      expect(forNone).toEqual([]);
    } finally {
      stores.close();
    }
  });

  it("update() upserts fields on an existing BOM without changing its id", async () => {
    const stores = makeStores();
    try {
      const base = {
        id: "bom-1",
        number: "BOM-0001",
        productItemId: "itm-1",
        version: 1,
        standardQty: Qty.fromMajor("1"),
        unit: "PCS",
        laborCost: Money.fromMajor("1.00"),
        overheadCost: Money.zero(),
        versionNotes: null,
        lines: [],
        status: "inactive" as const,
        custom: false,
        createdBy: "user-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      await stores.boms.create(base);
      await stores.boms.update({
        ...base,
        status: "active",
        laborCost: Money.fromMajor("2.50"),
        number: "BOM-CHANGED",
      });
      const loaded = await stores.boms.findById("bom-1");
      expect(loaded?.status).toBe("active");
      expect(loaded?.laborCost.toString()).toBe("2.500000");
      expect((await stores.boms.list())).toHaveLength(1);
      // number is not in the UPDATE SET clause — a BOM's number is fixed at creation.
      expect(loaded?.number).toBe("BOM-0001");
    } finally {
      stores.close();
    }
  });
});

describe("SqliteWorkOrderStore", () => {
  function baseOrder() {
    return {
      id: "wo-1",
      number: "WO-0001",
      bomId: "bom-1",
      bomVersion: 1,
      productItemId: "itm-1",
      plannedQty: Qty.fromMajor("100.000000"),
      producedQty: Qty.fromMajor("0.000000"),
      sourceWarehouseId: "wh-1",
      wipWarehouseId: "wh-wip",
      destinationWarehouseId: "wh-2",
      priority: "normal" as const,
      scheduledStartDate: "2026-01-01",
      scheduledEndDate: null,
      notes: null,
      status: "planned" as const,
      stage: "not_started" as const,
      materials: [
        {
          itemId: "itm-2",
          requiredQty: Qty.fromMajor("50.500001"),
          wastePercent: 2,
          optional: false,
          issuedQty: Qty.zero(),
          returnedQty: Qty.zero(),
          issuedUnitCost: Money.fromMajor("4.750003"),
        },
      ],
      materialCost: Money.zero(),
      laborCost: Money.zero(),
      overheadCost: Money.zero(),
      extraCost: Money.zero(),
      costLog: [],
      wasteLog: [],
      shopFloorLog: [],
      configInstanceId: null,
      glPosted: false,
      createdBy: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: null,
      issuedAt: null,
      receivedAt: null,
      completedAt: null,
      projectId: null,
    };
  }

  it("round-trips material Qty/Money at scale 1e-6 and preserves wipWarehouseId", async () => {
    const stores = makeStores();
    try {
      await stores.workOrders.create(baseOrder());
      const loaded = await stores.workOrders.findById("wo-1");
      expect(loaded!.materials[0]!.requiredQty.toString()).toBe("50.500001");
      expect(loaded!.materials[0]!.issuedUnitCost.toString()).toBe("4.750003");
      expect(loaded?.wipWarehouseId).toBe("wh-wip");
    } finally {
      stores.close();
    }
  });

  it("round-trips nullable timestamps and scheduledEndDate as null", async () => {
    const stores = makeStores();
    try {
      await stores.workOrders.create(baseOrder());
      const loaded = await stores.workOrders.findById("wo-1");
      expect(loaded?.scheduledEndDate).toBeNull();
      expect(loaded?.startedAt).toBeNull();
      expect(loaded?.issuedAt).toBeNull();
      expect(loaded?.receivedAt).toBeNull();
      expect(loaded?.completedAt).toBeNull();
      expect(loaded?.configInstanceId).toBeNull();
    } finally {
      stores.close();
    }
  });

  it("round-trips a waste-log entry with normal/abnormal split at scale 1e-6", async () => {
    const stores = makeStores();
    try {
      await stores.workOrders.create({
        ...baseOrder(),
        wasteLog: [
          {
            itemId: "itm-2",
            qty: Qty.fromMajor("3.000000"),
            notes: "قصاصات",
            at: "2026-01-02T00:00:00.000Z",
            stockMoved: true,
            normalQty: Qty.fromMajor("2.000000"),
            abnormalQty: Qty.fromMajor("1.000000"),
            normalCost: Money.fromMajor("10.000000"),
            abnormalCost: Money.fromMajor("5.000000"),
          },
        ],
      });
      const loaded = await stores.workOrders.findById("wo-1");
      expect(loaded?.wasteLog).toHaveLength(1);
      const w = loaded!.wasteLog[0]!;
      expect(w.notes).toBe("قصاصات");
      expect(w.stockMoved).toBe(true);
      expect(w.normalQty.toString()).toBe("2.000000");
      expect(w.abnormalQty.toString()).toBe("1.000000");
      expect(w.normalCost.toString()).toBe("10.000000");
      expect(w.abnormalCost.toString()).toBe("5.000000");
    } finally {
      stores.close();
    }
  });

  it("defaults a legacy waste-log entry (no split fields, written before D64) to stockMoved=false and zero split", async () => {
    const raw = new Database(":memory:");
    const stores = createSqliteManufacturingStores(raw);
    try {
      await stores.workOrders.create(baseOrder());
      // A pre-D64 row's waste_log JSON carries only itemId/qty/notes/at — write
      // that legacy shape directly, bypassing the store's write() (which always
      // emits the full modern shape), to prove the READ side still defaults it.
      raw
        .prepare(`UPDATE work_order SET waste_log = ? WHERE id = 'wo-1'`)
        .run(JSON.stringify([{ itemId: "itm-2", qty: "1.000000", notes: null, at: "2026-01-02T00:00:00.000Z" }]));
      const loaded = await stores.workOrders.findById("wo-1");
      const w = loaded!.wasteLog[0]!;
      expect(w.stockMoved).toBe(false);
      expect(w.normalQty.isZero()).toBe(true);
      expect(w.abnormalQty.isZero()).toBe(true);
      expect(w.normalCost.equals(Money.zero())).toBe(true);
      expect(w.abnormalCost.equals(Money.zero())).toBe(true);
    } finally {
      raw.close();
    }
  });

  it("backfills wip_warehouse_id/shop_floor_log for a legacy table and maps wipWarehouseId to empty string, not the source warehouse", async () => {
    const raw = new Database(":memory:");
    try {
      raw.exec(`
        CREATE TABLE work_order (
          id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, bom_id TEXT NOT NULL,
          bom_version INTEGER NOT NULL, product_item_id TEXT NOT NULL,
          planned_qty TEXT NOT NULL, produced_qty TEXT NOT NULL,
          source_warehouse_id TEXT NOT NULL, destination_warehouse_id TEXT NOT NULL,
          priority TEXT NOT NULL, scheduled_start_date TEXT NOT NULL,
          scheduled_end_date TEXT, notes TEXT, status TEXT NOT NULL, stage TEXT NOT NULL,
          materials TEXT NOT NULL, material_cost TEXT NOT NULL, labor_cost TEXT NOT NULL,
          overhead_cost TEXT NOT NULL, extra_cost TEXT NOT NULL, cost_log TEXT NOT NULL,
          waste_log TEXT NOT NULL, config_instance_id TEXT, gl_posted INTEGER NOT NULL,
          created_by TEXT NOT NULL, created_at TEXT NOT NULL,
          started_at TEXT, issued_at TEXT, received_at TEXT, completed_at TEXT
        );
      `);
      raw
        .prepare(
          `INSERT INTO work_order (id, number, bom_id, bom_version, product_item_id, planned_qty, produced_qty, source_warehouse_id, destination_warehouse_id, priority, scheduled_start_date, status, stage, materials, material_cost, labor_cost, overhead_cost, extra_cost, cost_log, waste_log, gl_posted, created_by, created_at)
           VALUES ('wo-legacy', 'WO-LEGACY', 'bom-1', 1, 'itm-1', '1.000000', '0.000000', 'wh-1', 'wh-2', 'normal', '2025-01-01', 'planned', 'planning', '[]', '0.000000', '0.000000', '0.000000', '0.000000', '[]', '[]', 0, 'user-1', '2025-01-01T00:00:00.000Z')`,
        )
        .run();
      const stores = createSqliteManufacturingStores(raw);
      const loaded = await stores.workOrders.findById("wo-legacy");
      expect(loaded?.wipWarehouseId).toBe("");
      expect(loaded?.sourceWarehouseId).toBe("wh-1");
      expect(loaded?.shopFloorLog).toEqual([]);
    } finally {
      raw.close();
    }
  });

  it("enforces uniqueness of the work order number", async () => {
    const stores = makeStores();
    try {
      await stores.workOrders.create(baseOrder());
      await expect(stores.workOrders.create({ ...baseOrder(), id: "wo-2" })).rejects.toThrow();
    } finally {
      stores.close();
    }
  });

  it("list() returns every work order", async () => {
    const stores = makeStores();
    try {
      await stores.workOrders.create(baseOrder());
      await stores.workOrders.create({ ...baseOrder(), id: "wo-2", number: "WO-0002" });
      const all = await stores.workOrders.list();
      expect(all.map((o) => o.number).sort()).toEqual(["WO-0001", "WO-0002"]);
    } finally {
      stores.close();
    }
  });

  it("round-trips a cost-log entry's Money at scale 1e-6", async () => {
    const stores = makeStores();
    try {
      await stores.workOrders.create({
        ...baseOrder(),
        costLog: [{ kind: "labor", amount: Money.fromMajor("17.400009"), notes: "وردية إضافية", at: "2026-01-03T00:00:00.000Z" }],
      });
      const loaded = await stores.workOrders.findById("wo-1");
      expect(loaded?.costLog).toHaveLength(1);
      expect(loaded!.costLog[0]!.amount.toString()).toBe("17.400009");
      expect(loaded!.costLog[0]!.notes).toBe("وردية إضافية");
    } finally {
      stores.close();
    }
  });

  it("update() changes status/stage but the UPDATE SET clause leaves number/bomId/productItemId untouched", async () => {
    const stores = makeStores();
    try {
      await stores.workOrders.create(baseOrder());
      await stores.workOrders.update({
        ...baseOrder(),
        number: "WO-CHANGED",
        bomId: "bom-changed",
        productItemId: "itm-changed",
        status: "in_progress",
        stage: "started",
      });
      const loaded = await stores.workOrders.findById("wo-1");
      expect(loaded?.status).toBe("in_progress");
      expect(loaded?.stage).toBe("started");
      expect(loaded?.number).toBe("WO-0001");
      expect(loaded?.bomId).toBe("bom-1");
      expect(loaded?.productItemId).toBe("itm-1");
    } finally {
      stores.close();
    }
  });
});

describe("SqliteConfigurableProductStore", () => {
  function baseProduct() {
    return {
      id: "cp-1",
      code: "CP-0001",
      nameAr: "منتج قابل للتكوين",
      nameEn: null,
      outputItemId: "itm-out",
      unit: "PCS",
      description: null,
      inputs: [],
      materials: [],
      pricingMethod: "formula" as const,
      priceFormula: "width*height*3.5",
      laborFormula: null,
      overheadFormula: null,
      itemPolicy: "per_spec" as const,
      status: "active" as const,
      createdBy: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("round-trips by id and by code, returning null for a code that doesn't exist", async () => {
    const stores = makeStores();
    try {
      await stores.configurableProducts.create(baseProduct());
      expect((await stores.configurableProducts.findByCode("CP-0001"))?.id).toBe("cp-1");
      expect(await stores.configurableProducts.findByCode("NOPE")).toBeNull();
      expect(await stores.configurableProducts.findById("does-not-exist")).toBeNull();
    } finally {
      stores.close();
    }
  });

  it("enforces uniqueness of the configurable product code", async () => {
    const stores = makeStores();
    try {
      await stores.configurableProducts.create(baseProduct());
      await expect(
        stores.configurableProducts.create({ ...baseProduct(), id: "cp-2" }),
      ).rejects.toThrow();
    } finally {
      stores.close();
    }
  });

  it("update() changes fields via upsert, leaving other rows untouched", async () => {
    const stores = makeStores();
    try {
      await stores.configurableProducts.create(baseProduct());
      await stores.configurableProducts.create({ ...baseProduct(), id: "cp-2", code: "CP-0002" });
      await stores.configurableProducts.update({ ...baseProduct(), status: "inactive" });
      const loaded = await stores.configurableProducts.findById("cp-1");
      expect(loaded?.status).toBe("inactive");
      const other = await stores.configurableProducts.findById("cp-2");
      expect(other?.status).toBe("active");
    } finally {
      stores.close();
    }
  });

  it("update() CAN change the code, unlike BOM number/work order number", async () => {
    const stores = makeStores();
    try {
      await stores.configurableProducts.create(baseProduct());
      await stores.configurableProducts.update({ ...baseProduct(), code: "CP-RENAMED" });
      expect(await stores.configurableProducts.findByCode("CP-0001")).toBeNull();
      expect((await stores.configurableProducts.findById("cp-1"))?.code).toBe("CP-RENAMED");
    } finally {
      stores.close();
    }
  });

  it("list() returns every configurable product", async () => {
    const stores = makeStores();
    try {
      await stores.configurableProducts.create(baseProduct());
      await stores.configurableProducts.create({ ...baseProduct(), id: "cp-2", code: "CP-0002" });
      const all = await stores.configurableProducts.list();
      expect(all.map((p) => p.code).sort()).toEqual(["CP-0001", "CP-0002"]);
    } finally {
      stores.close();
    }
  });
});

describe("SqliteConfigInstanceStore", () => {
  function baseInstance() {
    return {
      id: "ci-1",
      number: "CI-0001",
      configurableProductId: "cp-1",
      productNameAr: "منتج قابل للتكوين",
      outputItemId: "itm-out",
      spec: { width: "100", height: "50" },
      qty: Qty.fromMajor("1"),
      customerId: null,
      sellUnitPrice: null,
      notes: null,
      status: "configured" as const,
      bomId: "bom-1",
      workOrderId: "wo-1",
      materials: [
        { itemId: "itm-2", qtyPerUnit: Qty.fromMajor("0.123456"), wastePercent: 1, lineCost: Money.fromMajor("0.000001") },
      ],
      materialCostPerUnit: Money.zero(),
      laborCostPerUnit: Money.zero(),
      overheadCostPerUnit: Money.zero(),
      estimatedUnitCost: Money.zero(),
      actualCost: null,
      createdBy: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("round-trips sellUnitPrice and actualCost as null (not zero)", async () => {
    const stores = makeStores();
    try {
      await stores.configInstances.create(baseInstance());
      const loaded = await stores.configInstances.findById("ci-1");
      expect(loaded?.sellUnitPrice).toBeNull();
      expect(loaded?.actualCost).toBeNull();
    } finally {
      stores.close();
    }
  });

  it("round-trips sellUnitPrice/actualCost as Money at scale 1e-6 when present", async () => {
    const stores = makeStores();
    try {
      await stores.configInstances.create({
        ...baseInstance(),
        sellUnitPrice: Money.fromMajor("99.990001"),
        actualCost: Money.fromMajor("42.000042"),
      });
      const loaded = await stores.configInstances.findById("ci-1");
      expect(loaded?.sellUnitPrice?.toString()).toBe("99.990001");
      expect(loaded?.actualCost?.toString()).toBe("42.000042");
      expect(loaded!.materials[0]!.qtyPerUnit.toString()).toBe("0.123456");
      expect(loaded!.materials[0]!.lineCost.toString()).toBe("0.000001");
    } finally {
      stores.close();
    }
  });

  it("enforces uniqueness of the config instance number", async () => {
    const stores = makeStores();
    try {
      await stores.configInstances.create(baseInstance());
      await expect(stores.configInstances.create({ ...baseInstance(), id: "ci-2" })).rejects.toThrow();
    } finally {
      stores.close();
    }
  });

  it("round-trips the spec record exactly", async () => {
    const stores = makeStores();
    try {
      await stores.configInstances.create(baseInstance());
      const loaded = await stores.configInstances.findById("ci-1");
      expect(loaded?.spec).toEqual({ width: "100", height: "50" });
    } finally {
      stores.close();
    }
  });

  it("list() returns every config instance", async () => {
    const stores = makeStores();
    try {
      await stores.configInstances.create(baseInstance());
      await stores.configInstances.create({ ...baseInstance(), id: "ci-2", number: "CI-0002" });
      const all = await stores.configInstances.list();
      expect(all.map((i) => i.number).sort()).toEqual(["CI-0001", "CI-0002"]);
    } finally {
      stores.close();
    }
  });

  it("update() changes status/actualCost but qty is not in the UPDATE SET clause and stays fixed", async () => {
    const stores = makeStores();
    try {
      await stores.configInstances.create(baseInstance());
      await stores.configInstances.update({
        ...baseInstance(),
        status: "produced",
        actualCost: Money.fromMajor("55.500055"),
        qty: Qty.fromMajor("999"),
      });
      const loaded = await stores.configInstances.findById("ci-1");
      expect(loaded?.status).toBe("produced");
      expect(loaded?.actualCost?.toString()).toBe("55.500055");
      expect(loaded?.qty.toString()).toBe("1.000000");
    } finally {
      stores.close();
    }
  });
});

describe("SqliteWorkStationStore", () => {
  it("round-trips by id and by code, returning null for an unknown code", async () => {
    const stores = makeStores();
    try {
      await stores.workStations.create({
        id: "ws-1",
        code: "WS-01",
        nameAr: "محطة القص",
        nameEn: null,
        notes: null,
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      expect((await stores.workStations.findByCode("WS-01"))?.id).toBe("ws-1");
      expect(await stores.workStations.findByCode("NOPE")).toBeNull();
      expect((await stores.workStations.findById("ws-1"))?.code).toBe("WS-01");
      expect(await stores.workStations.findById("does-not-exist")).toBeNull();
    } finally {
      stores.close();
    }
  });

  it("update() changes code/status via upsert, and created_at (not in UPDATE SET) stays fixed", async () => {
    const stores = makeStores();
    try {
      await stores.workStations.create({
        id: "ws-1",
        code: "WS-01",
        nameAr: "محطة القص",
        nameEn: null,
        notes: null,
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      await stores.workStations.update({
        id: "ws-1",
        code: "WS-01-RENAMED",
        nameAr: "محطة القص المعدلة",
        nameEn: "Cutting Station",
        notes: "بعد الصيانة",
        status: "inactive",
        createdAt: "2099-01-01T00:00:00.000Z",
      });
      const loaded = await stores.workStations.findById("ws-1");
      expect(loaded?.code).toBe("WS-01-RENAMED");
      expect(loaded?.status).toBe("inactive");
      expect(loaded?.notes).toBe("بعد الصيانة");
      // created_at is not in the UPDATE SET clause.
      expect(loaded?.createdAt).toBe("2026-01-01T00:00:00.000Z");
    } finally {
      stores.close();
    }
  });

  it("enforces uniqueness of the work station code", async () => {
    const stores = makeStores();
    try {
      await stores.workStations.create({
        id: "ws-1",
        code: "WS-01",
        nameAr: "محطة القص",
        nameEn: null,
        notes: null,
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      await expect(
        stores.workStations.create({
          id: "ws-2",
          code: "WS-01",
          nameAr: "محطة أخرى",
          nameEn: null,
          notes: null,
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      ).rejects.toThrow();
    } finally {
      stores.close();
    }
  });

  it("list() orders work stations by code, not insertion order", async () => {
    const stores = makeStores();
    try {
      await stores.workStations.create({
        id: "ws-b",
        code: "WS-02",
        nameAr: "ب",
        nameEn: null,
        notes: null,
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      await stores.workStations.create({
        id: "ws-a",
        code: "WS-01",
        nameAr: "أ",
        nameEn: null,
        notes: null,
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const all = await stores.workStations.list();
      expect(all.map((s) => s.code)).toEqual(["WS-01", "WS-02"]);
    } finally {
      stores.close();
    }
  });
});
