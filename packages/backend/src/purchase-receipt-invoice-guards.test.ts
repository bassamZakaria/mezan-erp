import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE, toTenantDay } from "@mezan/domain";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

const DAY = "2026-10-05";
const SCALE = 1_000_000n;
const today = () => toTenantDay(new Date().toISOString(), DEFAULT_TIME_ZONE);

async function item(id: string) {
  expect((await world.request("POST", "/items", { id, code: id, nameAr: `صنف ${id}`, type: "stock", baseUnitCode: "PCS" })).status).toBe(201);
}

async function receive(tag: string, itemId: string, date = DAY) {
  await item(itemId);
  expect((await world.request("POST", "/purchases/orders", { id: `${tag}-PO`, supplierId: "SUPP-DEMO-1", date, branchId: "BR-MAIN", warehouseId: "WH-MAIN", lines: [{ itemId, qty: "10", unitPrice: "50" }] })).status).toBe(201);
  expect((await world.request("POST", `/purchases/orders/${tag}-PO/confirm`, {})).status).toBe(200);
  expect((await world.request("POST", "/purchases/receipts", { id: `${tag}-GRN`, purchaseOrderId: `${tag}-PO`, date })).status).toBe(201);
  expect((await world.request("POST", `/purchases/receipts/${tag}-GRN/confirm`, {})).status).toBe(200);
  return `${tag}-GRN`;
}

const draftInvoice = (id: string, body: Record<string, unknown>) =>
  world.request("POST", "/purchases/invoices", { id, supplierId: "SUPP-DEMO-1", date: DAY, dueDate: "2026-11-05", branchId: "BR-MAIN", warehouseId: "WH-MAIN", ...body });
const confirmInvoice = (id: string) => world.request("POST", `/purchases/invoices/${id}/confirm`, {});
const cancelInvoice = (id: string) => world.request("POST", `/purchases/invoices/${id}/cancel`, {});
const cancelReceipt = (id: string, body: unknown = {}) => world.request("POST", `/purchases/receipts/${id}/cancel`, body);
const receiptRow = (id: string) => world.sqlite.prepare(`SELECT status, invoiced FROM goods_receipt WHERE id = ?`).get(id) as { status: string; invoiced: number };
const invoiceStatus = (id: string) => (world.sqlite.prepare(`SELECT status FROM purchase_invoice WHERE id = ?`).get(id) as { status: string }).status;

describe("one receipt is invoiced once", () => {
  it("of two drafts raised on the same receipt, the second to confirm is refused and the accrual clears to zero once", async () => {
    const accrualBefore = world.balance("2120");
    const receiptId = await receive("G2A", "G2A-ITEM");
    expect((await draftInvoice("G2A-PI1", { receiptId })).status).toBe(201);
    expect((await draftInvoice("G2A-PI2", { receiptId })).status).toBe(201);

    expect((await confirmInvoice("G2A-PI1")).status).toBe(200);
    const second = await confirmInvoice("G2A-PI2");

    expect(second.status).toBe(422);
    expect(second.body).toEqual({
      error: "GOODS_RECEIPT_ALREADY_INVOICED",
      message: `إذن الاستلام "${receiptId}" فُوترت كل كمياته بفواتير مشتريات مؤكدة، ولا تُؤكَّد عليه فاتورة أخرى. ألغِ الفاتورة القائمة أولاً إن كانت هذه هي الصحيحة.`,
      messageEn: `Goods receipt "${receiptId}" is already fully billed by confirmed purchase invoices; another one cannot be confirmed against it. Cancel the standing invoice first if this is the right one.`,
    });
    expect(invoiceStatus("G2A-PI2")).toBe("draft");
    expect(world.balance("2120")).toBe(accrualBefore);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("a receipt carrying two confirmed invoices from before the guard stays invoiced when one is cancelled, and cannot be cancelled under the other", async () => {
    const receiptId = await receive("G2B", "G2B-ITEM");
    await draftInvoice("G2B-PI1", { receiptId });
    await draftInvoice("G2B-PI2", { receiptId });
    expect((await confirmInvoice("G2B-PI1")).status).toBe(200);
    world.sqlite.prepare(`UPDATE purchase_invoice SET status = 'confirmed' WHERE id = 'G2B-PI2'`).run();

    expect((await cancelInvoice("G2B-PI1")).status).toBe(200);

    expect(receiptRow(receiptId)).toEqual({ status: "confirmed", invoiced: 1 });
    const refused = await cancelReceipt(receiptId);
    expect(`${refused.status} ${String(refused.body.error)}`).toBe("422 GOODS_RECEIPT_ALREADY_INVOICED");
    expect(receiptRow(receiptId).status).toBe("confirmed");
    world.sqlite.prepare(`UPDATE purchase_invoice SET status = 'draft' WHERE id = 'G2B-PI2'`).run();
  });

  it("cancelling the only invoice frees the receipt to be invoiced again", async () => {
    const receiptId = await receive("G2C", "G2C-ITEM");
    await draftInvoice("G2C-PI1", { receiptId });
    expect((await confirmInvoice("G2C-PI1")).status).toBe(200);
    expect((await cancelInvoice("G2C-PI1")).status).toBe(200);
    expect(receiptRow(receiptId).invoiced).toBe(0);
    expect((await draftInvoice("G2C-PI2", { receiptId })).status).toBe(201);
    expect((await confirmInvoice("G2C-PI2")).status).toBe(200);
  });
});

describe("an invoice raised from a receipt bills that receipt's goods", () => {
  it("is refused at creation when its warehouse is not the receipt's", async () => {
    const receiptId = await receive("G6A", "G6A-ITEM");
    const refused = await draftInvoice("G6A-PI", { receiptId, warehouseId: "WH-DEMO-2" });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      error: "INVOICE_DOES_NOT_MATCH_RECEIPT",
      message: `فاتورة المشتريات لا تطابق إذن الاستلام "${receiptId}": مستودع الفاتورة "WH-DEMO-2" يختلف عن مستودع الاستلام "WH-MAIN".`,
    });
    expect(String(refused.body.messageEn)).toContain("WH-DEMO-2");
  });

  it("is refused at creation when it bills an item the receipt did not bring in", async () => {
    const receiptId = await receive("G6B", "G6B-ITEM");
    await item("G6B-OTHER");
    const refused = await draftInvoice("G6B-PI", { receiptId, lines: [{ itemId: "G6B-OTHER", kind: "inventory", qty: "1", unitCost: "50", taxRatePercent: 14 }] });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      error: "INVOICE_DOES_NOT_MATCH_RECEIPT",
      message: `فاتورة المشتريات لا تطابق إذن الاستلام "${receiptId}": الصنف "G6B-OTHER" غير موجود في إذن الاستلام.`,
    });
  });

  it("a service or freight line beside the received goods is still accepted", async () => {
    const receiptId = await receive("G6C", "G6C-ITEM");
    const created = await draftInvoice("G6C-PI", {
      receiptId,
      lines: [
        { itemId: "G6C-ITEM", kind: "inventory", qty: "10", unitCost: "50", taxRatePercent: 14 },
        { itemId: null, description: "نقل", kind: "freight", qty: "1", unitCost: "30", taxRatePercent: 0 },
      ],
    });
    expect(created.status).toBe(201);
  });

  it("an invoice already in the books under another warehouse cancels on the receipt's goods, and is still refused once those goods have moved", async () => {
    const receiptId = await receive("G6D", "G6D-ITEM");
    await draftInvoice("G6D-PI", { receiptId });
    expect((await confirmInvoice("G6D-PI")).status).toBe(200);
    world.sqlite.prepare(`UPDATE purchase_invoice SET warehouse_id = 'WH-DEMO-2' WHERE id = 'G6D-PI'`).run();
    const sale = {
      id: "G6D-SI", date: DAY, dueDate: "2026-11-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
      lines: [{ lineId: "G6D-SI-L1", itemId: "G6D-ITEM", itemNameAr: "صنف", isStock: true, qty: "3", unitPrice: "100", taxRatePercent: 14, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" }],
    };
    expect((await world.request("POST", "/sales-invoices", sale)).status).toBe(201);
    expect((await world.request("POST", "/sales-invoices/G6D-SI/confirm", {})).status).toBe(200);

    const refused = await cancelInvoice("G6D-PI");
    expect(`${refused.status} ${String(refused.body.error)}`).toBe("422 PURCHASE_ITEMS_ALREADY_CONSUMED");

    const untouched = await receive("G6E", "G6E-ITEM");
    await draftInvoice("G6E-PI", { receiptId: untouched });
    expect((await confirmInvoice("G6E-PI")).status).toBe(200);
    world.sqlite.prepare(`UPDATE purchase_invoice SET warehouse_id = 'WH-DEMO-2' WHERE id = 'G6E-PI'`).run();
    expect((await cancelInvoice("G6E-PI")).status).toBe(200);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("cancelling a receipt whose month has since closed", () => {
  const closeTies = async (periodId: string) => {
    const checks = (await world.request("GET", `/period-close/${periodId}/checks`)).body.checks as { code: string; findings?: { ref: string; amount: string }[] }[];
    return (checks.find((c) => c.code === "subledger_ties")?.findings ?? []).filter((f) => f.ref === "inventory").map((f) => f.amount);
  };

  it("is dated today on both the stock and the ledger, leaving August as it closed and every later day tied", async () => {
    const receiptId = await receive("G7A", "G7A-ITEM", "2026-08-10");
    const augustInventory = world.balance("1200", "2026-08-31");
    const augustAccrual = world.balance("2120", "2026-08-31");
    expect((await world.request("POST", "/fiscal-periods/fp-2026-08/close", { overrideReason: "تجاوز للاختبار بموافقة المدير المالي" })).status).toBe(200);

    const cancelled = await cancelReceipt(receiptId);

    expect(cancelled.status).toBe(200);
    const reversal = world.sqlite.prepare(`SELECT date FROM journal_entry WHERE id = ?`).all(`${receiptId}:cancel`) as { date: string }[];
    expect(reversal).toEqual([{ date: today() }]);
    const movement = world.sqlite.prepare(`SELECT substr(occurred_at, 1, 10) AS day FROM stock_movement WHERE item_id = 'G7A-ITEM' ORDER BY occurred_at DESC LIMIT 1`).get() as { day: string };
    expect(movement.day).toBe(today());
    expect(world.balance("1200", "2026-08-31")).toBe(augustInventory);
    expect(world.balance("2120", "2026-08-31")).toBe(augustAccrual);
    expect(await closeTies("fp-2026-08")).toEqual(["0.000000"]);
    expect(await closeTies("fp-2026-09")).toEqual(["0.000000"]);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("takes a stated cancel date, and refuses one before the receipt", async () => {
    const receiptId = await receive("G7B", "G7B-ITEM", "2026-09-10");
    const early = await cancelReceipt(receiptId, { date: "2026-09-01" });
    expect(`${early.status} ${String(early.body.error)}`).toBe("422 REVERSAL_DATE_BEFORE_ORIGINAL");

    const stated = await cancelReceipt(receiptId, { date: "2026-09-20" });
    expect(stated.status).toBe(200);
    expect(world.sqlite.prepare(`SELECT date FROM journal_entry WHERE id = ?`).all(`${receiptId}:cancel`)).toEqual([{ date: "2026-09-20" }]);
    expect(world.balance("2120", "2026-09-19") - world.balance("2120", "2026-09-09")).toBe(-500n * SCALE);
    expect(world.balance("2120", "2026-09-20") - world.balance("2120", "2026-09-09")).toBe(0n);
  });
});
