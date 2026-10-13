import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const EGP = 1_000_000n;
const RECEIVED_ON = "2026-10-01";
const INVOICED_ON = "2026-10-08";
const position = (itemId: string) =>
  world.sqlite.prepare(`SELECT on_hand AS qty, total_value AS value FROM wac_snapshot WHERE item_id = ? AND warehouse_id = 'WH-MAIN'`).safeIntegers().get(itemId) as { qty: bigint; value: bigint };
const drift = async (itemId: string) => String(((await world.request("GET", `/inventory/drift?itemId=${itemId}&warehouseId=WH-MAIN`)).body as { cacheDrift: string }).cacheDrift);
const issue = (id: string, itemId: string, qty: string, occurredAt: string) =>
  world.request("POST", "/inventory/adjustments", { adjustmentId: id, warehouseId: "WH-MAIN", reason: "DAMAGE", occurredAt, lines: [{ itemId, direction: "OUT", qty }] });

async function receivedAt100InvoicedAt110(tag: string): Promise<{ itemId: string; invoiceNo: string }> {
  const itemId = `${tag}-ITEM`;
  expect((await world.request("POST", "/items", { id: itemId, code: itemId, nameAr: `صنف ${itemId}`, type: "stock", baseUnitCode: "PCS" })).status).toBe(201);
  expect((await world.request("POST", "/purchases/orders", { id: `${tag}-PO`, supplierId: "SUPP-DEMO-1", date: RECEIVED_ON, branchId: "BR-MAIN", warehouseId: "WH-MAIN", lines: [{ itemId, qty: "10", unitPrice: "100" }] })).status).toBe(201);
  expect((await world.request("POST", `/purchases/orders/${tag}-PO/confirm`, {})).status).toBe(200);
  expect((await world.request("POST", "/purchases/receipts", { id: `${tag}-GRN`, purchaseOrderId: `${tag}-PO`, date: RECEIVED_ON })).status).toBe(201);
  expect((await world.request("POST", `/purchases/receipts/${tag}-GRN/confirm`, {})).status).toBe(200);
  expect(
    (await world.request("POST", "/purchases/invoices", {
      id: `${tag}-PI`, supplierId: "SUPP-DEMO-1", date: INVOICED_ON, dueDate: "2026-11-05", branchId: "BR-MAIN", warehouseId: "WH-MAIN", receiptId: `${tag}-GRN`,
      lines: [{ itemId, kind: "inventory", qty: "10", unitCost: "110", taxRatePercent: 0 }],
    })).status,
  ).toBe(201);
  const confirmed = await world.request("POST", `/purchases/invoices/${tag}-PI/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  expect(position(itemId)).toEqual({ qty: 10n * EGP, value: 1100n * EGP });
  return { itemId, invoiceNo: String(confirmed.body.number) };
}

describe("a stock movement dated before a purchase price variance the position has absorbed", () => {
  it("is refused in Arabic naming the invoice and the earliest day it may carry, and nothing moves", async () => {
    const { itemId, invoiceNo } = await receivedAt100InvoicedAt110("PVB-A");
    const movements = world.count("stock_movement");
    const entries = world.count("journal_entry");

    const refused = await issue("PVB-A-EARLY", itemId, "6", "2026-10-03");

    expect(`${refused.status} ${String(refused.body.error)}`, JSON.stringify(refused.body)).toBe("422 STOCK_MOVEMENT_BEFORE_COST_REVALUATION");
    expect(invoiceNo).toMatch(/\d/);
    expect(String(refused.body.message)).toContain(invoiceNo);
    expect(String(refused.body.message)).toContain(INVOICED_ON);
    expect(String(refused.body.message)).toMatch(/[؀-ۿ]/);
    expect(refused.body.earliestAllowedDate).toBe(INVOICED_ON);
    expect(world.count("stock_movement")).toBe(movements);
    expect(world.count("journal_entry")).toBe(entries);

    const issued = await issue("PVB-A-OK", itemId, "6", INVOICED_ON);
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);
    expect(position(itemId)).toEqual({ qty: 4n * EGP, value: 440n * EGP });
    expect((await world.request("POST", `/inventory/rebuild?itemId=${itemId}&warehouseId=WH-MAIN`, {})).status).toBe(200);
    expect(await drift(itemId)).toBe("0.000000");
    expect(position(itemId)).toEqual({ qty: 4n * EGP, value: 440n * EGP });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("is accepted on the earlier day once the invoice is cancelled and its variance taken back", async () => {
    const { itemId } = await receivedAt100InvoicedAt110("PVB-B");
    const cancelled = await world.request("POST", "/purchases/invoices/PVB-B-PI/cancel", {});
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(position(itemId)).toEqual({ qty: 10n * EGP, value: 1000n * EGP });

    const early = await issue("PVB-B-EARLY", itemId, "6", "2026-10-03");

    expect(early.status, JSON.stringify(early.body)).toBe(201);
    expect(position(itemId)).toEqual({ qty: 4n * EGP, value: 400n * EGP });
    expect((await world.request("POST", `/inventory/rebuild?itemId=${itemId}&warehouseId=WH-MAIN`, {})).status).toBe(200);
    expect(await drift(itemId)).toBe("0.000000");
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
