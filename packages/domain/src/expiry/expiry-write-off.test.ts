import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { StockLedgerService } from "../inventory/stock-ledger-service.js";
import { InMemoryStockLedger, InMemoryCostLayers, InMemorySnapshots } from "../inventory/test-helpers/in-memory-stores.js";
import { ExpiryWriteOffExceedsExpiredError, expiredWriteOffLines } from "./write-off.js";
import { LotDetailsRequiredError } from "./lot-tracking.js";

const WH = "WH1";

function harness() {
  const layers = new InMemoryCostLayers();
  const svc = new StockLedgerService({
    ledger: new InMemoryStockLedger(),
    layers,
    snapshots: new InMemorySnapshots(),
    policy: { allowNegativeStock: false },
    clock: () => "2026-10-01T00:00:00.000Z",
    lotRequirement: async (itemId) => (itemId === "MED" ? { batch: true, expiry: true, labelAr: "دواء" } : null),
  });
  return { svc, layers };
}

async function receiveTwoBatches(svc: StockLedgerService) {
  await svc.postReceipt({
    receiptId: "R1",
    warehouseId: WH,
    sourceDocType: "PURCHASE_RECEIPT",
    occurredAt: "2026-08-01T00:00:00.000Z",
    lines: [{ itemId: "MED", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("10"), batchNo: "OLD", expiryDate: "2026-09-01" }],
  });
  await svc.postReceipt({
    receiptId: "R2",
    warehouseId: WH,
    sourceDocType: "PURCHASE_RECEIPT",
    occurredAt: "2026-08-02T00:00:00.000Z",
    lines: [{ itemId: "MED", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("20"), batchNo: "NEW", expiryDate: "2027-09-01" }],
  });
}

function writeOff(svc: StockLedgerService, id: string, qty: string) {
  return svc.postAdjustment({
    adjustmentId: id,
    warehouseId: WH,
    reason: "EXPIRY",
    occurredAt: "2026-10-01T00:00:00.000Z",
    lines: [{ itemId: "MED", direction: "OUT", qty: Qty.fromMajor(qty) }],
  });
}

describe("expiry write-off", () => {
  it("proposes exactly the expired batch, and the adjustment for it draws only that batch", async () => {
    const { svc, layers } = harness();
    await receiveTwoBatches(svc);
    const lines = expiredWriteOffLines({ layers: await layers.listByPosition("MED", WH), warehouseId: WH, asOf: "2026-10-01" });
    expect(lines.map((l) => [l.itemId, l.qty.toString(), l.batches.map((b) => b.batchNo)])).toEqual([["MED", "10.000000", ["OLD"]]]);

    await writeOff(svc, "ADJ-1", "10");
    const left = await layers.listByPosition("MED", WH);
    expect(left.filter((l) => !l.remainingQty.isZero()).map((l) => [l.batchNo, l.remainingQty.toString()])).toEqual([["NEW", "10.000000"]]);
  });

  it("refuses a second write-off of the same expired batch instead of consuming the in-date one", async () => {
    const { svc } = harness();
    await receiveTwoBatches(svc);
    await writeOff(svc, "ADJ-1", "10");
    await expect(writeOff(svc, "ADJ-2", "10")).rejects.toBeInstanceOf(ExpiryWriteOffExceedsExpiredError);
  });

  it("refuses a receipt of a batch- and expiry-tracked item that names neither", async () => {
    const { svc } = harness();
    await expect(
      svc.postReceipt({
        receiptId: "R3",
        warehouseId: WH,
        sourceDocType: "PURCHASE_RECEIPT",
        occurredAt: "2026-08-01T00:00:00.000Z",
        lines: [{ itemId: "MED", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("1") }],
      }),
    ).rejects.toBeInstanceOf(LotDetailsRequiredError);
  });
});
