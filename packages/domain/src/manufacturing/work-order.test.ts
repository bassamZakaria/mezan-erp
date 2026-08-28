import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { StockLedgerService } from "../inventory/index.js";
import { createBom } from "./bom.js";
import {
  createWorkOrder,
  startWorkOrder,
  issueWorkOrderMaterials,
  receiveWorkOrderProduct,
  completeWorkOrder,
  returnWorkOrderMaterials,
  logWorkOrderCost,
  cancelWorkOrder,
  workOrderWipTotal,
  type WorkOrder,
} from "./work-order.js";
import { WorkOrderStageError } from "./errors.js";
import type { WorkOrderGlAccounts } from "./types.js";
import {
  InMemoryBoms,
  InMemoryWorkOrders,
  makeNumbering,
  makeStock,
  RecordingGlPort,
} from "./test-helpers.js";

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

async function seedStock(stock: StockLedgerService) {
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
}

async function setup() {
  const boms = new InMemoryBoms();
  const workOrders = new InMemoryWorkOrders();
  const numbering = makeNumbering();
  const stock = makeStock();
  const gl = new RecordingGlPort();
  const now = () => "2026-08-22T09:00:00.000Z";
  await seedStock(stock);
  const bom = await createBom(
    {
      id: "bom-1",
      productItemId: "FG",
      standardQty: Qty.fromMajor("1"),
      unit: "PCS",
      laborCost: Money.fromMajor("3"),
      overheadCost: Money.fromMajor("2"),
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
  return { boms, workOrders, numbering, stock, gl, now, wo };
}

describe("work order — creation snapshot", () => {
  it("scales BOM materials, labour and overhead from standard batch to planned qty", async () => {
    const { wo } = await setup();
    expect(wo.number).toBe("WO-0001");
    expect(wo.status).toBe("planned");
    expect(wo.stage).toBe("not_started");
    expect(wo.materials.find((m) => m.itemId === "m1")?.requiredQty.toString()).toBe("20.000000");
    expect(wo.materials.find((m) => m.itemId === "m2")?.requiredQty.toString()).toBe("10.000000");
    expect(wo.laborCost.toString()).toBe("30.000000"); // 3 × 10
    expect(wo.overheadCost.toString()).toBe("20.000000"); // 2 × 10
  });
});

describe("work order — 4-stage stock + GL + WIP costing", () => {
  it("drives start → issue → receive → complete, moving stock and posting the WIP chain", async () => {
    const { workOrders, stock, gl, now, wo } = await setup();
    const deps = { workOrders, stock, now, gl: { async post() {} }, accounts: { rawInventoryAccountId: "1200", abnormalScrapAccountId: "5220", wipAccountId: "1250" } };

    // 1. بدء العمل
    let cur: WorkOrder = await startWorkOrder(wo.id, deps);
    expect(cur.status).toBe("in_progress");
    expect(cur.stage).toBe("started");

    // 2. صرف المواد — material TRANSFERS to مستودع التشغيل at moving average.
    cur = await issueWorkOrderMaterials(wo.id, deps);
    expect(cur.stage).toBe("materials_issued");
    expect(cur.materialCost.toString()).toBe("250.000000"); // 20×10 + 10×5
    expect((await stock.getBalance("m1", RAW)).toString()).toBe("80.000000");
    expect((await stock.getBalance("m2", RAW)).toString()).toBe("90.000000");
    // Guards D63: the issued material has an ADDRESS and a quantity a floor
    // count can be held against, not just a figure on the order.
    expect((await stock.getBalance("m1", WIP)).toString()).toBe("20.000000");
    expect((await stock.getBalance("m2", WIP)).toString()).toBe("10.000000");
    expect((await stock.getBalanceDetail("m1", WIP)).totalValue.toString()).toBe("200.000000");

    // WIP capitalises labour + overhead too.
    expect(workOrderWipTotal(cur).toString()).toBe("300.000000");

    // 3. استلام المنتج — finished goods IN at WIP unit cost (COGS deferred).
    cur = await receiveWorkOrderProduct(wo.id, Qty.fromMajor("10"), deps);
    expect(cur.stage).toBe("product_received");
    expect(cur.producedQty.toString()).toBe("10.000000");
    // مستودع التشغيل is emptied by the receipt — the material is now the product.
    expect((await stock.getBalance("m1", WIP)).toString()).toBe("0.000000");
    expect((await stock.getBalance("m2", WIP)).toString()).toBe("0.000000");
    const fg = await stock.getBalanceDetail("FG", FG);
    expect(fg.onHand.toString()).toBe("10.000000");
    expect(fg.totalValue.toString()).toBe("300.000000");
    expect(fg.averageCost.toString()).toBe("30.000000");
    // No GL posted yet — stock moves are stock-only.
    expect(gl.postings).toHaveLength(0);

    // 4. إكمال — auto-posts the balanced WIP-capitalisation entry.
    const { order, posting } = await completeWorkOrder(wo.id, {
      workOrders,
      gl,
      accounts: ACCOUNTS,
      now,
    });
    expect(order.status).toBe("completed");
    expect(order.stage).toBe("completed");
    expect(order.glPosted).toBe(true);
    expect(gl.postings).toHaveLength(1);

    const p = posting!;
    const debit = p.lines.filter((l) => l.debit.scaled > 0n);
    const credit = p.lines.filter((l) => l.credit.scaled > 0n);
    expect(Money.sum(debit.map((l) => l.debit)).toString()).toBe("300.000000");
    expect(Money.sum(credit.map((l) => l.credit)).toString()).toBe("300.000000");
    // Dr finished goods 300 ; Cr raw 250 / labour 30 / overhead 20.
    expect(debit).toHaveLength(1);
    expect(debit[0]?.accountId).toBe("1310-fg");
    const creditFor = (acc: string) =>
      credit.find((l) => l.accountId === acc)?.credit.toString() ?? "0";
    expect(creditFor("1300-raw")).toBe("250.000000");
    expect(creditFor("5100-labor")).toBe("30.000000");
    expect(creditFor("5200-oh")).toBe("20.000000");
  });

  it("capitalises a logged extra cost into the finished-goods unit cost", async () => {
    const { workOrders, stock, gl, now, wo } = await setup();
    const deps = { workOrders, stock, now, gl: { async post() {} }, accounts: { rawInventoryAccountId: "1200", abnormalScrapAccountId: "5220", wipAccountId: "1250" } };
    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps);
    // log 100 overhead → WIP 400 → unit cost 40.
    await logWorkOrderCost(wo.id, { kind: "overhead", amount: Money.fromMajor("100") }, { workOrders, now });
    const received = await receiveWorkOrderProduct(wo.id, Qty.fromMajor("10"), deps);
    expect(workOrderWipTotal(received).toString()).toBe("400.000000");
    expect((await stock.getBalanceDetail("FG", FG)).averageCost.toString()).toBe("40.000000");
    const { posting } = await completeWorkOrder(wo.id, { workOrders, gl, accounts: ACCOUNTS, now });
    // overhead credit = standard 20 + logged 100 = 120.
    const oh = posting!.lines.find((l) => l.accountId === "5200-oh");
    expect(oh?.credit.toString()).toBe("120.000000");
  });

  it("returns unused material back to stock and reduces the WIP", async () => {
    const { workOrders, stock, now, wo } = await setup();
    const deps = { workOrders, stock, now, gl: { async post() {} }, accounts: { rawInventoryAccountId: "1200", abnormalScrapAccountId: "5220", wipAccountId: "1250" } };
    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps);
    const after = await returnWorkOrderMaterials(
      wo.id,
      [{ itemId: "m1", qty: Qty.fromMajor("5") }],
      deps,
    );
    // 5 of m1 (issued @10) walks back off the floor → material WIP 250 − 50 = 200.
    expect(after.materialCost.toString()).toBe("200.000000");
    expect((await stock.getBalance("m1", RAW)).toString()).toBe("85.000000");
    expect((await stock.getBalance("m1", WIP)).toString()).toBe("15.000000");
  });
});

describe("work order — stage guards", () => {
  it("rejects issuing before starting", async () => {
    const { workOrders, stock, now, wo } = await setup();
    await expect(
      issueWorkOrderMaterials(wo.id, { workOrders, stock, now }),
    ).rejects.toBeInstanceOf(WorkOrderStageError);
  });

  it("rejects completing before receiving the product", async () => {
    const { workOrders, stock, gl, now, wo } = await setup();
    const deps = { workOrders, stock, now, gl: { async post() {} }, accounts: { rawInventoryAccountId: "1200", abnormalScrapAccountId: "5220", wipAccountId: "1250" } };
    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps);
    await expect(
      completeWorkOrder(wo.id, { workOrders, gl, accounts: ACCOUNTS, now }),
    ).rejects.toBeInstanceOf(WorkOrderStageError);
  });

  it("cancels a planned order but not one past material issue", async () => {
    const { workOrders, wo } = await setup();
    expect((await cancelWorkOrder(wo.id, { workOrders })).status).toBe("cancelled");

    const s2 = await setup();
    const s2deps = { workOrders: s2.workOrders, stock: s2.stock, now: s2.now };
    await startWorkOrder(s2.wo.id, s2deps);
    await issueWorkOrderMaterials(s2.wo.id, s2deps);
    await expect(cancelWorkOrder(s2.wo.id, { workOrders: s2.workOrders })).rejects.toBeInstanceOf(
      WorkOrderStageError,
    );
  });
});
