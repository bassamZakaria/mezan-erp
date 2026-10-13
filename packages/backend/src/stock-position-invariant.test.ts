import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";
import { allowBackorders, secondWarehouse } from "./test-helpers/stock-walk.js";

const TODAY = "2026-08-24";
const WAREHOUSE = "WH-MAIN";
const CUSTOMER = "CUST-DEMO-1";
const SUPPLIER = "SUPP-DEMO-1";
const REASON = "سبب اختبار";
const ZERO = { tb: 0n, inventory: 0n, ap: 0n, ar: 0n };
const CLEAN = { count: 0, rows: [] };

let kit: BackendKit;
let otherWarehouse: string;

const scaled = (value: string) => BigInt(value.replace(".", ""));

async function confirmed(created: { status: number; body: unknown }, path: string) {
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const reply = await kit.call("POST", path, {});
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);
  return reply;
}

async function stockItem(id: string) {
  const created = await kit.call("POST", "/items", { id, code: id, nameAr: `صنف ${id}`, type: "stock", baseUnitCode: "PCS", trackInventory: true, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
}

const buy = async (id: string, itemId: string, qty: string, unitCost: string, receiptId?: string) =>
  confirmed(
    await kit.call("POST", "/purchases/invoices", {
      id, supplierId: SUPPLIER, date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: WAREHOUSE, ...(receiptId ? { receiptId } : {}),
      lines: [{ itemId, kind: "inventory", qty, unitCost, taxRateId: "VAT14" }],
    }),
    `/purchases/invoices/${id}/confirm`,
  );

const receive = async (id: string, itemId: string, qty: string, unitCost: string) =>
  confirmed(await kit.call("POST", "/purchases/receipts", { id, supplierId: SUPPLIER, warehouseId: WAREHOUSE, date: TODAY, lines: [{ itemId, qty, unitCost }] }), `/purchases/receipts/${id}/confirm`);

const sell = async (id: string, itemId: string, qty: string) =>
  confirmed(
    await kit.call("POST", "/sales-invoices", {
      id, date: TODAY, dueDate: "2026-09-23", customerId: CUSTOMER, customerNameAr: "عميل", warehouseId: WAREHOUSE, branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
      lines: [{ lineId: "A", itemId, itemNameAr: "صنف", isStock: true, qty, unitPrice: "150", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
    }),
    `/sales-invoices/${id}/confirm`,
  );

const adjustIn = async (id: string, itemId: string, qty: string, unitCost: string) =>
  confirmed(
    await kit.call("POST", "/inventory/stock-adjustments/draft", { id, date: TODAY, lines: [{ itemId, warehouseId: WAREHOUSE, reason: "INITIAL_STOCK", direction: "IN", qty, unitCost }] }),
    `/inventory/stock-adjustments/${id}/confirm`,
  );

const held = async (itemId: string, warehouseId: string = WAREHOUSE) => {
  const balance = (await kit.call("GET", `/inventory/balance?itemId=${itemId}&warehouseId=${warehouseId}`)).body;
  return [balance.onHand, balance.totalValue];
};

const faults = async () => (await kit.call("GET", "/reconciliation")).body.stockPositions;

const balanceOf = async (accountId: string): Promise<bigint> => {
  const balance = (await kit.call("GET", `/gl/accounts/${accountId}/ledger`)).body.balance;
  return scaled(balance.debit) - scaled(balance.credit);
};

const balances = async () => ({ inventory: await balanceOf("1200"), cost: await balanceOf("5100"), variance: await balanceOf("5080"), accrual: await balanceOf("2120"), payable: await balanceOf("2100") });

async function moved(act: () => Promise<unknown>) {
  const before = await balances();
  await act();
  const after = await balances();
  return { inventory: after.inventory - before.inventory, cost: after.cost - before.cost, variance: after.variance - before.variance, accrual: after.accrual - before.accrual, payable: after.payable - before.payable };
}

beforeAll(async () => {
  kit = await bootBackendKit();
  await allowBackorders(kit);
  otherWarehouse = await secondWarehouse(kit);
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("cancelling a purchase whose goods are still in stock beside cheaper ones", () => {
  it("takes the goods out of a purchase invoice at the moving average, books the rest of the reversed entry to cost, and leaves a position that still sells", async () => {
    await stockItem("SPI-A");
    await buy("SPI-A-BUY-1", "SPI-A", "4", "1");
    await buy("SPI-A-BUY-2", "SPI-A", "4", "9");
    await sell("SPI-A-INV-1", "SPI-A", "3");
    expect(await held("SPI-A")).toEqual(["5.000000", "25.000000"]);

    const change = await moved(async () => {
      const cancelled = await kit.call("POST", "/purchases/invoices/SPI-A-BUY-2/cancel", {});
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    });

    expect(await held("SPI-A")).toEqual(["1.000000", "5.000000"]);
    expect(change).toMatchObject({ inventory: -20_000000n, cost: -16_000000n, payable: 41_040000n });
    expect(await faults()).toEqual(CLEAN);
    expect(await kit.invariants()).toEqual(ZERO);
    await sell("SPI-A-INV-2", "SPI-A", "1");
    expect(await held("SPI-A")).toEqual(["0.000000", "0.000000"]);
    expect(await kit.invariants()).toEqual(ZERO);
  });

  it("does the same for a goods receipt, and 2120 is given back in full", async () => {
    await stockItem("SPI-B");
    await receive("SPI-B-GRN-1", "SPI-B", "4", "1");
    await receive("SPI-B-GRN-2", "SPI-B", "4", "9");
    await sell("SPI-B-INV-1", "SPI-B", "3");

    const change = await moved(async () => {
      const cancelled = await kit.call("POST", "/purchases/receipts/SPI-B-GRN-2/cancel", {});
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    });

    expect(await held("SPI-B")).toEqual(["1.000000", "5.000000"]);
    expect(change).toMatchObject({ inventory: -20_000000n, cost: -16_000000n, accrual: 36_000000n });
    expect(await faults()).toEqual(CLEAN);
    expect(await kit.invariants()).toEqual(ZERO);
  });

  it("leaves the layers a rebuild from the ledger would leave: the cancelled purchase's own layer is the one that goes", async () => {
    await stockItem("SPI-C");
    await buy("SPI-C-BUY-1", "SPI-C", "4", "1");
    await buy("SPI-C-BUY-2", "SPI-C", "4", "9");
    expect((await kit.call("POST", "/purchases/invoices/SPI-C-BUY-2/cancel", {})).status).toBe(200);
    const layersOf = async () => ((await kit.call("GET", "/inventory/items/SPI-C/stock")).body.layers as { id: string; remainingQty: string }[]).map((layer) => [layer.id, layer.remainingQty]);
    const live = await layersOf();

    expect((await kit.call("POST", "/inventory/rebuild?itemId=SPI-C&warehouseId=WH-MAIN", {})).status).toBe(200);

    expect(live).toEqual([["SPI-C-BUY-1:0", "4.000000"]]);
    expect(await layersOf()).toEqual(live);
  });
});

describe("reversing a stock adjustment whose goods had covered a back-order", () => {
  it("takes out what the position holds now and books the difference from the adjustment's own entry, so inventory still equals 1200", async () => {
    await stockItem("SPI-D");
    await buy("SPI-D-BUY-1", "SPI-D", "1", "10");
    await sell("SPI-D-INV", "SPI-D", "3");
    expect(await held("SPI-D")).toEqual(["-2.000000", "-20.000000"]);
    await adjustIn("SPI-D-ADJ", "SPI-D", "3", "99");
    expect(await held("SPI-D")).toEqual(["1.000000", "99.000000"]);
    await buy("SPI-D-BUY-2", "SPI-D", "5", "99");

    const reversed = await kit.call("POST", "/inventory/stock-adjustments/SPI-D-ADJ/reverse", { reason: REASON, memo: REASON });

    expect(reversed.status, JSON.stringify(reversed.body)).toBe(201);
    expect(await held("SPI-D")).toEqual(["3.000000", "297.000000"]);
    expect(await kit.invariants()).toEqual(ZERO);
    expect(await faults()).toEqual(CLEAN);
  });
});

describe("a supplier's bill below the receipt's cost, after part of the stock was sold", () => {
  it("lowers the value held no further than nothing; the rest of the difference goes to the price-variance account, and cancelling the bill puts back exactly what it took", async () => {
    await stockItem("SPI-E");
    await buy("SPI-E-BUY", "SPI-E", "1", "10");
    await receive("SPI-E-GRN", "SPI-E", "1", "110");
    await sell("SPI-E-INV", "SPI-E", "1");
    expect(await held("SPI-E")).toEqual(["1.000000", "60.000000"]);

    const billed = await moved(() => buy("SPI-E-BILL", "SPI-E", "1", "10", "SPI-E-GRN"));

    expect(await held("SPI-E")).toEqual(["1.000000", "0.000000"]);
    expect(billed).toMatchObject({ inventory: -60_000000n, variance: -40_000000n, accrual: 110_000000n });
    expect(await faults()).toEqual(CLEAN);
    expect(await kit.invariants()).toEqual(ZERO);

    const cancelled = await moved(async () => {
      const reply = await kit.call("POST", "/purchases/invoices/SPI-E-BILL/cancel", {});
      expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    });

    expect(await held("SPI-E")).toEqual(["1.000000", "60.000000"]);
    expect(cancelled).toMatchObject({ inventory: 60_000000n, variance: 40_000000n, accrual: -110_000000n });
    expect(await kit.invariants()).toEqual(ZERO);
  });
});

describe("a transfer that empties the source position", () => {
  it("arrives at exactly the value that left, to the last micro-unit", async () => {
    await stockItem("SPI-F");
    await buy("SPI-F-BUY-1", "SPI-F", "1", "1");
    await buy("SPI-F-BUY-2", "SPI-F", "2", "1.000001");
    expect(await held("SPI-F")).toEqual(["3.000000", "3.000002"]);

    const change = await moved(() =>
      kit.call("POST", "/inventory/stock-transfers/draft", { id: "SPI-F-TR", date: TODAY, lines: [{ itemId: "SPI-F", fromWarehouseId: WAREHOUSE, toWarehouseId: otherWarehouse, qty: "3" }] }).then((drafted) => confirmed(drafted, "/inventory/stock-transfers/SPI-F-TR/confirm")),
    );

    expect(await held("SPI-F")).toEqual(["0.000000", "0.000000"]);
    expect(await held("SPI-F", otherWarehouse)).toEqual(["3.000000", "3.000002"]);
    expect(change.inventory).toBe(0n);
    expect(await kit.invariants()).toEqual(ZERO);
  });
});
