/**
 * FEFO consumption (cost-layer.ts compareLayersForConsumption): an issue draws
 * on the EARLIEST-EXPIRING layer first, whatever order the receipts arrived in,
 * and layers with no expiry go last in receipt order.
 *
 * The assertions name the batches and the layer ids, in order. A test that only
 * checked the total quantity came out right would pass under a comparator that
 * consumed the layers backwards.
 */

import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { StockLedgerService } from "./stock-ledger-service.js";
import { ExpiredStockError } from "./errors.js";
import { InMemoryStockLedger, InMemoryCostLayers, InMemorySnapshots } from "./test-helpers/in-memory-stores.js";

const WH1 = "WH1";
const WH2 = "WH2";

function harness(extra: Partial<ConstructorParameters<typeof StockLedgerService>[0]> = {}) {
  const layers = new InMemoryCostLayers();
  const snapshots = new InMemorySnapshots();
  const svc = new StockLedgerService({
    ledger: new InMemoryStockLedger(),
    layers,
    snapshots,
    policy: { allowNegativeStock: false },
    clock: () => "2026-08-10T00:00:00.000Z",
    ...extra,
  });
  return { svc, layers };
}

interface Receipt {
  readonly id: string;
  readonly itemId: string;
  readonly qty: string;
  readonly unitCost: string;
  readonly batchNo: string;
  readonly expiryDate: string | null;
  readonly on: string;
}

async function receive(svc: StockLedgerService, r: Receipt): Promise<void> {
  await svc.postReceipt({
    receiptId: r.id,
    warehouseId: WH1,
    sourceDocType: "PURCHASE_RECEIPT",
    occurredAt: r.on,
    lines: [
      {
        itemId: r.itemId,
        qty: Qty.fromMajor(r.qty),
        unitCost: Money.fromMajor(r.unitCost),
        batchNo: r.batchNo,
        expiryDate: r.expiryDate,
      },
    ],
  });
}

/**
 * Four batches of ITEM-A, entered in an order that is NOT expiry order:
 * latest-expiring first, then earliest, then a batch with no expiry at all,
 * then a middle one. 30 units, 390.00 of value, an average of exactly 13.00.
 */
async function seedFourBatches(svc: StockLedgerService): Promise<void> {
  await receive(svc, { id: "RCPT-1", itemId: "ITEM-A", qty: "10", unitCost: "10.00", batchNo: "B-LATE", expiryDate: "2027-01-31", on: "2026-08-01T00:00:00.000Z" });
  await receive(svc, { id: "RCPT-2", itemId: "ITEM-A", qty: "5", unitCost: "12.00", batchNo: "B-EARLY", expiryDate: "2026-09-30", on: "2026-08-02T00:00:00.000Z" });
  await receive(svc, { id: "RCPT-3", itemId: "ITEM-A", qty: "5", unitCost: "14.00", batchNo: "B-NONE", expiryDate: null, on: "2026-08-03T00:00:00.000Z" });
  await receive(svc, { id: "RCPT-4", itemId: "ITEM-A", qty: "10", unitCost: "16.00", batchNo: "B-MID", expiryDate: "2026-11-30", on: "2026-08-04T00:00:00.000Z" });
}

describe("FEFO: an issue draws the earliest expiry first, whatever order the receipts arrived", () => {
  it("consumes B-EARLY, then B-MID, then B-LATE, and leaves the no-expiry batch untouched", async () => {
    const { svc, layers } = harness();
    await seedFourBatches(svc);

    const before = await svc.getBalanceDetail("ITEM-A", WH1);
    expect(before.onHand.toString()).toBe("30.000000");
    expect(before.totalValue.toString()).toBe("390.000000");
    expect(before.averageCost.toString()).toBe("13.000000");

    // 18 units out: all 5 of B-EARLY, all 10 of B-MID, 3 of B-LATE.
    await svc.postIssue({
      issueId: "ISS-1",
      warehouseId: WH1,
      sourceDocType: "SALES_INVOICE",
      sourceDocId: "INV-1",
      occurredAt: "2026-08-10T00:00:00.000Z",
      lines: [{ itemId: "ITEM-A", qty: Qty.fromMajor("18") }],
    });

    const surviving = (await layers.listByPosition("ITEM-A", WH1)).map((l) => [l.id, l.batchNo, l.remainingQty.toString()]);
    expect(surviving).toEqual([
      ["RCPT-1:0", "B-LATE", "7.000000"],
      ["RCPT-3:0", "B-NONE", "5.000000"],
    ]);
  });

  it("names the consumed batches IN ORDER when the issue is a transfer that re-lays them down", async () => {
    const { svc, layers } = harness();
    await seedFourBatches(svc);

    // A transfer carries the consumed slices to the destination in the order
    // they were drawn, so the destination layers ARE the consumption order.
    await svc.postTransfer({
      transferId: "TRF-1",
      fromWarehouseId: WH1,
      toWarehouseId: WH2,
      occurredAt: "2026-08-10T00:00:00.000Z",
      lines: [{ itemId: "ITEM-A", qty: Qty.fromMajor("18") }],
    });

    const moved = (await layers.listByPosition("ITEM-A", WH2)).map((l) => [l.id, l.batchNo, l.expiryDate, l.remainingQty.toString()]);
    expect(moved).toEqual([
      ["TRF-1:in:0:layer:0", "B-EARLY", "2026-09-30", "5.000000"],
      ["TRF-1:in:0:layer:1", "B-MID", "2026-11-30", "10.000000"],
      ["TRF-1:in:0:layer:2", "B-LATE", "2027-01-31", "3.000000"],
    ]);
  });

  it("issues at the moving average, not at the consumed layers own costs", async () => {
    const { svc } = harness();
    await seedFourBatches(svc);

    const result = await svc.postIssue({
      issueId: "ISS-2",
      warehouseId: WH1,
      sourceDocType: "SALES_INVOICE",
      sourceDocId: "INV-2",
      occurredAt: "2026-08-10T00:00:00.000Z",
      lines: [{ itemId: "ITEM-A", qty: Qty.fromMajor("18") }],
    });

    // FEFO picked 5 x 12.00 + 10 x 16.00 + 3 x 10.00 = 250.00 of layer cost.
    // The books move 18 x 13.00 instead — the weighted average.
    expect(result.totalCost.toString()).toBe("234.000000");
    expect(result.lines[0]!.unitCost.toString()).toBe("13.000000");

    const after = await svc.getBalanceDetail("ITEM-A", WH1);
    expect(after.onHand.toString()).toBe("12.000000");
    expect(after.totalValue.toString()).toBe("156.000000");
    expect(after.averageCost.toString()).toBe("13.000000");
  });
});

describe("an EXPIRED batch at the head of the FEFO queue", () => {
  async function seedExpired(svc: StockLedgerService): Promise<void> {
    await receive(svc, { id: "RCPT-E1", itemId: "ITEM-B", qty: "4", unitCost: "20.00", batchNo: "B-DEAD", expiryDate: "2026-08-05", on: "2026-08-01T00:00:00.000Z" });
    await receive(svc, { id: "RCPT-E2", itemId: "ITEM-B", qty: "6", unitCost: "20.00", batchNo: "B-GOOD", expiryDate: "2027-01-31", on: "2026-08-02T00:00:00.000Z" });
  }

  it("names the item and warehouse in the refusal instead of their ids (#139)", async () => {
    const { svc } = harness({
      stockLabels: async (itemId, warehouseId) => {
        expect([itemId, warehouseId]).toEqual(["ITEM-B", WH1]);
        return { item: "P-001 - باراسيتامول", warehouse: "المخزن الرئيسي" };
      },
    });
    await seedExpired(svc);

    const refusal = svc.postIssue({
      issueId: "ISS-N",
      warehouseId: WH1,
      sourceDocType: "SALES_INVOICE",
      sourceDocId: "INV-N",
      occurredAt: "2026-08-10T00:00:00.000Z",
      lines: [{ itemId: "ITEM-B", qty: Qty.fromMajor("2") }],
    });
    await expect(refusal).rejects.toThrow(/الصنف "P-001 - باراسيتامول" في المستودع "المخزن الرئيسي"/);
    await expect(refusal).rejects.toMatchObject({ itemId: "ITEM-B", warehouseId: WH1 });
  });

  it("still refuses with the ids when the name lookup fails", async () => {
    const { svc } = harness({ stockLabels: async () => { throw new Error("db down"); } });
    await seedExpired(svc);

    await expect(
      svc.postIssue({
        issueId: "ISS-F",
        warehouseId: WH1,
        sourceDocType: "SALES_INVOICE",
        sourceDocId: "INV-F",
        occurredAt: "2026-08-10T00:00:00.000Z",
        lines: [{ itemId: "ITEM-B", qty: Qty.fromMajor("2") }],
      }),
    ).rejects.toThrow(/الصنف "ITEM-B" في المستودع "WH1"/);
  });

  it("REFUSES the issue outright — it does not skip the dead batch and sell the good one", async () => {
    const { svc, layers } = harness();
    await seedExpired(svc);

    await expect(
      svc.postIssue({
        issueId: "ISS-X",
        warehouseId: WH1,
        sourceDocType: "SALES_INVOICE",
        sourceDocId: "INV-X",
        occurredAt: "2026-08-10T00:00:00.000Z",
        lines: [{ itemId: "ITEM-B", qty: Qty.fromMajor("2") }],
      }),
    ).rejects.toBeInstanceOf(ExpiredStockError);

    // Nothing moved: both layers are whole and the position is untouched.
    const untouched = (await layers.listByPosition("ITEM-B", WH1)).map((l) => [l.batchNo, l.remainingQty.toString()]);
    expect(untouched).toEqual([
      ["B-DEAD", "4.000000"],
      ["B-GOOD", "6.000000"],
    ]);
    const balance = await svc.getBalanceDetail("ITEM-B", WH1);
    expect(balance.onHand.toString()).toBe("10.000000");
    expect(balance.totalValue.toString()).toBe("200.000000");
  });

  it("still allows an issue dated ON the expiry date — the goods expire at the END of that day", async () => {
    const { svc } = harness();
    await seedExpired(svc);

    const result = await svc.postIssue({
      issueId: "ISS-ONDAY",
      warehouseId: WH1,
      sourceDocType: "SALES_INVOICE",
      sourceDocId: "INV-ONDAY",
      occurredAt: "2026-08-05T00:00:00.000Z",
      lines: [{ itemId: "ITEM-B", qty: Qty.fromMajor("2") }],
    });
    expect(result.totalCost.toString()).toBe("40.000000");
  });

  it("refuses from one micro-day later — the boundary is the expiry date itself, inclusive", async () => {
    const { svc } = harness();
    await seedExpired(svc);

    await expect(
      svc.postIssue({
        issueId: "ISS-NEXTDAY",
        warehouseId: WH1,
        sourceDocType: "SALES_INVOICE",
        sourceDocId: "INV-NEXTDAY",
        occurredAt: "2026-08-06T00:00:00.000Z",
        lines: [{ itemId: "ITEM-B", qty: Qty.fromMajor("2") }],
      }),
    ).rejects.toBeInstanceOf(ExpiredStockError);
  });

  it("LIMITATION: a TRANSFER of the same expired stock is not refused, only a sale is", async () => {
    const { svc, layers } = harness();
    await seedExpired(svc);

    // postIssue calls refuseExpiredStock; postTransfer and postAdjustment do
    // not. Expired goods therefore cannot be sold out of WH1, but can be
    // walked to WH2 first — where they arrive still carrying 2026-08-05 and
    // are refused again. The stock is movable but unsellable, and nothing on
    // the transfer says so.
    await svc.postTransfer({
      transferId: "TRF-DEAD",
      fromWarehouseId: WH1,
      toWarehouseId: WH2,
      occurredAt: "2026-08-10T00:00:00.000Z",
      lines: [{ itemId: "ITEM-B", qty: Qty.fromMajor("4") }],
    });

    const moved = (await layers.listByPosition("ITEM-B", WH2)).map((l) => [l.batchNo, l.expiryDate, l.remainingQty.toString()]);
    expect(moved).toEqual([["B-DEAD", "2026-08-05", "4.000000"]]);

    await expect(
      svc.postIssue({
        issueId: "ISS-WH2",
        warehouseId: WH2,
        sourceDocType: "SALES_INVOICE",
        sourceDocId: "INV-WH2",
        occurredAt: "2026-08-10T00:00:00.000Z",
        lines: [{ itemId: "ITEM-B", qty: Qty.fromMajor("1") }],
      }),
    ).rejects.toBeInstanceOf(ExpiredStockError);
  });
});
