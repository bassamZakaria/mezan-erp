import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

const DAY = "2026-10-05";
const GRNI = "2120";
const INVENTORY = "1200";
const PAYABLES = "2100";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

async function item(id: string): Promise<void> {
  expect((await world.request("POST", "/items", { id, code: id, nameAr: `صنف ${id}`, type: "stock", baseUnitCode: "PCS" })).status).toBe(201);
}

type Line = readonly [qty: string, cost: string];

async function receive(tag: string, itemId: string, lines: readonly Line[]): Promise<string> {
  const po = `${tag}-PO`;
  const grn = `${tag}-GRN`;
  expect(
    (await world.request("POST", "/purchases/orders", { id: po, supplierId: "SUPP-DEMO-1", date: DAY, branchId: "BR-MAIN", warehouseId: "WH-MAIN", lines: lines.map(([qty, unitPrice]) => ({ itemId, qty, unitPrice })) })).status,
  ).toBe(201);
  expect((await world.request("POST", `/purchases/orders/${po}/confirm`, {})).status).toBe(200);
  expect((await world.request("POST", "/purchases/receipts", { id: grn, purchaseOrderId: po, date: DAY })).status).toBe(201);
  expect((await world.request("POST", `/purchases/receipts/${grn}/confirm`, {})).status).toBe(200);
  return grn;
}

async function invoice(id: string, body: Record<string, unknown>): Promise<void> {
  const created = await world.request("POST", "/purchases/invoices", { id, supplierId: "SUPP-DEMO-1", date: DAY, dueDate: "2026-11-05", branchId: "BR-MAIN", warehouseId: "WH-MAIN", ...body });
  expect(`${created.status} ${created.status === 201 ? "" : JSON.stringify(created.body)}`.trim()).toBe("201");
  expect((await world.request("POST", `/purchases/invoices/${id}/confirm`, {})).status).toBe(200);
}

async function sell(id: string, itemId: string, qty: string): Promise<void> {
  expect(
    (
      await world.request("POST", "/sales-invoices", {
        id, date: DAY, dueDate: "2026-11-23", customerId: "CUST-DEMO-1", customerNameAr: "شركة الأمل للتجارة", warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
        lines: [{ lineId: "L1", itemId, itemNameAr: "صنف", isStock: true, qty, unitPrice: "100", taxRatePercent: 14, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: INVENTORY }],
      })
    ).status,
  ).toBe(201);
  expect((await world.request("POST", `/sales-invoices/${id}/confirm`, {})).status).toBe(200);
}

function position(itemId: string): { onHand: bigint; value: bigint; layers: number } {
  const snap = world.sqlite.prepare(`SELECT on_hand AS onHand, total_value AS value FROM wac_snapshot WHERE item_id = ? AND warehouse_id = 'WH-MAIN'`).safeIntegers().get(itemId) as { onHand: bigint; value: bigint } | undefined;
  return { onHand: snap?.onHand ?? 0n, value: snap?.value ?? 0n, layers: world.count("cost_layer", `item_id = '${itemId}'`) };
}

function books() {
  return {
    grni: world.balance(GRNI),
    inventory: world.balance(INVENTORY),
    payables: world.balance(PAYABLES),
    movements: world.count("stock_movement"),
    entries: world.count("journal_entry", "status <> 'draft'"),
  };
}

const lines = (itemId: string, rows: readonly Line[]) => rows.map(([qty, unitCost]) => ({ itemId, kind: "inventory", qty, unitCost, taxRatePercent: 14 }));

describe("cancelling a purchase invoice raised from a goods receipt", () => {
  it.each([
    { shape: "a bare receiptId, as the screen sends it", tag: "PC-A", body: (grn: string, _item: string) => ({ receiptId: grn }) },
    { shape: "a receiptId with explicit lines", tag: "PC-B", body: (grn: string, itemId: string) => ({ receiptId: grn, lines: lines(itemId, [["10", "50"]]) }) },
  ])("untouched goods, $shape: the invoice cancels, the goods stay with the receipt and the accrual stands again", async ({ tag, body }) => {
    const itemId = `${tag}-ITEM`;
    await item(itemId);
    const grn = await receive(tag, itemId, [["10", "50"]]);
    const received = books();
    await invoice(`${tag}-PI`, body(grn, itemId));
    expect(world.balance(GRNI)).toBe(received.grni + 500_000_000n);
    const movementsBefore = world.count("stock_movement");

    const cancelled = await world.request("POST", `/purchases/invoices/${tag}-PI/cancel`, {});

    expect(`${cancelled.status} ${cancelled.body.error ?? cancelled.body.status}`).toBe("200 cancelled");
    expect(world.count("stock_movement")).toBe(movementsBefore);
    expect(position(itemId)).toEqual({ onHand: 10_000_000n, value: 500_000_000n, layers: 1 });
    expect({ grni: world.balance(GRNI), inventory: world.balance(INVENTORY), payables: world.balance(PAYABLES) }).toEqual({ grni: received.grni, inventory: received.inventory, payables: received.payables });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("the receipt is free again after the cancel: it can be invoiced a second time", async () => {
    await invoice("PC-A-PI2", { receiptId: "PC-A-GRN" });
    expect((world.sqlite.prepare(`SELECT status FROM purchase_invoice WHERE id = 'PC-A-PI2'`).get() as { status: string }).status).toBe("confirmed");
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("goods already issued: the cancel is refused and nothing is written", async () => {
    await item("PC-C-ITEM");
    const grn = await receive("PC-C", "PC-C-ITEM", [["10", "50"]]);
    await invoice("PC-C-PI", { receiptId: grn });
    await sell("PC-C-SI", "PC-C-ITEM", "3");
    const before = books();

    const refused = await world.request("POST", "/purchases/invoices/PC-C-PI/cancel", {});

    expect(`${refused.status} ${refused.body.error}`).toBe("422 PURCHASE_ITEMS_ALREADY_CONSUMED");
    expect(refused.body.message).toContain("مرتجع مشتريات");
    expect(refused.body.messageEn).toContain("purchase return");
    expect(books()).toEqual(before);
    expect((world.sqlite.prepare(`SELECT status FROM purchase_invoice WHERE id = 'PC-C-PI'`).get() as { status: string }).status).toBe("confirmed");
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("cancelling a purchase invoice entered directly", () => {
  it("untouched goods: stock and payables leave together", async () => {
    await item("PC-D-ITEM");
    const before = books();
    await invoice("PC-D-PI", { lines: lines("PC-D-ITEM", [["10", "50"]]) });

    const cancelled = await world.request("POST", "/purchases/invoices/PC-D-PI/cancel", {});

    expect(`${cancelled.status} ${cancelled.body.error ?? cancelled.body.status}`).toBe("200 cancelled");
    expect(position("PC-D-ITEM")).toEqual({ onHand: 0n, value: 0n, layers: 0 });
    expect({ inventory: world.balance(INVENTORY), payables: world.balance(PAYABLES) }).toEqual({ inventory: before.inventory, payables: before.payables });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each([
    { issued: "3", name: "partly" },
    { issued: "10", name: "fully" },
  ])("goods $name issued: the cancel is refused and nothing is written", async ({ issued, name }) => {
    const tag = `PC-E-${name}`;
    await item(`${tag}-ITEM`);
    await invoice(`${tag}-PI`, { lines: lines(`${tag}-ITEM`, [["10", "50"]]) });
    await sell(`${tag}-SI`, `${tag}-ITEM`, issued);
    const before = books();

    const refused = await world.request("POST", `/purchases/invoices/${tag}-PI/cancel`, {});

    expect(`${refused.status} ${refused.body.error}`).toBe("422 PURCHASE_ITEMS_ALREADY_CONSUMED");
    expect(books()).toEqual(before);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("the same item on two lines of one purchase document", () => {
  const TWO_LINES: readonly Line[] = [["5", "50"], ["3", "60"]];

  it("an untouched invoice cancels: both layers leave at their own cost", async () => {
    await item("PC-F-ITEM");
    const before = books();
    await invoice("PC-F-PI", { lines: lines("PC-F-ITEM", TWO_LINES) });
    expect(position("PC-F-ITEM")).toEqual({ onHand: 8_000_000n, value: 430_000_000n, layers: 2 });

    const cancelled = await world.request("POST", "/purchases/invoices/PC-F-PI/cancel", {});

    expect(`${cancelled.status} ${cancelled.body.error ?? cancelled.body.status}`).toBe("200 cancelled");
    expect(position("PC-F-ITEM")).toEqual({ onHand: 0n, value: 0n, layers: 0 });
    expect({ inventory: world.balance(INVENTORY), payables: world.balance(PAYABLES) }).toEqual({ inventory: before.inventory, payables: before.payables });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("a partly issued invoice is still refused, with nothing written", async () => {
    await item("PC-G-ITEM");
    await invoice("PC-G-PI", { lines: lines("PC-G-ITEM", TWO_LINES) });
    await sell("PC-G-SI", "PC-G-ITEM", "6");
    const before = books();

    const refused = await world.request("POST", "/purchases/invoices/PC-G-PI/cancel", {});

    expect(`${refused.status} ${refused.body.error}`).toBe("422 PURCHASE_ITEMS_ALREADY_CONSUMED");
    expect(books()).toEqual(before);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("an untouched receipt cancels: both layers leave and the accrual is reversed", async () => {
    await item("PC-H-ITEM");
    const before = books();
    const grn = await receive("PC-H", "PC-H-ITEM", TWO_LINES);
    expect(position("PC-H-ITEM")).toEqual({ onHand: 8_000_000n, value: 430_000_000n, layers: 2 });

    const cancelled = await world.request("POST", `/purchases/receipts/${grn}/cancel`, {});

    expect(`${cancelled.status} ${cancelled.body.error ?? cancelled.body.status}`).toBe("200 cancelled");
    expect(position("PC-H-ITEM")).toEqual({ onHand: 0n, value: 0n, layers: 0 });
    expect({ grni: world.balance(GRNI), inventory: world.balance(INVENTORY) }).toEqual({ grni: before.grni, inventory: before.inventory });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("a partly issued receipt is still refused, with nothing written", async () => {
    await item("PC-I-ITEM");
    const grn = await receive("PC-I", "PC-I-ITEM", TWO_LINES);
    await sell("PC-I-SI", "PC-I-ITEM", "6");
    const before = books();

    const refused = await world.request("POST", `/purchases/receipts/${grn}/cancel`, {});

    expect(`${refused.status} ${refused.body.error}`).toBe("422 PURCHASE_ITEMS_ALREADY_CONSUMED");
    expect(books()).toEqual(before);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
