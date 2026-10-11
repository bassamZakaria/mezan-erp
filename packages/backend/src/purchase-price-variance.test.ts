import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

const DAY = "2026-10-05";
const SCALE = 1_000_000n;
const ACCOUNTS = ["1200", "2120", "5080", "2100"] as const;
const balances = () => Object.fromEntries(ACCOUNTS.map((id) => [id, world.balance(id)])) as Record<(typeof ACCOUNTS)[number], bigint>;
const moved = (before: ReturnType<typeof balances>) => Object.fromEntries(ACCOUNTS.map((id) => [id, (world.balance(id) - before[id]) / SCALE])) as Record<(typeof ACCOUNTS)[number], bigint>;

async function receive(tag: string) {
  const itemId = `${tag}-ITEM`;
  expect((await world.request("POST", "/items", { id: itemId, code: itemId, nameAr: `صنف ${itemId}`, type: "stock", baseUnitCode: "PCS" })).status).toBe(201);
  expect((await world.request("POST", "/purchases/orders", { id: `${tag}-PO`, supplierId: "SUPP-DEMO-1", date: DAY, branchId: "BR-MAIN", warehouseId: "WH-MAIN", lines: [{ itemId, qty: "10", unitPrice: "50" }] })).status).toBe(201);
  await world.request("POST", `/purchases/orders/${tag}-PO/confirm`, {});
  await world.request("POST", "/purchases/receipts", { id: `${tag}-GRN`, purchaseOrderId: `${tag}-PO`, date: DAY });
  expect((await world.request("POST", `/purchases/receipts/${tag}-GRN/confirm`, {})).status).toBe(200);
  return itemId;
}
async function invoiceAt(tag: string, itemId: string, unitCost: string, date = DAY) {
  const created = await world.request("POST", "/purchases/invoices", {
    id: `${tag}-PI`, supplierId: "SUPP-DEMO-1", date, dueDate: "2026-11-05", branchId: "BR-MAIN", warehouseId: "WH-MAIN", receiptId: `${tag}-GRN`,
    lines: [{ itemId, kind: "inventory", qty: "10", unitCost, taxRatePercent: 0 }],
  });
  expect(created.status).toBe(201);
  expect((await world.request("POST", `/purchases/invoices/${tag}-PI/confirm`, {})).status).toBe(200);
}
async function sell(tag: string, itemId: string, qty: string, date = DAY) {
  await world.request("POST", "/sales-invoices", {
    id: `${tag}-SI`, date, dueDate: "2026-11-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: `${tag}-SI-L1`, itemId, itemNameAr: "صنف", isStock: true, qty, unitPrice: "100", taxRatePercent: 14, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" }],
  });
  expect((await world.request("POST", `/sales-invoices/${tag}-SI/confirm`, {})).status).toBe(200);
}
const layerCost = (itemId: string) => (world.sqlite.prepare(`SELECT unit_cost AS c FROM cost_layer WHERE item_id = ?`).safeIntegers().all(itemId) as { c: bigint }[]).map((l) => l.c / SCALE);

describe("an invoice priced differently from its receipt", () => {
  it("clears the accrual to zero and carries the difference into the goods still on hand", async () => {
    const before = balances();
    const itemId = await receive("PPV-A");
    expect(moved(before)).toEqual({ "1200": 500n, "2120": -500n, "5080": 0n, "2100": 0n });

    await invoiceAt("PPV-A", itemId, "55");

    expect(moved(before)).toEqual({ "1200": 550n, "2120": 0n, "5080": 0n, "2100": -550n });
    expect(layerCost(itemId)).toEqual([55n]);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("an invoice cheaper than the receipt lowers the cost of the goods on hand", async () => {
    const before = balances();
    const itemId = await receive("PPV-B");
    await invoiceAt("PPV-B", itemId, "45");
    expect(moved(before)).toEqual({ "1200": 450n, "2120": 0n, "5080": 0n, "2100": -450n });
    expect(layerCost(itemId)).toEqual([45n]);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("sends the share of goods already issued to purchase price variance, never onto stock that is gone", async () => {
    const itemId = await receive("PPV-C");
    await sell("PPV-C", itemId, "4");
    const before = balances();

    await invoiceAt("PPV-C", itemId, "55");

    expect(moved(before)).toEqual({ "1200": 30n, "2120": 500n, "5080": 20n, "2100": -550n });
    expect(world.balance("2120")).toBe(world.balance("2120"));
    expect(layerCost(itemId)).toEqual([55n]);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("an invoice dated before a later movement of the goods expenses only the issued share; the goods on hand take theirs on a day stock and ledger share", async () => {
    const itemId = await receive("PPV-D");
    await sell("PPV-D", itemId, "1", "2026-10-08");
    const before = balances();
    const inventoryOnSaleDay = world.balance("1200", "2026-10-08");

    await invoiceAt("PPV-D", itemId, "55", "2026-10-06");

    expect(moved(before)).toEqual({ "1200": 45n, "2120": 500n, "5080": 5n, "2100": -550n });
    expect(world.balance("1200", "2026-10-08")).toBe(inventoryOnSaleDay);
    expect(layerCost(itemId)).toEqual([55n]);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("cancelling the invoice takes the difference back out of the goods and restores the accrual", async () => {
    const itemId = await receive("PPV-E");
    const afterReceipt = balances();
    await invoiceAt("PPV-E", itemId, "55");

    expect((await world.request("POST", "/purchases/invoices/PPV-E-PI/cancel", {})).status).toBe(200);

    expect(moved(afterReceipt)).toEqual({ "1200": 0n, "2120": 0n, "5080": 0n, "2100": 0n });
    expect(layerCost(itemId)).toEqual([50n]);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("an invoice at the received price posts no variance at all", async () => {
    const before = balances();
    const itemId = await receive("PPV-F");
    await invoiceAt("PPV-F", itemId, "50");
    expect(moved(before)).toEqual({ "1200": 500n, "2120": 0n, "5080": 0n, "2100": -500n });
    expect(world.count("stock_movement", `item_id = '${itemId}'`)).toBe(1);
  });
});
