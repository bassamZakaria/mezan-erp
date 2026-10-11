import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-support.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

describe("voiding a sales invoice is one write", () => {
  it("a failure while the goods are being put back leaves the entry unreversed, the stock out and the invoice confirmed", async () => {
    expect((await world.request("POST", "/items", { id: "SV-ITEM", code: "SV-ITEM", nameAr: "صنف", type: "stock", baseUnitCode: "PCS" })).status).toBe(201);
    expect(
      (
        await world.request("POST", "/purchases/invoices", {
          id: "SV-PI", supplierId: "SUPP-DEMO-1", date: "2026-10-05", dueDate: "2026-11-05", branchId: "BR-MAIN", warehouseId: "WH-MAIN",
          lines: [{ itemId: "SV-ITEM", kind: "inventory", qty: "10", unitCost: "50", taxRatePercent: 14 }],
        })
      ).status,
    ).toBe(201);
    expect((await world.request("POST", "/purchases/invoices/SV-PI/confirm", {})).status).toBe(200);
    expect(
      (
        await world.request("POST", "/sales-invoices", {
          id: "SV-INV", date: "2026-10-06", dueDate: "2026-11-06", customerId: "CUST-DEMO-1", customerNameAr: "شركة الأمل للتجارة", warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
          lines: [{ lineId: "L1", itemId: "SV-ITEM", itemNameAr: "صنف", isStock: true, qty: "4", unitPrice: "100", taxRatePercent: 14, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" }],
        })
      ).status,
    ).toBe(201);
    expect((await world.request("POST", "/sales-invoices/SV-INV/confirm", {})).status).toBe(200);
    const state = () => ({
      entries: world.count("journal_entry"),
      reversedEntries: world.count("journal_entry", "status = 'reversed'"),
      movements: world.count("stock_movement"),
      receivables: world.balance("1105"),
      inventory: world.balance("1200"),
      status: (world.sqlite.prepare(`SELECT status FROM sales_invoice WHERE id = 'SV-INV'`).get() as { status: string }).status,
    });
    const before = state();
    world.sqlite.exec(`CREATE TRIGGER sv_fail BEFORE INSERT ON stock_movement WHEN NEW.source_doc_id = 'SV-INV:void' BEGIN SELECT RAISE(ABORT, 'disk failure'); END`);

    const failed = await world.request("POST", "/sales-invoices/SV-INV/void", {});
    world.sqlite.exec(`DROP TRIGGER sv_fail`);

    expect(failed.status).toBe(500);
    expect(state()).toEqual(before);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    const voided = await world.request("POST", "/sales-invoices/SV-INV/void", {});
    expect(`${voided.status} ${voided.body.status}`).toBe("200 reversed");
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
