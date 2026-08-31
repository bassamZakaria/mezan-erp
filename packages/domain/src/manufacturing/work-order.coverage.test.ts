import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { createBom } from "./bom.js";
import {
  createWorkOrder,
  startWorkOrder,
  issueWorkOrderMaterials,
  extraIssueWorkOrderMaterials,
  returnWorkOrderMaterials,
  logWorkOrderWaste,
  logWorkOrderCost,
  buildWorkOrderGlPosting,
  workOrderAbnormalWasteCost,
  type WorkOrder,
} from "./work-order.js";
import {
  WorkOrderStageError,
  InvalidManufacturingDocumentError,
  DuplicateManufacturingDocumentError,
  BomNotFoundError,
} from "./errors.js";
import type { WorkOrderGlAccounts } from "./types.js";
import { InMemoryBoms, InMemoryWorkOrders, makeNumbering, makeStock, RecordingGlPort } from "./test-helpers.js";

const RAW = "RAW-WH";
const WIP = "WIP-WH";
const FG = "FG-WH";
const ACCOUNTS: WorkOrderGlAccounts = {
  finishedGoodsAccountId: "1310-fg",
  rawInventoryAccountId: "1300-raw",
  laborAppliedAccountId: "5100-labor",
  overheadAppliedAccountId: "5200-oh",
  abnormalScrapAccountId: "5220",
  wipAccountId: "1250",
};

async function setup() {
  const boms = new InMemoryBoms();
  const workOrders = new InMemoryWorkOrders();
  const numbering = makeNumbering();
  const stock = makeStock();
  const gl = new RecordingGlPort();
  const now = () => "2026-08-22T09:00:00.000Z";
  await stock.recordOpeningBalance({
    adjustmentId: "open-m1",
    warehouseId: RAW,
    lines: [{ itemId: "m1", qty: Qty.fromMajor("100"), unitCost: Money.fromMajor("10") }],
  });
  await stock.recordOpeningBalance({
    adjustmentId: "open-m2",
    warehouseId: RAW,
    lines: [{ itemId: "m2", qty: Qty.fromMajor("100"), unitCost: Money.fromMajor("5") }],
  });
  const bom = await createBom(
    {
      id: "bom-1",
      productItemId: "FG",
      standardQty: Qty.fromMajor("1"),
      unit: "PCS",
      lines: [
        { itemId: "m1", qty: Qty.fromMajor("2") },
        { itemId: "m2", qty: Qty.fromMajor("1") },
      ],
    },
    { boms, numbering, now },
  );
  const wo = await createWorkOrder(
    {
      id: "wo-1",
      bomId: bom.id,
      plannedQty: Qty.fromMajor("10"),
      sourceWarehouseId: RAW,
      wipWarehouseId: WIP,
      destinationWarehouseId: FG,
      scheduledStartDate: "2026-08-22",
    },
    { workOrders, boms, numbering, now },
  );
  return { boms, workOrders, numbering, stock, gl, now, bom, wo };
}

describe("mulDivRoundHalfUp — exercised through BOM-to-planned-qty scaling", () => {
  it("rounds a fractional scale ratio in both directions, and carries a negative cost through as negative", async () => {
    const boms = new InMemoryBoms();
    const workOrders = new InMemoryWorkOrders();
    const numbering = makeNumbering();
    const now = () => "2026-08-22T09:00:00.000Z";
    const bom = await createBom(
      {
        id: "bom-frac",
        productItemId: "FG",
        standardQty: Qty.fromMajor("3"),
        unit: "PCS",
        // A negative standard cost is not rejected by BOM validation today —
        // exercising it here doubles as the coverage for the negative-sign
        // arm of the scaling arithmetic.
        laborCost: Money.fromMajor("-10"),
        overheadCost: Money.fromMajor("5"),
        lines: [
          { itemId: "m1", qty: Qty.fromMajor("1") },
          { itemId: "m2", qty: Qty.fromMajor("2") },
        ],
      },
      { boms, numbering, now },
    );
    const wo = await createWorkOrder(
      {
        id: "wo-frac",
        bomId: bom.id,
        plannedQty: Qty.fromMajor("7"),
        sourceWarehouseId: RAW,
        wipWarehouseId: WIP,
        destinationWarehouseId: FG,
        scheduledStartDate: "2026-08-22",
      },
      { workOrders, boms, numbering, now },
    );
    expect(wo.laborCost.toString()).toBe("-23.333333");
    expect(wo.overheadCost.toString()).toBe("11.666667");
    expect(wo.materials.find((m) => m.itemId === "m1")?.requiredQty.toString()).toBe("2.333333");
    expect(wo.materials.find((m) => m.itemId === "m2")?.requiredQty.toString()).toBe("4.666667");
  });
});

describe("createWorkOrder createdAt falls back to the wall clock when no `now` is supplied", () => {
  it("stamps a real ISO timestamp instead of throwing", async () => {
    const boms = new InMemoryBoms();
    const workOrders = new InMemoryWorkOrders();
    const numbering = makeNumbering();
    const bom = await createBom(
      { id: "bom-x", productItemId: "FG", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [{ itemId: "m1", qty: Qty.fromMajor("1") }] },
      { boms, numbering, now: () => "2026-08-22T09:00:00.000Z" },
    );
    const wo = await createWorkOrder(
      {
        id: "wo-x",
        bomId: bom.id,
        plannedQty: Qty.fromMajor("1"),
        sourceWarehouseId: RAW,
        wipWarehouseId: WIP,
        destinationWarehouseId: FG,
        scheduledStartDate: "2026-08-22",
      },
      { boms, workOrders, numbering },
    );
    expect(() => new Date(wo.createdAt).toISOString()).not.toThrow();
    expect(wo.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("createWorkOrder — every validation reason fires on its own", () => {
  async function baseDeps() {
    const boms = new InMemoryBoms();
    const workOrders = new InMemoryWorkOrders();
    const numbering = makeNumbering();
    const now = () => "2026-08-22T09:00:00.000Z";
    const bom = await createBom(
      { id: "bom-v", productItemId: "FG", standardQty: Qty.fromMajor("1"), unit: "PCS", lines: [{ itemId: "m1", qty: Qty.fromMajor("1") }] },
      { boms, numbering, now },
    );
    return { boms, workOrders, numbering, now, bomId: bom.id };
  }
  const validCommand = (bomId: string) => ({
    id: "wo-v",
    bomId,
    plannedQty: Qty.fromMajor("1"),
    sourceWarehouseId: RAW,
    wipWarehouseId: WIP,
    destinationWarehouseId: FG,
    scheduledStartDate: "2026-08-22",
  });

  it("refuses a zero planned quantity", async () => {
    const d = await baseDeps();
    await expect(
      createWorkOrder({ ...validCommand(d.bomId), plannedQty: Qty.zero() }, d),
    ).rejects.toThrow(/planned quantity must be positive/);
  });

  it("refuses a negative planned quantity", async () => {
    const d = await baseDeps();
    await expect(
      createWorkOrder({ ...validCommand(d.bomId), plannedQty: Qty.fromMajor("-1") }, d),
    ).rejects.toThrow(/planned quantity must be positive/);
  });

  it("refuses a blank raw-material warehouse", async () => {
    const d = await baseDeps();
    await expect(
      createWorkOrder({ ...validCommand(d.bomId), sourceWarehouseId: " " }, d),
    ).rejects.toThrow(/a raw-material warehouse is required/);
  });

  it("refuses a blank finished-goods warehouse", async () => {
    const d = await baseDeps();
    await expect(
      createWorkOrder({ ...validCommand(d.bomId), destinationWarehouseId: " " }, d),
    ).rejects.toThrow(/a finished-goods warehouse is required/);
  });

  it("refuses a blank work-in-process warehouse", async () => {
    const d = await baseDeps();
    await expect(
      createWorkOrder({ ...validCommand(d.bomId), wipWarehouseId: " " }, d),
    ).rejects.toThrow(/a work-in-process warehouse is required/);
  });

  it("refuses a work-in-process warehouse that is the same as the raw-material warehouse", async () => {
    const d = await baseDeps();
    await expect(
      createWorkOrder({ ...validCommand(d.bomId), wipWarehouseId: RAW }, d),
    ).rejects.toThrow(/must differ from the raw-material warehouse/);
  });

  it("refuses a work-in-process warehouse that is the same as the finished-goods warehouse", async () => {
    const d = await baseDeps();
    await expect(
      createWorkOrder({ ...validCommand(d.bomId), wipWarehouseId: FG, destinationWarehouseId: FG }, d),
    ).rejects.toThrow(/must differ from the finished-goods warehouse/);
  });

  it("refuses a BOM id that does not exist", async () => {
    const d = await baseDeps();
    await expect(createWorkOrder(validCommand("nope"), d)).rejects.toBeInstanceOf(BomNotFoundError);
  });

  it("refuses to create a second work order against an id already in use", async () => {
    const d = await baseDeps();
    await createWorkOrder(validCommand(d.bomId), d);
    await expect(createWorkOrder(validCommand(d.bomId), d)).rejects.toBeInstanceOf(
      DuplicateManufacturingDocumentError,
    );
  });
});

describe("startWorkOrder refuses to start twice", () => {
  it("throws once the order has already left not_started", async () => {
    const { workOrders, stock, now, wo } = await setup();
    const deps = { workOrders, stock, now };
    await startWorkOrder(wo.id, deps);
    await expect(startWorkOrder(wo.id, deps)).rejects.toBeInstanceOf(WorkOrderStageError);
  });
});

describe("shop-floor attribution — station and operator are optional and independently absent", () => {
  it("records the station and operator when attribution is supplied", async () => {
    const { workOrders, stock, now, wo } = await setup();
    const deps = { workOrders, stock, now };
    await startWorkOrder(wo.id, deps);
    const after = await issueWorkOrderMaterials(wo.id, deps, { stationId: "ST-1", operatorId: "OP-1" });
    const entry = after.shopFloorLog.at(-1)!;
    expect(entry.stationId).toBe("ST-1");
    expect(entry.operatorId).toBe("OP-1");
  });

  it("records null station and operator when attribution is supplied but empty", async () => {
    const { workOrders, stock, now, wo } = await setup();
    const deps = { workOrders, stock, now };
    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps);
    const after = await extraIssueWorkOrderMaterials(wo.id, [{ itemId: "m1", qty: Qty.fromMajor("1") }], deps, {});
    const entry = after.shopFloorLog.at(-1)!;
    expect(entry.stationId).toBeNull();
    expect(entry.operatorId).toBeNull();
  });
});

describe("issueWorkOrderMaterials — optional materials are skipped, not issued", () => {
  it("refuses to issue when every material on the order is optional", async () => {
    const boms = new InMemoryBoms();
    const workOrders = new InMemoryWorkOrders();
    const numbering = makeNumbering();
    const stock = makeStock();
    const now = () => "2026-08-22T09:00:00.000Z";
    await stock.recordOpeningBalance({
      adjustmentId: "open",
      warehouseId: RAW,
      lines: [{ itemId: "m1", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("1") }],
    });
    const bom = await createBom(
      {
        id: "bom-opt",
        productItemId: "FG",
        standardQty: Qty.fromMajor("1"),
        unit: "PCS",
        lines: [{ itemId: "m1", qty: Qty.fromMajor("1"), optional: true }],
      },
      { boms, numbering, now },
    );
    const wo = await createWorkOrder(
      { id: "wo-opt", bomId: bom.id, plannedQty: Qty.fromMajor("1"), sourceWarehouseId: RAW, wipWarehouseId: WIP, destinationWarehouseId: FG, scheduledStartDate: "2026-08-22" },
      { boms, workOrders, numbering, now },
    );
    const deps = { workOrders, stock, now };
    await startWorkOrder(wo.id, deps);
    await expect(issueWorkOrderMaterials(wo.id, deps)).rejects.toThrow(/no materials to issue/);
  });

  it("leaves an optional material at zero issued quantity while its required siblings are issued", async () => {
    const boms = new InMemoryBoms();
    const workOrders = new InMemoryWorkOrders();
    const numbering = makeNumbering();
    const stock = makeStock();
    const now = () => "2026-08-22T09:00:00.000Z";
    await stock.recordOpeningBalance({
      adjustmentId: "open-m1",
      warehouseId: RAW,
      lines: [{ itemId: "m1", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("1") }],
    });
    await stock.recordOpeningBalance({
      adjustmentId: "open-m2",
      warehouseId: RAW,
      lines: [{ itemId: "m2", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("1") }],
    });
    const bom = await createBom(
      {
        id: "bom-mix",
        productItemId: "FG",
        standardQty: Qty.fromMajor("1"),
        unit: "PCS",
        lines: [
          { itemId: "m1", qty: Qty.fromMajor("1") },
          { itemId: "m2", qty: Qty.fromMajor("1"), optional: true },
        ],
      },
      { boms, numbering, now },
    );
    const wo = await createWorkOrder(
      { id: "wo-mix", bomId: bom.id, plannedQty: Qty.fromMajor("1"), sourceWarehouseId: RAW, wipWarehouseId: WIP, destinationWarehouseId: FG, scheduledStartDate: "2026-08-22" },
      { boms, workOrders, numbering, now },
    );
    const deps = { workOrders, stock, now };
    await startWorkOrder(wo.id, deps);
    const after = await issueWorkOrderMaterials(wo.id, deps);
    expect(after.materials.find((m) => m.itemId === "m1")?.issuedQty.toString()).toBe("1.000000");
    const optional = after.materials.find((m) => m.itemId === "m2")!;
    expect(optional.issuedQty.toString()).toBe("0.000000");
    expect(optional.issuedUnitCost.toString()).toBe("0.000000");
  });
});

describe("returnWorkOrderMaterials refuses before materials have been issued", () => {
  it("throws WorkOrderStageError when the order has only started", async () => {
    const { workOrders, stock, now, wo } = await setup();
    const deps = { workOrders, stock, now };
    await startWorkOrder(wo.id, deps);
    await expect(
      returnWorkOrderMaterials(wo.id, [{ itemId: "m1", qty: Qty.fromMajor("1") }], deps),
    ).rejects.toBeInstanceOf(WorkOrderStageError);
  });
});

describe("logWorkOrderWaste refuses to scrap an item the BOM never named", () => {
  it("throws InvalidManufacturingDocumentError for an item absent from the order's materials", async () => {
    const { workOrders, stock, gl, now, wo } = await setup();
    const deps = { workOrders, stock, now };
    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps);
    await expect(
      logWorkOrderWaste(
        wo.id,
        [{ itemId: "ghost-item", qty: Qty.fromMajor("1") }],
        { ...deps, gl, accounts: { rawInventoryAccountId: "1300-raw", abnormalScrapAccountId: "5220", wipAccountId: "1250" } },
      ),
    ).rejects.toBeInstanceOf(InvalidManufacturingDocumentError);
  });
});

describe("logWorkOrderCost — every logged kind capitalises into its own bucket", () => {
  it("adds a labour cost to laborCost", async () => {
    const { workOrders, now, wo } = await setup();
    await startWorkOrder(wo.id, { workOrders, now });
    const after = await logWorkOrderCost(wo.id, { kind: "labor", amount: Money.fromMajor("15") }, { workOrders, now });
    expect(after.laborCost.toString()).toBe("15.000000");
  });

  it("adds an 'other' cost to extraCost", async () => {
    const { workOrders, now, wo } = await setup();
    await startWorkOrder(wo.id, { workOrders, now });
    const after = await logWorkOrderCost(wo.id, { kind: "other", amount: Money.fromMajor("7") }, { workOrders, now });
    expect(after.extraCost.toString()).toBe("7.000000");
  });
});

describe("workOrderAbnormalWasteCost sums the abnormal-loss cost across the waste log", () => {
  it("sums abnormalCost only, ignoring the normal (still-capitalised) portion", () => {
    const order = {
      wasteLog: [
        { normalCost: Money.fromMajor("5"), abnormalCost: Money.fromMajor("2") },
        { normalCost: Money.fromMajor("0"), abnormalCost: Money.fromMajor("3") },
      ],
    } as unknown as Pick<WorkOrder, "wasteLog">;
    expect(workOrderAbnormalWasteCost(order).toString()).toBe("5.000000");
  });
});

describe("buildWorkOrderGlPosting nets legs sharing one account down to zero", () => {
  it("drops an account whose debit and credit legs cancel exactly, and returns null when nothing is left to post", () => {
    const order = {
      id: "wo-net",
      number: "WO-NET",
      materialCost: Money.fromMajor("100"),
      laborCost: Money.zero(),
      overheadCost: Money.zero(),
      extraCost: Money.zero(),
    } as unknown as WorkOrder;
    const accounts: WorkOrderGlAccounts = {
      ...ACCOUNTS,
      finishedGoodsAccountId: "1200-shared",
      rawInventoryAccountId: "1200-shared",
    };
    expect(buildWorkOrderGlPosting(order, accounts, "2026-08-22")).toBeNull();
  });
});
