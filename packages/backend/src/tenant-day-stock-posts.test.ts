import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => {
  vi.useRealTimers();
  world?.close();
});

const movementDays = (itemId: string) =>
  (world.sqlite.prepare(`SELECT DISTINCT substr(occurred_at, 1, 10) AS day FROM stock_movement WHERE item_id = ?`).all(itemId) as { day: string }[]).map((row) => row.day);
const entryDays = (where: string) => (world.sqlite.prepare(`SELECT DISTINCT date FROM journal_entry WHERE ${where}`).all() as { date: string }[]).map((row) => row.date);
const item = async (id: string) => expect((await world.request("POST", "/items", { id, code: id, nameAr: `صنف ${id}`, type: "stock", baseUnitCode: "PCS" })).status).toBe(201);

describe("half an hour after midnight in Cairo on the first of November", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T22:30:00.000Z"));
  });

  it("a stock adjustment and a transfer posted with no date are dated the first, on the stock ledger and in the general ledger alike", async () => {
    await item("TD-A");
    const inventoryOnTheLastOfOctober = world.balance("1200", "2026-10-31");
    const adjusted = await world.request("POST", "/inventory/adjustments", { adjustmentId: "TD-ADJ", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", lines: [{ itemId: "TD-A", direction: "IN", qty: "10", unitCost: "20" }] });
    expect(adjusted.status).toBe(201);
    const moved = await world.request("POST", "/inventory/transfers", { transferId: "TD-TR", fromWarehouseId: "WH-MAIN", toWarehouseId: "WH-DEMO-2", lines: [{ itemId: "TD-A", qty: "4" }] });
    expect(moved.status).toBe(201);

    expect(movementDays("TD-A")).toEqual(["2026-11-01"]);
    expect(entryDays(`source_doc_id = 'TD-ADJ'`)).toEqual(["2026-11-01"]);
    expect(world.balance("1200", "2026-10-31")).toBe(inventoryOnTheLastOfOctober);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("a work order issues, receives and completes on the first: its movements and its entries carry the tenant's day", async () => {
    await item("TD-RAW");
    await item("TD-FIN");
    expect((await world.request("POST", "/inventory/adjustments", { adjustmentId: "TD-ADJ-RAW", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", lines: [{ itemId: "TD-RAW", direction: "IN", qty: "50", unitCost: "25" }] })).status).toBe(201);
    expect((await world.request("POST", "/manufacturing/boms", { id: "TD-BOM", productItemId: "TD-FIN", standardQty: "1", unit: "PCS", lines: [{ itemId: "TD-RAW", qty: "2" }] })).status).toBe(201);
    expect((await world.request("POST", "/manufacturing/work-orders", { id: "TD-WO", bomId: "TD-BOM", plannedQty: "10", sourceWarehouseId: "WH-MAIN", wipWarehouseId: "WH-WIP", destinationWarehouseId: "WH-MAIN", scheduledStartDate: "2026-11-01" })).status).toBe(201);
    await world.request("POST", "/manufacturing/work-orders/TD-WO/start", {});
    expect((await world.request("POST", "/manufacturing/work-orders/TD-WO/issue", { lines: [{ itemId: "TD-RAW", qty: "20" }] })).status).toBe(200);
    expect((await world.request("POST", "/manufacturing/work-orders/TD-WO/log-waste", { lines: [{ itemId: "TD-RAW", qty: "1", notes: "تالف" }] })).status).toBe(200);
    expect((await world.request("POST", "/manufacturing/work-orders/TD-WO/receive", { producedQty: "10" })).status).toBe(200);
    expect((await world.request("POST", "/manufacturing/work-orders/TD-WO/complete", {})).status).toBe(200);

    expect(movementDays("TD-RAW")).toEqual(["2026-11-01"]);
    expect(movementDays("TD-FIN")).toEqual(["2026-11-01"]);
    expect(entryDays(`source_doc_id LIKE '%TD-WO%' OR id LIKE '%TD-WO%'`)).toEqual(["2026-11-01"]);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
