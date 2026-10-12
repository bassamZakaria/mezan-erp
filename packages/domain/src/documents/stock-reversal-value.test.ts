import { describe, expect, it } from "vitest";
import { Money, Qty } from "../money/index.js";
import { StockLedgerService } from "../inventory/stock-ledger-service.js";
import { InMemoryCostLayers, InMemorySnapshots, InMemoryStockLedger } from "../inventory/test-helpers/in-memory-stores.js";
import { replay } from "../inventory/wac.js";
import { createInventoryStockHook } from "./inventory-stock-hook.js";
import type { DocumentStockPlan } from "./hooks.js";

const ITEM = "I1";
const WAREHOUSE = "WH1";

function world() {
  const ledger = new InMemoryStockLedger();
  const service = new StockLedgerService({
    ledger,
    layers: new InMemoryCostLayers(),
    snapshots: new InMemorySnapshots(),
    policy: { allowNegativeStock: false },
    clock: () => "2026-08-21T00:00:00.000Z",
  });
  const hook = createInventoryStockHook(service);
  const plan = (sourceDocId: string, sourceDocType: string, lines: DocumentStockPlan["lines"]): DocumentStockPlan => ({
    sourceDocType, sourceDocId, sourceDocNumber: sourceDocId, warehouseId: WAREHOUSE, lines, date: "2026-08-21",
  });
  const receive = (docId: string, qty: string, unitCost: string) =>
    hook.apply(plan(docId, "PURCHASE_RECEIPT", [{ itemId: ITEM, direction: "IN", qty: Qty.fromMajor(qty), unitCost: Money.fromMajor(unitCost) }]));
  const position = async () => {
    const detail = await service.getBalanceDetail(ITEM, WAREHOUSE);
    return [detail.onHand.toString(), detail.totalValue.toString(), detail.averageCost.toString()];
  };
  const replayed = async () => {
    const again = replay(ITEM, WAREHOUSE, await ledger.listByPosition(ITEM, WAREHOUSE));
    return [again.onHand.toString(), again.totalValue.toString(), again.averageCost.toString()];
  };
  return { hook, plan, receive, position, replayed };
}

describe("a stock reversal mirrors the value the original movement moved, not quantity × its rounded unit cost", () => {
  it("puts back exactly what an issue that drained the position took, to the micro-unit", async () => {
    const { hook, plan, receive, position, replayed } = world();
    await receive("GRN-1", "1", "10");
    await receive("GRN-2", "2", "10.01");
    const before = await position();
    expect(before).toEqual(["3.000000", "30.020000", "10.006667"]);

    const issued = await hook.apply(plan("ISS-1", "SALES_INVOICE", [{ itemId: ITEM, direction: "OUT", qty: Qty.fromMajor("3") }]));
    expect(issued.valueMoved.toString()).toBe("-30.020000");
    expect((await position())[1]).toBe("0.000000");

    const reversed = await hook.reverse!(plan("ISS-1:void", "SALES_INVOICE", []), "ISS-1");
    expect(reversed.valueMoved.toString()).toBe("30.020000");
    expect(await position()).toEqual(before);
    expect(await replayed()).toEqual(before);
  });

  it("takes back out exactly what a return put in, when the position's average is not the return's cost", async () => {
    const { hook, plan, receive, position, replayed } = world();
    await receive("GRN-1", "10", "10");
    const before = await position();
    await hook.apply(plan("SR-1", "SALES_RETURN", [{ itemId: ITEM, direction: "IN", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("4") }]));
    expect(await position()).toEqual(["12.000000", "108.000000", "9.000000"]);

    const reversed = await hook.reverse!(plan("SR-1:void", "SALES_RETURN", []), "SR-1");
    expect(reversed.valueMoved.toString()).toBe("-8.000000");
    expect(await position()).toEqual(before);
    expect(await replayed()).toEqual(before);
  });

  it("empties the position when a mirrored issue is its last one out, and reports what the mirror asked for beyond what was there", async () => {
    const { hook, plan, receive, position, replayed } = world();
    await receive("GRN-1", "1", "5");
    await hook.apply(plan("SR-1", "SALES_RETURN", [{ itemId: ITEM, direction: "IN", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("10") }]));
    await hook.apply(plan("ISS-1", "SALES_INVOICE", [{ itemId: ITEM, direction: "OUT", qty: Qty.fromMajor("1") }]));
    expect(await position()).toEqual(["2.000000", "16.666667", "8.333334"]);

    const reversed = await hook.reverse!(plan("SR-1:void", "SALES_RETURN", []), "SR-1");

    expect(await position()).toEqual(["0.000000", "0.000000", "0.000000"]);
    expect(reversed.valueMoved.toString()).toBe("-16.666667");
    expect(reversed.unmirroredValue?.toString()).toBe("3.333333");
    expect(await replayed()).toEqual(await position());
  });

  it("reports nothing unmirrored when the mirrored issue leaves stock behind", async () => {
    const { hook, plan, receive } = world();
    await receive("GRN-1", "10", "10");
    await hook.apply(plan("SR-1", "SALES_RETURN", [{ itemId: ITEM, direction: "IN", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("4") }]));
    const reversed = await hook.reverse!(plan("SR-1:void", "SALES_RETURN", []), "SR-1");
    expect([reversed.valueMoved.toString(), reversed.unmirroredValue?.toString()]).toEqual(["-8.000000", "0.000000"]);
  });

  it("values an ordinary issue at the moving average, as before", async () => {
    const { hook, plan, receive, position, replayed } = world();
    await receive("GRN-1", "1", "10");
    await receive("GRN-2", "2", "10.01");
    const issued = await hook.apply(plan("ISS-2", "SALES_INVOICE", [{ itemId: ITEM, direction: "OUT", qty: Qty.fromMajor("1") }]));
    expect(issued.valueMoved.toString()).toBe("-10.006667");
    expect(await replayed()).toEqual(await position());
  });
});
