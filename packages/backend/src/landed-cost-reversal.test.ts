import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

const DAY = "2026-10-05";
const SCALE = 1_000_000n;

async function item(id: string) {
  expect((await world.request("POST", "/items", { id, code: id, nameAr: `صنف ${id}`, type: "stock", baseUnitCode: "PCS" })).status).toBe(201);
}
async function invoice(id: string, body: Record<string, unknown>) {
  expect((await world.request("POST", "/purchases/invoices", { id, supplierId: "SUPP-DEMO-1", date: DAY, dueDate: "2026-11-05", branchId: "BR-MAIN", warehouseId: "WH-MAIN", ...body })).status).toBe(201);
  expect((await world.request("POST", `/purchases/invoices/${id}/confirm`, {})).status).toBe(200);
}
const directInvoice = (id: string, itemId: string) => invoice(id, { lines: [{ itemId, kind: "inventory", qty: "10", unitCost: "50", taxRatePercent: 14 }] });
const draftLandedCost = (id: string, itemId: string, sourceInvoiceId: string, date = DAY) =>
  world.request("POST", "/landed-costs", {
    id, date, memo: "شحن", distributionMethod: "BY_VALUE",
    costItems: [{ costType: "SHIPPING", description: "نقل", amount: "100", supplierId: "SUPP-DEMO-1" }],
    targets: [{ itemId, warehouseId: "WH-MAIN", sourceInvoiceId, sourceInvoiceNumber: null, qty: "10", unitCost: "50" }],
  });
async function landedCost(id: string, itemId: string, sourceInvoiceId: string) {
  expect((await draftLandedCost(id, itemId, sourceInvoiceId)).status).toBe(201);
  const confirmed = await world.request("POST", `/landed-costs/${id}/confirm`, { absorptionDate: DAY });
  expect(confirmed.status).toBe(200);
  return (confirmed.body.document as { docNo: string }).docNo;
}
const layers = (itemId: string) =>
  world.sqlite.prepare(`SELECT source_doc_id AS owner, unit_cost AS unitCost, remaining_qty AS remaining FROM cost_layer WHERE item_id = ?`).safeIntegers().all(itemId) as { owner: string; unitCost: bigint; remaining: bigint }[];
const position = (itemId: string) =>
  world.sqlite.prepare(`SELECT on_hand AS onHand, total_value AS value FROM wac_snapshot WHERE item_id = ? AND warehouse_id = 'WH-MAIN'`).safeIntegers().get(itemId) as { onHand: bigint; value: bigint };

describe("a landed cost standing on a purchase", () => {
  it("holds the invoice against cancelling until the landed cost is reversed; reversing it restores the layer cost and the ledger exactly", async () => {
    const inventoryBase = world.balance("1200");
    await item("LCR-A");
    await directInvoice("LCR-PI1", "LCR-A");
    const docNo = await landedCost("LCR-LC1", "LCR-A", "LCR-PI1");
    expect(layers("LCR-A")).toEqual([{ owner: "LCR-PI1", unitCost: 60n * SCALE, remaining: 10n * SCALE }]);
    expect(world.balance("1200") - inventoryBase).toBe(600n * SCALE);

    const refused = await world.request("POST", "/purchases/invoices/LCR-PI1/cancel", {});

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      error: "LANDED_COST_STANDS_ON_DOCUMENT",
      message: `لا يمكن إلغاء مستند المشتريات "LCR-PI1" وعليه تكلفة إضافية مؤكدة (${docNo}). اعكس مستند التكلفة الإضافية أولاً ثم ألغِ المستند.`,
    });
    expect(String(refused.body.messageEn)).toContain(docNo);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    const reversed = await world.request("POST", "/landed-costs/LCR-LC1/reverse", {});
    expect(reversed.status).toBe(201);
    expect((reversed.body.original as { status: string }).status).toBe("reversed");
    expect(layers("LCR-A")).toEqual([{ owner: "LCR-PI1", unitCost: 50n * SCALE, remaining: 10n * SCALE }]);
    expect(position("LCR-A")).toEqual({ onHand: 10n * SCALE, value: 500n * SCALE });
    expect(world.balance("1200") - inventoryBase).toBe(500n * SCALE);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    expect((await world.request("POST", "/purchases/invoices/LCR-PI1/cancel", {})).status).toBe(200);
    expect(world.balance("1200")).toBe(inventoryBase);
    expect(position("LCR-A")).toEqual({ onHand: 0n, value: 0n });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("on an invoice raised from a receipt, raises the cost of the receipt's own layer, and the whole chain unwinds to nothing", async () => {
    const before = { inventory: world.balance("1200"), accrual: world.balance("2120"), payable: world.balance("2100") };
    await item("LCR-B");
    expect((await world.request("POST", "/purchases/orders", { id: "LCR-PO", supplierId: "SUPP-DEMO-1", date: DAY, branchId: "BR-MAIN", warehouseId: "WH-MAIN", lines: [{ itemId: "LCR-B", qty: "10", unitPrice: "50" }] })).status).toBe(201);
    await world.request("POST", "/purchases/orders/LCR-PO/confirm", {});
    await world.request("POST", "/purchases/receipts", { id: "LCR-GRN", purchaseOrderId: "LCR-PO", date: DAY });
    expect((await world.request("POST", "/purchases/receipts/LCR-GRN/confirm", {})).status).toBe(200);
    await invoice("LCR-PI2", { receiptId: "LCR-GRN" });
    await landedCost("LCR-LC2", "LCR-B", "LCR-PI2");

    expect(layers("LCR-B")).toEqual([{ owner: "LCR-GRN", unitCost: 60n * SCALE, remaining: 10n * SCALE }]);
    expect((await world.request("POST", "/purchases/invoices/LCR-PI2/cancel", {})).status).toBe(422);

    expect((await world.request("POST", "/landed-costs/LCR-LC2/reverse", {})).status).toBe(201);
    expect((await world.request("POST", "/purchases/invoices/LCR-PI2/cancel", {})).status).toBe(200);
    expect((await world.request("POST", "/purchases/receipts/LCR-GRN/cancel", {})).status).toBe(200);

    expect(position("LCR-B")).toEqual({ onHand: 0n, value: 0n });
    expect({ inventory: world.balance("1200"), accrual: world.balance("2120"), payable: world.balance("2100") }).toEqual(before);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("is reversed after goods have been issued at the raised cost: what left with them is credited back to cost of sales and stock still ties", async () => {
    await item("LCR-C");
    await directInvoice("LCR-PI3", "LCR-C");
    await landedCost("LCR-LC3", "LCR-C", "LCR-PI3");
    const sale = {
      id: "LCR-SI", date: DAY, dueDate: "2026-11-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
      lines: [{ lineId: "LCR-SI-L1", itemId: "LCR-C", itemNameAr: "صنف", isStock: true, qty: "3", unitPrice: "100", taxRatePercent: 14, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" }],
    };
    await world.request("POST", "/sales-invoices", sale);
    expect((await world.request("POST", "/sales-invoices/LCR-SI/confirm", {})).status).toBe(200);
    const reversed = await world.request("POST", "/landed-costs/LCR-LC3/reverse", {});

    expect(reversed.status, JSON.stringify(reversed.body)).toBe(201);
    expect((reversed.body.original as { status: string }).status).toBe("reversed");
    expect(world.count("journal_entry", "id LIKE '%:ISSUED'")).toBe(1);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("the date of a landed cost", () => {
  it("is kept when earlier than the latest stock movement of a targeted position: the stock takes the cost no earlier than that movement", async () => {
    await item("LCR-D");
    await directInvoice("LCR-PI4", "LCR-D");
    expect((await draftLandedCost("LCR-LC4", "LCR-D", "LCR-PI4", "2026-10-01")).status).toBe(201);

    const confirmed = await world.request("POST", "/landed-costs/LCR-LC4/confirm", {});

    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const document = confirmed.body.document as { date: string; absorptionDate: string };
    expect(document.date).toBe("2026-10-01");
    expect(document.absorptionDate >= "2026-10-05").toBe(true);
    const asOf = (await world.request("GET", "/reconciliation?asOf=2026-10-04")).body.rows as { key: string; difference: string }[];
    expect(asOf.find((row) => row.key === "inventory")?.difference).toBe("0.000000");
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
