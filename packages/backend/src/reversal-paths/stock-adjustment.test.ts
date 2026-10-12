import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";
import { auditRows, entry, expectJournalRouteClosed, expectRefusedInClosedPeriod } from "./world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const EGP = 1_000_000n;
const position = (itemId = "ITEM-DEMO-1") =>
  world.sqlite.prepare(`SELECT on_hand AS qty, total_value AS value FROM wac_snapshot WHERE item_id = ? AND warehouse_id = 'WH-MAIN'`).safeIntegers().get(itemId) as { qty: bigint; value: bigint };
const line = (direction: "IN" | "OUT", qty: string, unitCost?: string) => ({ itemId: "ITEM-DEMO-1", warehouseId: "WH-MAIN", reason: "OTHER", direction, qty, ...(unitCost ? { unitCost } : {}) });
const inventoryAsOf = async (asOf: string) => ((await world.request("GET", `/reconciliation?asOf=${asOf}`)).body.rows as { key: string; difference: string }[]).find((r) => r.key === "inventory")?.difference;

describe("reversing a stock adjustment document", () => {
  it("takes an increase back out at what the stock is carried at, and the ledger follows the stock to the piastre", async () => {
    const before = { position: position(), inventory: world.balance("1200") };
    const drafted = await world.request("POST", "/inventory/stock-adjustments/draft", { id: "ADJ-REV-1", date: "2026-08-18", memo: "زيادة بالخطأ", lines: [line("IN", "10", "1.00")] });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    expect((await world.request("POST", "/inventory/stock-adjustments/ADJ-REV-1/confirm", {})).status).toBe(200);
    expect(position().qty - before.position.qty).toBe(10n * EGP);
    expect(world.balance("1200") - before.inventory).toBe(10n * EGP);
    await expectJournalRouteClosed(world, "ADJ-REV-1");
    await expectRefusedInClosedPeriod(world, "fp-2026-08", () => world.request("POST", "/inventory/stock-adjustments/ADJ-REV-1/reverse", {}));
    expect(position().qty - before.position.qty).toBe(10n * EGP);

    const reversed = await world.request("POST", "/inventory/stock-adjustments/ADJ-REV-1/reverse", {});

    expect(reversed.status, JSON.stringify(reversed.body)).toBe(201);
    expect((reversed.body.original as { status: string }).status).toBe("reversed");
    expect(entry(world, "ADJ-REV-1").status).toBe("reversed");
    expect(position().qty).toBe(before.position.qty);
    expect(world.balance("1200") - before.inventory).toBe(position().value - before.position.value);
    expect(auditRows(world, "STOCK_ADJUSTMENT", "ADJ-REV-1", "REVERSE")).toBe(1);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
    expect(await inventoryAsOf("2026-08-31")).toBe("0.000000");

    const again = await world.request("POST", "/inventory/stock-adjustments/ADJ-REV-1/reverse", {});
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(typeof again.body.messageEn).toBe("string");
  });

  it("puts a decrease back at the cost it left at", async () => {
    const before = { position: position(), inventory: world.balance("1200") };
    await world.request("POST", "/inventory/stock-adjustments/draft", { id: "ADJ-REV-2", date: "2026-08-19", lines: [line("OUT", "3")] });
    expect((await world.request("POST", "/inventory/stock-adjustments/ADJ-REV-2/confirm", {})).status).toBe(200);
    expect((await world.request("POST", "/inventory/stock-adjustments/ADJ-REV-2/reverse", {})).status).toBe(201);
    expect(position()).toEqual(before.position);
    expect(world.balance("1200")).toBe(before.inventory);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("reversing an adjustment posted through the direct route", () => {
  it("moves the stock back, mirrors the entry, and refuses a second reversal", async () => {
    const before = { position: position(), inventory: world.balance("1200") };
    const posted = await world.request("POST", "/inventory/adjustments", { adjustmentId: "ADJ-DIRECT-1", warehouseId: "WH-MAIN", reason: "DAMAGE", occurredAt: "2026-08-18", lines: [{ itemId: "ITEM-DEMO-1", direction: "OUT", qty: "2" }] });
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    expect(before.position.qty - position().qty).toBe(2n * EGP);
    await expectJournalRouteClosed(world, "ADJ-DIRECT-1");
    await expectRefusedInClosedPeriod(world, "fp-2026-08", () => world.request("POST", "/inventory/adjustments/ADJ-DIRECT-1/reverse", {}));

    const reversed = await world.request("POST", "/inventory/adjustments/ADJ-DIRECT-1/reverse", {});

    expect(reversed.status, JSON.stringify(reversed.body)).toBe(201);
    expect(position()).toEqual(before.position);
    expect(world.balance("1200")).toBe(before.inventory);
    expect(entry(world, "ADJ-DIRECT-1").status).toBe("reversed");
    expect(auditRows(world, "STOCK_ADJUSTMENT", "ADJ-DIRECT-1", "REVERSE")).toBe(1);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    const again = await world.request("POST", "/inventory/adjustments/ADJ-DIRECT-1/reverse", {});
    expect(`${again.status} ${String(again.body.error)}`).toBe("409 STOCK_ADJUSTMENT_ALREADY_REVERSED");
    expect(typeof again.body.messageEn).toBe("string");
  });

  it("sends an adjustment that has a document to that document's own reverse", async () => {
    await world.request("POST", "/inventory/stock-adjustments/draft", { id: "ADJ-REV-3", date: "2026-08-19", lines: [line("OUT", "1")] });
    await world.request("POST", "/inventory/stock-adjustments/ADJ-REV-3/confirm", {});
    const res = await world.request("POST", "/inventory/adjustments/ADJ-REV-3/reverse", {});
    expect(`${res.status} ${String(res.body.error)}`).toBe("409 STOCK_ADJUSTMENT_HAS_DOCUMENT");
    expect(typeof res.body.messageEn).toBe("string");
  });
});
