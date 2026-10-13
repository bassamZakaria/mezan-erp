import { describe, expect, it } from "vitest";
import { Money, Qty } from "../money/index.js";
import { InvalidStockMovementError } from "./errors.js";
import { StockLedgerService } from "./stock-ledger-service.js";
import { replay } from "./wac.js";
import { InMemoryCostLayers, InMemorySnapshots, InMemoryStockLedger } from "./test-helpers/in-memory-stores.js";

const ITEM = "I1";
const WAREHOUSE = "WH1";

function world() {
  const ledger = new InMemoryStockLedger();
  const layers = new InMemoryCostLayers();
  const service = new StockLedgerService({
    ledger,
    layers,
    snapshots: new InMemorySnapshots(),
    policy: { allowNegativeStock: true },
    clock: () => "2026-08-21T00:00:00.000Z",
  });
  const move = (sourceDocId: string, direction: "IN" | "OUT", qty: string, unitCost?: string) =>
    service.applyDocumentStockPlan({
      sourceDocType: direction === "IN" ? "PURCHASE_RECEIPT" : "SALES_INVOICE",
      sourceDocId,
      sourceDocNumber: sourceDocId,
      warehouseId: WAREHOUSE,
      lines: [{ itemId: ITEM, direction, qty: Qty.fromMajor(qty), unitCost: unitCost ? Money.fromMajor(unitCost) : undefined }],
    });
  const receive = (receiptId: string, qty: string, unitCost: string) =>
    service.postReceipt({ receiptId, receiptNumber: receiptId, warehouseId: WAREHOUSE, sourceDocType: "PURCHASE_RECEIPT", lines: [{ itemId: ITEM, qty: Qty.fromMajor(qty), unitCost: Money.fromMajor(unitCost) }] });
  const position = async () => {
    const detail = await service.getBalanceDetail(ITEM, WAREHOUSE);
    return [detail.onHand.toString(), detail.totalValue.toString()];
  };
  const replayed = async () => {
    const again = replay(ITEM, WAREHOUSE, await ledger.listByPosition(ITEM, WAREHOUSE));
    return { position: [again.onHand.toString(), again.totalValue.toString()], layers: again.layers.filter((layer) => !layer.remainingQty.isZero()).map((layer) => [layer.remainingQty.toString(), layer.unitCost.toString()]) };
  };
  const standingLayers = async () => (await layers.listByPosition(ITEM, WAREHOUSE)).filter((layer) => !layer.remainingQty.isZero()).map((layer) => [layer.remainingQty.toString(), layer.unitCost.toString()]);
  return { service, move, receive, position, replayed, standingLayers };
}

describe("a back-order covered by a receipt", () => {
  it("is level in quantity and value when the goods arrive at the cost the shortfall was sold at, with nothing left to book", async () => {
    const { move, position } = world();
    await move("GRN-1", "IN", "1", "100");
    await move("INV-1", "OUT", "4");
    expect(await position()).toEqual(["-3.000000", "-300.000000"]);
    const covered = await move("GRN-2", "IN", "3", "100");
    expect(await position()).toEqual(["0.000000", "0.000000"]);
    expect(covered.unmirroredValue.toString()).toBe("0.000000");
  });

  it("is level in value too when the goods arrive at another cost: the receipt takes what the shortfall carried and hands back the difference to book", async () => {
    const { move, position, replayed, standingLayers } = world();
    await move("GRN-1", "IN", "1", "100");
    await move("INV-1", "OUT", "4");
    const covered = await move("GRN-2", "IN", "3", "90");
    expect(await position()).toEqual(["0.000000", "0.000000"]);
    expect([covered.valueMoved.toString(), covered.unmirroredValue.toString()]).toEqual(["300.000000", "30.000000"]);
    expect(await standingLayers()).toEqual([]);
    expect(await replayed()).toEqual({ position: ["0.000000", "0.000000"], layers: [] });
  });

  it("brings the goods beyond the shortfall in at their own cost, as the only layer", async () => {
    const { receive, move, position, replayed, standingLayers } = world();
    await move("GRN-1", "IN", "1", "100");
    await move("INV-1", "OUT", "4");
    const received = await receive("GRN-2", "5", "90");
    expect(await position()).toEqual(["2.000000", "180.000000"]);
    expect(received.coverVariance.toString()).toBe("-30.000000");
    expect(await standingLayers()).toEqual([["2.000000", "90.000000"]]);
    expect(await replayed()).toEqual({ position: ["2.000000", "180.000000"], layers: [["2.000000", "90.000000"]] });
  });

  it("covers part of a shortfall with exactly its share of what the shortfall carried", async () => {
    const { receive, move, position, standingLayers } = world();
    await move("GRN-1", "IN", "1", "100");
    await move("INV-1", "OUT", "4");
    const received = await receive("GRN-2", "2", "90");
    expect(await position()).toEqual(["-1.000000", "-100.000000"]);
    expect(received.coverVariance.toString()).toBe("-20.000000");
    expect(await standingLayers()).toEqual([]);
    const rest = await receive("GRN-3", "1", "130");
    expect(await position()).toEqual(["0.000000", "0.000000"]);
    expect(rest.coverVariance.toString()).toBe("30.000000");
  });

  it("refuses to take back a receipt whose goods covered a back-order: they have left the building", async () => {
    const { service, receive, move, position } = world();
    await move("GRN-1", "IN", "1", "100");
    await move("INV-1", "OUT", "4");
    await receive("GRN-2", "5", "90");
    const before = await position();
    const refusal = await service
      .reverseReceipt({ reversalId: "GRN-2:cancel", sourceDocType: "PURCHASE_RECEIPT", sourceDocId: "GRN-2", positions: [{ itemId: ITEM, warehouseId: WAREHOUSE }] })
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(InvalidStockMovementError);
    expect((refusal as Error).message).toMatch(/[؀-ۿ]/);
    expect(await position()).toEqual(before);
  });
});

describe("the transfers of one work order that each level a shortfall", () => {
  it("book their difference under each transfer's own entry, never twice under the order's", async () => {
    const entries: { id: string; inventory: string }[] = [];
    const service = new StockLedgerService({
      ledger: new InMemoryStockLedger(),
      layers: new InMemoryCostLayers(),
      snapshots: new InMemorySnapshots(),
      policy: { allowNegativeStock: true },
      clock: () => "2026-08-21T00:00:00.000Z",
      transferCoverAccounts: { inventoryAccountId: "1200", costAccountId: "5100" },
      gl: {
        async post(posting) {
          if (entries.some((entry) => entry.id === posting.sourceDocId)) throw new Error(`duplicate journal entry ${posting.sourceDocId}`);
          const inventory = posting.lines.find((line) => line.accountId === "1200")!;
          entries.push({ id: posting.sourceDocId, inventory: inventory.debit.add(inventory.credit.negate()).toString() });
        },
      },
    });
    const plan = (sourceDocId: string, warehouseId: string, direction: "IN" | "OUT", qty: string, unitCost?: string) =>
      service.applyDocumentStockPlan({ sourceDocType: direction === "IN" ? "PURCHASE_RECEIPT" : "SALES_INVOICE", sourceDocId, sourceDocNumber: sourceDocId, warehouseId, lines: [{ itemId: ITEM, direction, qty: Qty.fromMajor(qty), unitCost: unitCost ? Money.fromMajor(unitCost) : undefined }] });
    await plan("GRN-WIP", "WIP", "IN", "1", "100");
    await plan("INV-WIP", "WIP", "OUT", "3");
    await plan("GRN-MAIN", WAREHOUSE, "IN", "10", "90");
    const transfer = (transferId: string) =>
      service.postTransfer({ transferId, sourceDocType: "WORK_ORDER", sourceDocId: "WO-1", transferNumber: "WO-1", fromWarehouseId: WAREHOUSE, toWarehouseId: "WIP", lines: [{ itemId: ITEM, qty: Qty.fromMajor("1") }] });

    await transfer("WO-ISSUE:WO-1");
    await transfer("WO-EXTRA:WO-1");

    expect(entries).toEqual([
      { id: "WO-ISSUE:WO-1:cover", inventory: "10.000000" },
      { id: "WO-EXTRA:WO-1:cover", inventory: "10.000000" },
    ]);
    const wip = await service.getBalanceDetail(ITEM, "WIP");
    expect([wip.onHand.toString(), wip.totalValue.toString()]).toEqual(["0.000000", "0.000000"]);
  });
});
