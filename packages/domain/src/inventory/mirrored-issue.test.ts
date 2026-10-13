import { describe, expect, it } from "vitest";
import { Money, Qty } from "../money/index.js";
import { StockLedgerService } from "./stock-ledger-service.js";
import { replay } from "./wac.js";
import { InMemoryCostLayers, InMemorySnapshots, InMemoryStockLedger } from "./test-helpers/in-memory-stores.js";

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
  const move = (sourceDocId: string, direction: "IN" | "OUT", qty: string, unitCost?: string, value?: string) =>
    service.applyDocumentStockPlan({
      sourceDocType: direction === "IN" ? "SALES_RETURN" : "SALES_INVOICE",
      sourceDocId,
      sourceDocNumber: sourceDocId,
      warehouseId: WAREHOUSE,
      lines: [{ itemId: ITEM, direction, qty: Qty.fromMajor(qty), unitCost: unitCost ? Money.fromMajor(unitCost) : undefined, value: value ? Money.fromMajor(value) : undefined }],
    });
  const position = async () => {
    const detail = await service.getBalanceDetail(ITEM, WAREHOUSE);
    return [detail.onHand.toString(), detail.totalValue.toString()];
  };
  const replayed = async () => {
    const again = replay(ITEM, WAREHOUSE, await ledger.listByPosition(ITEM, WAREHOUSE));
    return [again.onHand.toString(), again.totalValue.toString()];
  };
  return { move, position, replayed };
}

describe("an issue that mirrors a recorded receipt", () => {
  it("takes its share at the moving average once the position no longer holds the stored value, and hands the rest back to be booked", async () => {
    const { move, position, replayed } = world();
    await move("BUY-1", "IN", "2", "10");
    await move("SALE-1", "OUT", "2");
    await move("BUY-2", "IN", "2", "2");
    await move("RETURN-1", "IN", "2", "10");
    expect(await position()).toEqual(["4.000000", "24.000000"]);
    await move("SALE-2", "OUT", "1");
    expect(await position()).toEqual(["3.000000", "18.000000"]);

    const mirrored = await move("RETURN-1:void", "OUT", "2", undefined, "20");

    expect(await position()).toEqual(["1.000000", "6.000000"]);
    expect([mirrored.valueMoved.toString(), mirrored.unmirroredValue.toString()]).toEqual(["-12.000000", "8.000000"]);
    expect(await replayed()).toEqual(await position());

    await move("SALE-3", "OUT", "1");
    expect(await position()).toEqual(["0.000000", "0.000000"]);
  });

  it("puts a position back exactly where it stood when nothing moved in between, even above its average", async () => {
    const { move, position, replayed } = world();
    await move("BUY-1", "IN", "4", "6");
    await move("RETURN-1", "IN", "2", "10");
    expect(await position()).toEqual(["6.000000", "44.000000"]);

    const mirrored = await move("RETURN-1:void", "OUT", "2", undefined, "20");

    expect(await position()).toEqual(["4.000000", "24.000000"]);
    expect([mirrored.valueMoved.toString(), mirrored.unmirroredValue.toString()]).toEqual(["-20.000000", "0.000000"]);
    expect(await replayed()).toEqual(await position());
  });

  it("still takes exactly the stored value when the position holds at least that much", async () => {
    const { move, position, replayed } = world();
    await move("BUY-1", "IN", "2", "10");
    await move("BUY-2", "IN", "2", "30");
    await move("RETURN-1", "IN", "2", "10");
    expect(await position()).toEqual(["6.000000", "100.000000"]);

    const mirrored = await move("RETURN-1:void", "OUT", "2", undefined, "20");

    expect(await position()).toEqual(["4.000000", "80.000000"]);
    expect([mirrored.valueMoved.toString(), mirrored.unmirroredValue.toString()]).toEqual(["-20.000000", "0.000000"]);
    expect(await replayed()).toEqual(await position());
  });

  it("never leaves a stocked position below zero, whatever a plain issue's rounded average asks for", async () => {
    const { move, position } = world();
    await move("BUY-1", "IN", "4", "0.000001", "0.000002");
    await move("SALE-1", "OUT", "3");
    const [onHand, totalValue] = await position();
    expect(onHand).toBe("1.000000");
    expect(Money.fromMajor(totalValue as string).scaled >= 0n).toBe(true);
  });
});
