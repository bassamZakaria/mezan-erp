import { describe, expect, it } from "vitest";
import { Money, Qty } from "../money/index.js";
import { StockLedgerService } from "./stock-ledger-service.js";
import { InMemoryCostLayers, InMemorySnapshots, InMemoryStockLedger } from "./test-helpers/in-memory-stores.js";

const ITEM = "I1";
const WAREHOUSE = "WH1";

function world() {
  const service = new StockLedgerService({
    ledger: new InMemoryStockLedger(),
    layers: new InMemoryCostLayers(),
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
  const position = async () => {
    const detail = await service.getBalanceDetail(ITEM, WAREHOUSE);
    return [detail.onHand.toString(), detail.totalValue.toString()];
  };
  return { move, position };
}

describe("a back-order covered by a receipt (OPEN — the IN-side twin of the drained-position rule, D79)", () => {
  it("is level in quantity and value when the goods arrive at the cost the shortfall was sold at", async () => {
    const { move, position } = world();
    await move("GRN-1", "IN", "1", "100");
    await move("INV-1", "OUT", "4");
    expect(await position()).toEqual(["-3.000000", "-300.000000"]);
    await move("GRN-2", "IN", "3", "100");
    expect(await position()).toEqual(["0.000000", "0.000000"]);
  });

  // OPEN DEFECT, asserted as it stands so the fix has to flip it: a receipt
  // that levels a shortfall at ANOTHER cost leaves the difference on a
  // position holding nothing. The receipt has to take what the shortfall
  // carried and book the difference with its own entry.
  it("still leaves the cost difference on the empty position when the goods arrive at another cost", async () => {
    const { move, position } = world();
    await move("GRN-1", "IN", "1", "100");
    await move("INV-1", "OUT", "4");
    await move("GRN-2", "IN", "3", "90");
    expect(await position()).toEqual(["0.000000", "-30.000000"]);
  });
});
