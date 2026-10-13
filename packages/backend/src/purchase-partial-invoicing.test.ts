import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

const DAY = "2026-10-05";
const SCALE = 1_000_000n;
const ACCOUNTS = ["1200", "2120", "5080", "2100"] as const;
type Balances = Record<(typeof ACCOUNTS)[number], bigint>;
const balances = () => Object.fromEntries(ACCOUNTS.map((id) => [id, world.balance(id)])) as Balances;
const moved = (before: Balances) => Object.fromEntries(ACCOUNTS.map((id) => [id, (world.balance(id) - before[id]) / SCALE])) as Balances;

type Line = readonly [itemId: string, qty: string, unitCost: string];

async function receive(tag: string, lines: readonly Line[]) {
  for (const [itemId] of lines) {
    expect((await world.request("POST", "/items", { id: itemId, code: itemId, nameAr: `صنف ${itemId}`, type: "stock", baseUnitCode: "PCS" })).status).toBe(201);
  }
  expect((await world.request("POST", "/purchases/orders", { id: `${tag}-PO`, supplierId: "SUPP-DEMO-1", date: DAY, branchId: "BR-MAIN", warehouseId: "WH-MAIN", lines: lines.map(([itemId, qty, unitPrice]) => ({ itemId, qty, unitPrice })) })).status).toBe(201);
  await world.request("POST", `/purchases/orders/${tag}-PO/confirm`, {});
  await world.request("POST", "/purchases/receipts", { id: `${tag}-GRN`, purchaseOrderId: `${tag}-PO`, date: DAY });
  expect((await world.request("POST", `/purchases/receipts/${tag}-GRN/confirm`, {})).status).toBe(200);
}

const invoiceBody = (tag: string, suffix: string, lines: readonly Line[] | null, date: string) => ({
  id: `${tag}-PI${suffix}`, supplierId: "SUPP-DEMO-1", date, dueDate: "2026-11-05", branchId: "BR-MAIN", warehouseId: "WH-MAIN", receiptId: `${tag}-GRN`,
  ...(lines ? { lines: lines.map(([itemId, qty, unitCost]) => ({ itemId, kind: "inventory", qty, unitCost, taxRatePercent: 0 })) } : {}),
});

async function invoice(tag: string, suffix: string, lines: readonly Line[] | null, date = DAY) {
  const created = await world.request("POST", "/purchases/invoices", invoiceBody(tag, suffix, lines, date));
  if (created.status !== 201) return created;
  return world.request("POST", `/purchases/invoices/${tag}-PI${suffix}/confirm`, {});
}

async function sell(tag: string, itemId: string, qty: string, date = DAY) {
  await world.request("POST", "/sales-invoices", {
    id: `${tag}-SI`, date, dueDate: "2026-11-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: `${tag}-SI-L1`, itemId, itemNameAr: "صنف", isStock: true, qty, unitPrice: "100", taxRatePercent: 14, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" }],
  });
  expect((await world.request("POST", `/sales-invoices/${tag}-SI/confirm`, {})).status).toBe(200);
}

const layerCost = (itemId: string) => (world.sqlite.prepare(`SELECT unit_cost AS c FROM cost_layer WHERE item_id = ?`).safeIntegers().all(itemId) as { c: bigint }[]).map((l) => l.c);
const receipt = async (tag: string) => (await world.request("GET", `/purchases/receipts/${tag}-GRN`)).body as { invoiced: boolean; invoicingStatus: string; lines: { itemId: string; invoicedQty: string; remainingQty: string }[] };

async function ties(asOf?: string) {
  const recon = (await world.request("GET", `/reconciliation${asOf ? `?asOf=${asOf}` : ""}`)).body as { rows: { key: string; difference: string }[] };
  return Object.fromEntries(["inventory", "ap", "grni"].map((key) => [key, recon.rows.find((r) => r.key === key)?.difference ?? "missing"]));
}
const TIED = { inventory: "0.000000", ap: "0.000000", grni: "0.000000" };

describe("partial invoicing of a goods receipt", () => {
  it("a short invoice relieves only what it bills and leaves the stock cost alone", async () => {
    await receive("PART-A", [["PART-A1", "10", "50"]]);
    const before = balances();

    expect((await invoice("PART-A", "", [["PART-A1", "8", "50"]])).status).toBe(200);

    expect(moved(before)).toEqual({ "1200": 0n, "2120": 400n, "5080": 0n, "2100": -400n });
    expect(layerCost("PART-A1")).toEqual([50n * SCALE]);
    const partly = await receipt("PART-A");
    expect(partly.invoiced).toBe(false);
    expect(partly.invoicingStatus).toBe("partially_invoiced");
    expect(partly.lines[0]).toMatchObject({ invoicedQty: "8.000000", remainingQty: "2.000000" });
    expect(await ties()).toEqual(TIED);

    expect((await invoice("PART-A", "2", [["PART-A1", "2", "50"]])).status).toBe(200);

    expect(moved(before)).toEqual({ "1200": 0n, "2120": 500n, "5080": 0n, "2100": -500n });
    const full = await receipt("PART-A");
    expect(full.invoiced).toBe(true);
    expect(full.invoicingStatus).toBe("invoiced");
    expect(await ties()).toEqual(TIED);
  });

  it("refuses an invoice for more than the receipt still has to bill", async () => {
    await receive("PART-B", [["PART-B1", "10", "50"]]);
    const before = balances();

    const over = await world.request("POST", "/purchases/invoices", invoiceBody("PART-B", "", [["PART-B1", "12", "50"]], DAY));

    expect(over.status).toBe(422);
    expect(over.body.error).toBe("INVOICE_EXCEEDS_RECEIPT");
    expect(String(over.body.message)).toMatch(/[؀-ۿ]/);
    expect(String(over.body.messageEn)).toContain("PART-B1");
    expect(moved(before)).toEqual({ "1200": 0n, "2120": 0n, "5080": 0n, "2100": 0n });
  });

  it("two drafts that together exceed the receipt cannot both confirm", async () => {
    await receive("PART-C", [["PART-C1", "10", "50"]]);
    expect((await world.request("POST", "/purchases/invoices", invoiceBody("PART-C", "", [["PART-C1", "7", "50"]], DAY))).status).toBe(201);
    expect((await world.request("POST", "/purchases/invoices", invoiceBody("PART-C", "2", [["PART-C1", "7", "50"]], DAY))).status).toBe(201);
    expect((await world.request("POST", "/purchases/invoices/PART-C-PI/confirm", {})).status).toBe(200);
    const before = balances();

    const second = await world.request("POST", "/purchases/invoices/PART-C-PI2/confirm", {});

    expect(second.status).toBe(422);
    expect(second.body.error).toBe("INVOICE_EXCEEDS_RECEIPT");
    expect(moved(before)).toEqual({ "1200": 0n, "2120": 0n, "5080": 0n, "2100": 0n });
  });

  it("invoicing one of two received items leaves the other's cost and accrual untouched", async () => {
    await receive("PART-D", [["PART-D1", "10", "50"], ["PART-D2", "10", "100"]]);
    const before = balances();

    expect((await invoice("PART-D", "", [["PART-D1", "10", "50"]])).status).toBe(200);

    expect(moved(before)).toEqual({ "1200": 0n, "2120": 500n, "5080": 0n, "2100": -500n });
    expect(layerCost("PART-D1")).toEqual([50n * SCALE]);
    expect(layerCost("PART-D2")).toEqual([100n * SCALE]);
    expect((await receipt("PART-D")).invoicingStatus).toBe("partially_invoiced");
    expect(await ties()).toEqual(TIED);
  });

  it("a price difference on one item changes that item's cost only", async () => {
    await receive("PART-E", [["PART-E1", "10", "50"], ["PART-E2", "10", "100"]]);

    expect((await invoice("PART-E", "", [["PART-E1", "10", "55"], ["PART-E2", "10", "100"]])).status).toBe(200);

    expect(layerCost("PART-E1")).toEqual([55n * SCALE]);
    expect(layerCost("PART-E2")).toEqual([100n * SCALE]);
    expect(await ties()).toEqual(TIED);
  });

  it("the bare receiptId request bills exactly what is left", async () => {
    await receive("PART-F", [["PART-F1", "10", "50"], ["PART-F2", "4", "25"]]);
    expect((await invoice("PART-F", "", [["PART-F1", "8", "50"], ["PART-F2", "4", "25"]])).status).toBe(200);
    const before = balances();

    expect((await invoice("PART-F", "2", null)).status).toBe(200);

    const rest = (await world.request("GET", "/purchases/invoices/PART-F-PI2")).body as { lines: { itemId: string; qty: string }[] };
    expect(rest.lines.map((l) => [l.itemId, l.qty])).toEqual([["PART-F1", "2.000000"]]);
    expect(moved(before)).toEqual({ "1200": 0n, "2120": 100n, "5080": 0n, "2100": -114n });
    expect((await receipt("PART-F")).invoicingStatus).toBe("invoiced");

    const none = await world.request("POST", "/purchases/invoices", invoiceBody("PART-F", "3", null, DAY));
    expect(none.status).toBe(422);
    expect(none.body.error).toBe("GOODS_RECEIPT_ALREADY_INVOICED");
  });

  it("the form's shape — a receipt and the quantity to bill per receipt line — bills that quantity at the receipt's cost", async () => {
    await receive("PART-I", [["PART-I1", "10", "50"], ["PART-I2", "5", "20"]]);
    const base = { id: "PART-I-PI", supplierId: "SUPP-DEMO-1", date: DAY, dueDate: "2026-11-05", branchId: "BR-MAIN", warehouseId: "WH-MAIN", receiptId: "PART-I-GRN" };

    const over = await world.request("POST", "/purchases/invoices", { ...base, id: "PART-I-PI0", receiptQuantities: [{ lineIndex: 0, qty: "11" }] });
    expect(`${over.status} ${String(over.body.error)}`).toBe("422 INVOICE_EXCEEDS_RECEIPT");
    const unknown = await world.request("POST", "/purchases/invoices", { ...base, id: "PART-I-PI0", receiptQuantities: [{ lineIndex: 7, qty: "1" }] });
    expect(`${unknown.status} ${String(unknown.body.error)}`).toBe("422 INVOICE_DOES_NOT_MATCH_RECEIPT");

    const created = await world.request("POST", "/purchases/invoices", { ...base, receiptQuantities: [{ lineIndex: 0, qty: "3" }] });
    expect(created.status).toBe(201);
    expect((created.body.lines as { itemId: string; qty: string; unitCost: string; taxRatePercent: number }[]).map((l) => [l.itemId, l.qty, l.unitCost, l.taxRatePercent])).toEqual([["PART-I1", "3.000000", "50.000000", 14]]);
    expect((await world.request("POST", "/purchases/invoices/PART-I-PI/confirm", {})).status).toBe(200);

    const after = await receipt("PART-I");
    expect(after.invoicingStatus).toBe("partially_invoiced");
    expect(after.lines.map((l) => l.remainingQty)).toEqual(["7.000000", "5.000000"]);
    expect(await ties()).toEqual(TIED);
  });

  it("cancelling one partial invoice restores exactly its quantities", async () => {
    await receive("PART-G", [["PART-G1", "10", "50"]]);
    const before = balances();
    expect((await invoice("PART-G", "", [["PART-G1", "6", "55"]])).status).toBe(200);
    expect((await invoice("PART-G", "2", [["PART-G1", "4", "50"]])).status).toBe(200);
    expect(moved(before)).toEqual({ "1200": 30n, "2120": 500n, "5080": 0n, "2100": -530n });

    expect((await world.request("POST", "/purchases/invoices/PART-G-PI/cancel", {})).status).toBe(200);

    expect(moved(before)).toEqual({ "1200": 0n, "2120": 200n, "5080": 0n, "2100": -200n });
    expect(layerCost("PART-G1")).toEqual([50n * SCALE]);
    const after = await receipt("PART-G");
    expect(after.invoicingStatus).toBe("partially_invoiced");
    expect(after.lines[0]).toMatchObject({ invoicedQty: "4.000000", remainingQty: "6.000000" });
    expect(await ties()).toEqual(TIED);

    const cancelReceipt = await world.request("POST", "/purchases/receipts/PART-G-GRN/cancel", {});
    expect(cancelReceipt.status).toBe(422);
  });

  it("a variance on goods partly issued on a later day lands on the goods still on hand, on a day stock and ledger share", async () => {
    await receive("PART-H", [["PART-H1", "10", "50"]]);
    await sell("PART-H", "PART-H1", "2", "2026-10-06");
    const before = balances();

    expect((await invoice("PART-H", "", [["PART-H1", "10", "55"]])).status).toBe(200);

    expect(moved(before)).toEqual({ "1200": 40n, "2120": 500n, "5080": 10n, "2100": -550n });
    expect(layerCost("PART-H1")).toEqual([55n * SCALE]);
    expect(await ties(DAY)).toEqual(TIED);
    expect(await ties("2026-10-06")).toEqual(TIED);
    expect(await ties()).toEqual(TIED);
  });
});
