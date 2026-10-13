import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

afterAll(() => world?.close());

async function stockedItem(id: string, date: string): Promise<void> {
  expect((await world.request("POST", "/items", { id, code: id, nameAr: `صنف ${id}`, type: "stock", baseUnitCode: "PCS" })).status).toBe(201);
  expect(
    (await world.request("POST", "/inventory/stock-adjustments/draft", { id: `${id}-OPEN`, date, lines: [{ itemId: id, warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", direction: "IN", qty: "5", unitCost: "10" }] })).status,
  ).toBe(201);
  expect((await world.request("POST", `/inventory/stock-adjustments/${id}-OPEN/confirm`, {})).status).toBe(200);
}

async function transfer(id: string, itemId: string, date: string) {
  const draft = await world.request("POST", "/inventory/stock-transfers/draft", { id, date, lines: [{ itemId, fromWarehouseId: "WH-MAIN", toWarehouseId: "WH-WIP", qty: "1" }] });
  expect(`${draft.status} ${draft.status === 201 ? "" : JSON.stringify(draft.body)}`.trim()).toBe("201");
  return world.request("POST", `/inventory/stock-transfers/${id}/confirm`, {});
}

describe("a stock-only movement dated in a year no fiscal period covers", () => {
  beforeAll(async () => {
    world = await seededWorld();
    await stockedItem("SPC-ITEM", "2026-10-05");
  }, 120_000);

  it.each(["2031-03-01", "2019-03-01"])("%s is refused exactly as the ledger refuses it, and nothing moves", async (date) => {
    const movements = world.count("stock_movement");

    const refused = await transfer(`SPC-TR-${date}`, "SPC-ITEM", date);

    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({
      error: "NO_FISCAL_PERIOD_FOR_DATE",
      message: `لا توجد فترة محاسبية تغطي التاريخ "${date}".`,
      messageEn: `No fiscal period covers the date "${date}".`,
      date,
    });
    expect(world.count("stock_movement")).toBe(movements);
    expect((world.sqlite.prepare(`SELECT status FROM stock_transfer_document WHERE id = ?`).get(`SPC-TR-${date}`) as { status: string }).status).toBe("draft");
  });

  it("a date in an open month still moves", async () => {
    const moved = await transfer("SPC-TR-OPEN", "SPC-ITEM", "2026-10-06");
    expect(moved.status).toBe(200);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("a tenant that has generated no fiscal period at all", () => {
  it("still moves stock on any date: there is no calendar to be outside of", async () => {
    world.close();
    world = await seededWorld({ seedDemoData: false });
    await stockedItem("SPC-EMPTY", "2026-03-01");
    world.sqlite.exec(`DELETE FROM fiscal_period`);

    const moved = await transfer("SPC-TR-EMPTY", "SPC-EMPTY", "2031-03-01");

    expect(moved.status).toBe(200);
    expect(world.count("stock_movement", "source_doc_id = 'SPC-TR-EMPTY'")).toBe(2);
  });
});
