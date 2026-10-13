import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const WAREHOUSE = "WH-MAIN";
const CUSTOMER = "CUST-DEMO-1";
const SUPPLIER = "SUPP-DEMO-1";
const ZERO = { tb: 0n, inventory: 0n, ap: 0n, ar: 0n };

let kit: BackendKit;
let otherWarehouse: string;

const scaled = (value: string) => BigInt(value.replace(".", ""));

async function stockItem(id: string) {
  const created = await kit.call("POST", "/items", { id, code: id, nameAr: `صنف ${id}`, type: "stock", baseUnitCode: "PCS", trackInventory: true, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
}

async function buy(id: string, itemId: string, qty: string, unitCost: string) {
  const created = await kit.call("POST", "/purchases/invoices", {
    id, supplierId: SUPPLIER, date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: WAREHOUSE,
    lines: [{ itemId, kind: "inventory", qty, unitCost, taxRateId: "VAT14" }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const confirmed = await kit.call("POST", `/purchases/invoices/${id}/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
}

async function sell(id: string, itemId: string, qty: string, warehouseId: string = WAREHOUSE) {
  const created = await kit.call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل", warehouseId, branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "A", itemId, itemNameAr: "صنف", isStock: true, qty, unitPrice: "150", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const confirmed = await kit.call("POST", `/sales-invoices/${id}/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
}

const held = async (itemId: string, warehouseId: string = WAREHOUSE) => {
  const balance = (await kit.call("GET", `/inventory/balance?itemId=${itemId}&warehouseId=${warehouseId}`)).body;
  return [balance.onHand, balance.totalValue];
};

const faults = async () => (await kit.call("GET", "/reconciliation")).body.stockPositions;

async function netOf(entryId: string, accountId: string): Promise<bigint> {
  return (await kit.journalLines(entryId)).filter((line) => line.accountId === accountId).reduce((sum, line) => sum + scaled(line.debit) - scaled(line.credit), 0n);
}

async function setBackorder(allowBackorder: boolean) {
  const settings = (await kit.call("GET", "/settings")).body;
  const saved = await kit.call("PUT", "/settings", { ...settings, allowBackorder });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
}

beforeAll(async () => {
  kit = await bootBackendKit();
  await setBackorder(true);
  const warehouses = (await kit.call("GET", "/warehouses")).body as { id: string; branchId: string | null }[];
  const home = warehouses.find((warehouse) => warehouse.id === WAREHOUSE)!.branchId;
  otherWarehouse = warehouses.find((warehouse) => warehouse.id !== WAREHOUSE && warehouse.branchId === home && !warehouse.id.includes("TRANSIT"))!.id;
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("goods that arrive after they were sold", () => {
  it("level the position in quantity AND value when they cost less than the shortfall was sold at, and the purchase books the difference", async () => {
    await stockItem("BO-A");
    await buy("BO-A-BUY-1", "BO-A", "1", "100");
    await sell("BO-A-INV", "BO-A", "4");
    expect(await held("BO-A")).toEqual(["-3.000000", "-300.000000"]);

    await buy("BO-A-BUY-2", "BO-A", "3", "90");

    expect(await held("BO-A")).toEqual(["0.000000", "0.000000"]);
    expect(await kit.invariants()).toEqual(ZERO);
    expect(await faults()).toEqual({ count: 0, rows: [] });
    expect([await netOf("PI-JE:BO-A-BUY-2", "1200"), await netOf("PI-JE:BO-A-BUY-2", "5100")]).toEqual([300_000000n, -30_000000n]);
  });

  it("bring only what is beyond the shortfall into stock, at their own cost", async () => {
    await stockItem("BO-B");
    await buy("BO-B-BUY-1", "BO-B", "1", "100");
    await sell("BO-B-INV", "BO-B", "4");

    await buy("BO-B-BUY-2", "BO-B", "5", "90");

    expect(await held("BO-B")).toEqual(["2.000000", "180.000000"]);
    expect(await kit.invariants()).toEqual(ZERO);
    await sell("BO-B-INV-2", "BO-B", "2");
    expect(await held("BO-B")).toEqual(["0.000000", "0.000000"]);
    expect(await kit.invariants()).toEqual(ZERO);
  });

  it("book the difference on a goods receipt too, and the received-not-invoiced account still clears to nothing when the supplier bills it", async () => {
    await stockItem("BO-C");
    await buy("BO-C-BUY-1", "BO-C", "1", "100");
    await sell("BO-C-INV", "BO-C", "4");
    const grniBefore = scaled((await kit.call("GET", "/gl/accounts/2120/ledger")).body.balance.credit) - scaled((await kit.call("GET", "/gl/accounts/2120/ledger")).body.balance.debit);
    const receipt = await kit.call("POST", "/purchases/receipts", { id: "BO-C-GRN", supplierId: SUPPLIER, warehouseId: WAREHOUSE, date: TODAY, lines: [{ itemId: "BO-C", qty: "3", unitCost: "110" }] });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
    const received = await kit.call("POST", "/purchases/receipts/BO-C-GRN/confirm", {});
    expect(received.status, JSON.stringify(received.body)).toBe(200);

    expect(await held("BO-C")).toEqual(["0.000000", "0.000000"]);
    expect(await kit.invariants()).toEqual(ZERO);
    const grniAfterReceipt = scaled((await kit.call("GET", "/gl/accounts/2120/ledger")).body.balance.credit) - scaled((await kit.call("GET", "/gl/accounts/2120/ledger")).body.balance.debit);
    expect(grniAfterReceipt - grniBefore).toBe(330_000000n);

    const billed = await kit.call("POST", "/purchases/invoices", { id: "BO-C-BILL", supplierId: SUPPLIER, date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: WAREHOUSE, receiptId: "BO-C-GRN" });
    expect(billed.status, JSON.stringify(billed.body)).toBe(201);
    expect((await kit.call("POST", "/purchases/invoices/BO-C-BILL/confirm", {})).status).toBe(200);
    const grniAfterBill = scaled((await kit.call("GET", "/gl/accounts/2120/ledger")).body.balance.credit) - scaled((await kit.call("GET", "/gl/accounts/2120/ledger")).body.balance.debit);
    expect(grniAfterBill).toBe(grniBefore);
    expect(await kit.invariants()).toEqual(ZERO);
  });

  it("cannot be taken back by cancelling the purchase: the refusal is in Arabic and nothing moves", async () => {
    await stockItem("BO-D");
    await buy("BO-D-BUY-1", "BO-D", "1", "100");
    await sell("BO-D-INV", "BO-D", "4");
    await buy("BO-D-BUY-2", "BO-D", "5", "90");
    const before = { position: await held("BO-D"), invariants: await kit.invariants() };

    const refused = await kit.call("POST", "/purchases/invoices/BO-D-BUY-2/cancel", {});

    expect(refused.status, JSON.stringify(refused.body)).toBeGreaterThanOrEqual(400);
    expect(refused.status).toBeLessThan(500);
    expect(refused.body.message).toMatch(/[؀-ۿ]/);
    expect((await kit.call("GET", "/purchases/invoices/BO-D-BUY-2")).body.status).toBe("confirmed");
    expect({ position: await held("BO-D"), invariants: await kit.invariants() }).toEqual(before);
  });

  it("level a shortfall in another warehouse when they are transferred there, and the books follow the stock", async () => {
    await stockItem("BO-E");
    await buy("BO-E-BUY-1", "BO-E", "1", "100");
    await sell("BO-E-INV", "BO-E", "2", otherWarehouse);
    expect(await held("BO-E", otherWarehouse)).toEqual(["-2.000000", "-200.000000"]);
    await buy("BO-E-BUY-2", "BO-E", "4", "60");
    expect(await held("BO-E")).toEqual(["5.000000", "340.000000"]);

    const drafted = await kit.call("POST", "/inventory/stock-transfers/draft", { id: "BO-E-TR", date: TODAY, lines: [{ itemId: "BO-E", fromWarehouseId: WAREHOUSE, toWarehouseId: otherWarehouse, qty: "2" }] });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    const moved = await kit.call("POST", "/inventory/stock-transfers/BO-E-TR/confirm", {});
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    expect(await held("BO-E", otherWarehouse)).toEqual(["0.000000", "0.000000"]);
    expect(await held("BO-E")).toEqual(["3.000000", "204.000000"]);
    expect(await kit.invariants()).toEqual(ZERO);
    expect(await faults()).toEqual({ count: 0, rows: [] });
  });

  it("level it when a customer returns the same goods into the short position, and voiding a sale into it keeps the books tied", async () => {
    await stockItem("BO-F");
    await buy("BO-F-BUY-1", "BO-F", "2", "100");
    await sell("BO-F-INV-1", "BO-F", "2");
    await buy("BO-F-BUY-2", "BO-F", "1", "40");
    await sell("BO-F-INV-2", "BO-F", "3");
    expect((await held("BO-F"))[0]).toBe("-2.000000");
    const drafted = await kit.call("POST", "/sales-returns/from-invoice", { id: "BO-F-RET", date: TODAY, memo: "", warehouseId: WAREHOUSE, sourceInvoiceId: "BO-F-INV-1", reason: "DEFECTIVE", requested: [{ itemId: "BO-F", sourceLineId: "A", qty: "2" }] });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    const returned = await kit.call("POST", "/sales-returns/BO-F-RET/confirm", {});
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);

    expect(await held("BO-F")).toEqual(["0.000000", "0.000000"]);
    expect(await kit.invariants()).toEqual(ZERO);

    await sell("BO-F-INV-3", "BO-F", "1");
    const voided = await kit.call("POST", "/sales-invoices/BO-F-INV-2/void", { reason: "خطأ في الإدخال" });
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);
    expect(await kit.invariants()).toEqual(ZERO);
    expect(await faults()).toEqual({ count: 0, rows: [] });
  });
});
