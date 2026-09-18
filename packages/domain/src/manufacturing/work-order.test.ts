import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { StockLedgerService } from "../inventory/index.js";
import { createBom } from "./bom.js";
import {
  createWorkOrder,
  startWorkOrder,
  issueWorkOrderMaterials,
  extraIssueWorkOrderMaterials,
  receiveWorkOrderProduct,
  completeWorkOrder,
  returnWorkOrderMaterials,
  logWorkOrderWaste,
  logWorkOrderCost,
  cancelWorkOrder,
  workOrderWipTotal,
  workOrderProgress,
  workOrderWastedQty,
  buildWorkOrderGlPosting,
  type WorkOrder,
} from "./work-order.js";
import {
  WorkOrderStageError,
  WorkOrderNotFoundError,
  InvalidManufacturingDocumentError,
} from "./errors.js";
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

const WASTE_ACCOUNTS = {
  rawInventoryAccountId: "1300-raw",
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
  await stock.recordOpeningBalance({
    adjustmentId: "open-m3",
    warehouseId: RAW,
    lines: [{ itemId: "m3", qty: Qty.fromMajor("50"), unitCost: Money.fromMajor("2") }],
  });
}

/** A work order whose sole material (m1) carries a 10% BOM waste allowance, for scrap tests. */
async function setupWithWasteAllowance() {
  const boms = new InMemoryBoms();
  const workOrders = new InMemoryWorkOrders();
  const numbering = makeNumbering();
  const stock = makeStock();
  const gl = new RecordingGlPort();
  // Each waste/return/extra-issue call folds `at` into its movement id, so a
  // fixed clock collides the moment a test logs waste twice — advance it.
  let tick = 0;
  const now = () => `2026-08-22T09:${String(tick++).padStart(2, "0")}:00.000Z`;
  await seedStock(stock);
  const bom = await createBom(
    {
      id: "bom-waste",
      productItemId: "FG",
      standardQty: Qty.fromMajor("1"),
      unit: "PCS",
      lines: [{ itemId: "m1", qty: Qty.fromMajor("2"), wastePercent: 10 }],
    },
    { boms, numbering, now },
  );
  const wo = await createWorkOrder(
    {
      id: "wo-waste",
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

async function setup(overrides: { projectId?: string | null } = {}) {
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
      projectId: overrides.projectId,
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

  it("carries the work order's projectId on every posting line when it names a project", async () => {
    const { workOrders, stock, gl, now, wo } = await setup({ projectId: "proj-1" });
    const deps = { workOrders, stock, now, gl: { async post() {} }, accounts: { rawInventoryAccountId: "1200", abnormalScrapAccountId: "5220", wipAccountId: "1250" } };

    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps);
    await receiveWorkOrderProduct(wo.id, Qty.fromMajor("10"), deps);
    const { posting } = await completeWorkOrder(wo.id, { workOrders, gl, accounts: ACCOUNTS, now });

    expect(posting!.lines.length).toBeGreaterThan(0);
    for (const line of posting!.lines) {
      expect(line.projectId).toBe("proj-1");
    }
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

  it("404s starting, issuing, returning, logging or completing a work order that does not exist", async () => {
    const { workOrders, stock, gl, now } = await setup();
    const deps = { workOrders, stock, now };
    await expect(startWorkOrder("nope", deps)).rejects.toBeInstanceOf(WorkOrderNotFoundError);
    await expect(cancelWorkOrder("nope", { workOrders })).rejects.toBeInstanceOf(WorkOrderNotFoundError);
    await expect(
      completeWorkOrder("nope", { workOrders, gl, accounts: ACCOUNTS, now }),
    ).rejects.toBeInstanceOf(WorkOrderNotFoundError);
  });

  it("LIMITATION: a legacy order with no مستودع التشغيل refuses to move stock at all", async () => {
    // Orders written before WIP had a physical address carry an empty
    // wipWarehouseId. There is no migration path shown here — this pins that
    // issuing against such an order is refused outright (never falls back to
    // the pre-WIP "bare OUT" behaviour). If a backfill/migration is ever
    // added, this expectation flips from `.rejects` to a successful issue.
    const { workOrders, stock, now, wo } = await setup();
    await startWorkOrder(wo.id, { workOrders, now });
    const started = await workOrders.findById(wo.id);
    await workOrders.update({ ...started!, wipWarehouseId: "" });
    await expect(
      issueWorkOrderMaterials(wo.id, { workOrders, stock, now }),
    ).rejects.toThrow(/names no work-in-process warehouse/);
  });
});

describe("work order — extra issue merges into existing and new material lines", () => {
  it("adds to an already-issued material's qty and WIP cost", async () => {
    const { workOrders, stock, now, wo } = await setup();
    const deps = { workOrders, stock, now };
    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps);
    // 3 more of m1 @10 (single moving-average layer in RAW) = 30 additional WIP cost.
    const after = await extraIssueWorkOrderMaterials(wo.id, [{ itemId: "m1", qty: Qty.fromMajor("3") }], deps);
    expect(after.materialCost.toString()).toBe("280.000000"); // 250 initial + 30
    expect(after.materials.find((m) => m.itemId === "m1")?.issuedQty.toString()).toBe("23.000000");
    expect((await stock.getBalance("m1", WIP)).toString()).toBe("23.000000");
    expect((await stock.getBalance("m1", RAW)).toString()).toBe("77.000000");
  });

  it("adds a material the BOM never planned for as a new optional line", async () => {
    const { workOrders, stock, now, wo } = await setup();
    const deps = { workOrders, stock, now };
    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps);
    const after = await extraIssueWorkOrderMaterials(wo.id, [{ itemId: "m3", qty: Qty.fromMajor("4") }], deps);
    const m3 = after.materials.find((m) => m.itemId === "m3");
    expect(m3?.optional).toBe(true);
    expect(m3?.issuedQty.toString()).toBe("4.000000");
    expect(m3?.requiredQty.toString()).toBe("0.000000");
    expect(after.materialCost.toString()).toBe("258.000000"); // 250 + 4×2
  });

  it("rejects extra-issue before materials have been issued, and rejects an empty line list", async () => {
    const { workOrders, stock, now, wo } = await setup();
    const deps = { workOrders, stock, now };
    await expect(
      extraIssueWorkOrderMaterials(wo.id, [{ itemId: "m1", qty: Qty.fromMajor("1") }], deps),
    ).rejects.toBeInstanceOf(WorkOrderStageError);
    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps);
    await expect(extraIssueWorkOrderMaterials(wo.id, [], deps)).rejects.toBeInstanceOf(
      InvalidManufacturingDocumentError,
    );
  });
});

describe("work order — return refuses more than is outstanding", () => {
  it("leaves materialCost and stock untouched when the return exceeds what is standing on the floor", async () => {
    const { workOrders, stock, now, wo } = await setup();
    const deps = { workOrders, stock, now };
    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps); // 20 of m1 issued
    await expect(
      returnWorkOrderMaterials(wo.id, [{ itemId: "m1", qty: Qty.fromMajor("20.000001") }], deps),
    ).rejects.toThrow(/only 20\.000000 outstanding/);

    const unchanged = await workOrders.findById(wo.id);
    expect(unchanged?.materialCost.toString()).toBe("250.000000");
    expect((await stock.getBalance("m1", WIP)).toString()).toBe("20.000000");
    expect((await stock.getBalance("m1", RAW)).toString()).toBe("80.000000");
  });

  it("rejects returning an item never issued, and an empty line list", async () => {
    const { workOrders, stock, now, wo } = await setup();
    const deps = { workOrders, stock, now };
    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps);
    await expect(
      returnWorkOrderMaterials(wo.id, [{ itemId: "ghost-item", qty: Qty.fromMajor("1") }], deps),
    ).rejects.toBeInstanceOf(InvalidManufacturingDocumentError);
    await expect(returnWorkOrderMaterials(wo.id, [], deps)).rejects.toBeInstanceOf(
      InvalidManufacturingDocumentError,
    );
  });
});

describe("work order — scrap splits normal (allowed) vs. abnormal (over-allowance) loss", () => {
  it("consumes the BOM's waste allowance across calls, then posts abnormal loss beyond it — cost derived by hand", async () => {
    const { workOrders, stock, gl, now, wo } = await setupWithWasteAllowance();
    const deps = { workOrders, stock, now };
    const wasteDeps = { ...deps, gl, accounts: WASTE_ACCOUNTS };

    await startWorkOrder(wo.id, deps);
    // BOM: m1 qty 2 × 10% waste → effective 2.2 × planned 10 = 22 required.
    const issued = await issueWorkOrderMaterials(wo.id, deps);
    expect(issued.materials[0]?.requiredQty.toString()).toBe("22.000000");
    // Allowance = 22 × 10 / 110 = 2 exactly.

    // Call 1: scrap 2 (== the whole allowance) → entirely normal.
    const afterFirst = await logWorkOrderWaste(
      wo.id,
      [{ itemId: "m1", qty: Qty.fromMajor("2") }],
      wasteDeps,
    );
    const first = afterFirst.wasteLog[0]!;
    expect(first.normalQty.toString()).toBe("2.000000");
    expect(first.abnormalQty.toString()).toBe("0.000000");
    // 2 units leave WIP at its moving-average cost (10) = 20, all normal.
    expect(first.normalCost.toString()).toBe("20.000000");
    expect(first.abnormalCost.toString()).toBe("0.000000");
    expect(gl.postings).toHaveLength(1);
    const je1 = gl.postings[0]!;
    expect(je1.lines.find((l) => l.accountId === WASTE_ACCOUNTS.wipAccountId)?.debit.toString()).toBe("20.000000");
    expect(je1.lines.find((l) => l.accountId === WASTE_ACCOUNTS.rawInventoryAccountId)?.credit.toString()).toBe("20.000000");
    expect(je1.lines.some((l) => l.accountId === WASTE_ACCOUNTS.abnormalScrapAccountId)).toBe(false);

    // Call 2: scrap 1 more — allowance is exhausted, so this is entirely abnormal.
    const afterSecond = await logWorkOrderWaste(
      wo.id,
      [{ itemId: "m1", qty: Qty.fromMajor("1") }],
      wasteDeps,
    );
    const second = afterSecond.wasteLog[1]!;
    expect(second.normalQty.toString()).toBe("0.000000");
    expect(second.abnormalQty.toString()).toBe("1.000000");
    expect(second.normalCost.toString()).toBe("0.000000");
    expect(second.abnormalCost.toString()).toBe("10.000000");
    expect(gl.postings).toHaveLength(2);
    const je2 = gl.postings[1]!;
    expect(je2.lines.find((l) => l.accountId === WASTE_ACCOUNTS.abnormalScrapAccountId)?.debit.toString()).toBe("10.000000");
    expect(je2.lines.find((l) => l.accountId === WASTE_ACCOUNTS.rawInventoryAccountId)?.credit.toString()).toBe("10.000000");
    // Σdebit = Σcredit on every posting logged.
    for (const je of gl.postings) {
      const debit = je.lines.reduce((s, l) => s.add(l.debit), Money.zero());
      const credit = je.lines.reduce((s, l) => s.add(l.credit), Money.zero());
      expect(debit.toString()).toBe(credit.toString());
    }

    // Only the (2 + 1) = 3 scrapped units left مستودع التشغيل; 19 of the 22 issued still stand.
    expect((await stock.getBalance("m1", WIP)).toString()).toBe("19.000000");
    expect(workOrderWastedQty(afterSecond, "m1").toString()).toBe("3.000000");

    // --- Finished-goods receipt at a hand-derived unit cost ------------------
    // Outstanding in WIP: 22 issued − 0 returned − 3 scrapped = 19, consumed at
    // receipt (10 each) = 190. Normal scrap cost (20) rejoins the product, so
    // materialCost resets to 190 + 20 = 210; abnormal scrap (10) never does.
    const received = await receiveWorkOrderProduct(wo.id, Qty.fromMajor("10"), { ...deps, gl, accounts: WASTE_ACCOUNTS });
    expect(received.materialCost.toString()).toBe("210.000000");
    expect(workOrderWipTotal(received).toString()).toBe("210.000000"); // no labour/overhead on this BOM
    const fg = await stock.getBalanceDetail("FG", FG);
    expect(fg.onHand.toString()).toBe("10.000000");
    // unit cost = wip(210) ÷ produced(10) = 21.
    expect(fg.averageCost.toString()).toBe("21.000000");
    expect(fg.totalValue.toString()).toBe("210.000000");
    // Parked normal-waste GL entry: raw inventory absorbs the 20 back from WIP.
    expect(gl.postings).toHaveLength(3);
    const je3 = gl.postings[2]!;
    expect(je3.lines.find((l) => l.accountId === WASTE_ACCOUNTS.rawInventoryAccountId)?.debit.toString()).toBe("20.000000");
    expect(je3.lines.find((l) => l.accountId === WASTE_ACCOUNTS.wipAccountId)?.credit.toString()).toBe("20.000000");
  });

  it("rejects scrapping more than is standing in مستودع التشغيل, and rejects zero/negative quantities", async () => {
    const { workOrders, stock, gl, now, wo } = await setupWithWasteAllowance();
    const deps = { workOrders, stock, now };
    const wasteDeps = { ...deps, gl, accounts: WASTE_ACCOUNTS };
    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps); // 22 issued

    await expect(
      logWorkOrderWaste(wo.id, [{ itemId: "m1", qty: Qty.fromMajor("22.000001") }], wasteDeps),
    ).rejects.toBeInstanceOf(InvalidManufacturingDocumentError);
    await expect(
      logWorkOrderWaste(wo.id, [{ itemId: "m1", qty: Qty.zero() }], wasteDeps),
    ).rejects.toBeInstanceOf(InvalidManufacturingDocumentError);
    await expect(logWorkOrderWaste(wo.id, [], wasteDeps)).rejects.toBeInstanceOf(
      InvalidManufacturingDocumentError,
    );
    // Nothing posted for any of the refused calls.
    expect(gl.postings).toHaveLength(0);
    expect((await stock.getBalance("m1", WIP)).toString()).toBe("22.000000");
  });

  it("rejects logging waste before materials are issued", async () => {
    const { workOrders, stock, gl, now, wo } = await setupWithWasteAllowance();
    const deps = { workOrders, stock, now };
    await startWorkOrder(wo.id, deps);
    await expect(
      logWorkOrderWaste(wo.id, [{ itemId: "m1", qty: Qty.fromMajor("1") }], { ...deps, gl, accounts: WASTE_ACCOUNTS }),
    ).rejects.toBeInstanceOf(WorkOrderStageError);
  });
});

describe("work order — logging labour/overhead/other cost", () => {
  it("rejects logging a cost before the order has started, and after it has completed", async () => {
    const { workOrders, stock, gl, now, wo } = await setup();
    await expect(
      logWorkOrderCost(wo.id, { kind: "labor", amount: Money.fromMajor("10") }, { workOrders, now }),
    ).rejects.toBeInstanceOf(WorkOrderStageError);

    const deps = { workOrders, stock, now, gl: { async post() {} }, accounts: WASTE_ACCOUNTS };
    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps);
    await receiveWorkOrderProduct(wo.id, Qty.fromMajor("10"), deps);
    await completeWorkOrder(wo.id, { workOrders, gl, accounts: ACCOUNTS, now });
    await expect(
      logWorkOrderCost(wo.id, { kind: "overhead", amount: Money.fromMajor("10") }, { workOrders, now }),
    ).rejects.toBeInstanceOf(WorkOrderStageError);
  });

  it("rejects a zero or negative logged amount", async () => {
    const { workOrders, now, wo } = await setup();
    await startWorkOrder(wo.id, { workOrders, now });
    await expect(
      logWorkOrderCost(wo.id, { kind: "other", amount: Money.zero() }, { workOrders, now }),
    ).rejects.toBeInstanceOf(InvalidManufacturingDocumentError);
  });
});

describe("work order — receiving product", () => {
  it("rejects a zero or negative produced quantity", async () => {
    const { workOrders, stock, now, wo } = await setup();
    const deps = { workOrders, stock, now, gl: { async post() {} }, accounts: WASTE_ACCOUNTS };
    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps);
    await expect(
      receiveWorkOrderProduct(wo.id, Qty.zero(), deps),
    ).rejects.toBeInstanceOf(InvalidManufacturingDocumentError);
    await expect(
      receiveWorkOrderProduct(wo.id, Qty.fromMajor("-1"), deps),
    ).rejects.toBeInstanceOf(InvalidManufacturingDocumentError);
  });

  it("rejects receiving before materials are issued", async () => {
    const { workOrders, stock, now, wo } = await setup();
    const deps = { workOrders, stock, now, gl: { async post() {} }, accounts: WASTE_ACCOUNTS };
    await startWorkOrder(wo.id, deps);
    await expect(
      receiveWorkOrderProduct(wo.id, Qty.fromMajor("10"), deps),
    ).rejects.toBeInstanceOf(WorkOrderStageError);
  });
});

describe("work order — the finished goods are worth exactly what the completion capitalises (D206)", () => {
  it.each(["10", "2.5", "1", "0.3"])("receives %s units at the WIP total to the last micro-unit", async (qty) => {
    const { workOrders, stock, gl, now, wo } = await setup();
    const deps = { workOrders, stock, now, gl: { async post() {} }, accounts: WASTE_ACCOUNTS };
    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps);
    await logWorkOrderCost(wo.id, { kind: "overhead", amount: Money.fromMajor("0.000007") }, { workOrders, now });
    await receiveWorkOrderProduct(wo.id, Qty.fromMajor(qty), deps);

    const { posting } = await completeWorkOrder(wo.id, { workOrders, gl, accounts: ACCOUNTS, now });
    const capitalised = posting!.lines.find((l) => l.accountId === ACCOUNTS.finishedGoodsAccountId)!.debit;
    const fg = await stock.getBalanceDetail("FG", FG);
    expect(capitalised.toString()).toBe("300.000007");
    expect(fg.totalValue.toString()).toBe(capitalised.toString());
    expect(fg.onHand.toString()).toBe(Qty.fromMajor(qty).toString());
  });
});

describe("work order — completing twice must not double-post", () => {
  it("refuses a second completion, and the GL keeps exactly one posting", async () => {
    const { workOrders, stock, gl, now, wo } = await setup();
    const deps = { workOrders, stock, now, gl: { async post() {} }, accounts: WASTE_ACCOUNTS };
    await startWorkOrder(wo.id, deps);
    await issueWorkOrderMaterials(wo.id, deps);
    await receiveWorkOrderProduct(wo.id, Qty.fromMajor("10"), deps);
    await completeWorkOrder(wo.id, { workOrders, gl, accounts: ACCOUNTS, now });
    expect(gl.postings).toHaveLength(1);

    await expect(
      completeWorkOrder(wo.id, { workOrders, gl, accounts: ACCOUNTS, now }),
    ).rejects.toBeInstanceOf(WorkOrderStageError);
    // The refused re-completion posted nothing further.
    expect(gl.postings).toHaveLength(1);
  });
});

describe("work order — pure read helpers", () => {
  it("workOrderProgress is 0 for a zero-planned order and the produced/planned ratio otherwise", () => {
    expect(workOrderProgress({ producedQty: Qty.zero(), plannedQty: Qty.zero() })).toBe(0);
    expect(workOrderProgress({ producedQty: Qty.fromMajor("5"), plannedQty: Qty.fromMajor("10") })).toBe(0.5);
  });

  it("buildWorkOrderGlPosting returns null when the order has capitalised no WIP cost at all", () => {
    const zeroOrder = {
      id: "wo-z",
      number: "WO-Z",
      materialCost: Money.zero(),
      laborCost: Money.zero(),
      overheadCost: Money.zero(),
      extraCost: Money.zero(),
    } as unknown as WorkOrder;
    expect(buildWorkOrderGlPosting(zeroOrder, ACCOUNTS, "2026-08-22")).toBeNull();
  });
});
