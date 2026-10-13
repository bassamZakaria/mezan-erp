import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";
import { auditRows, entry, expectJournalRouteClosed, expectRefusedInClosedPeriod } from "./world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const WIP = "1230";

describe("reversing an equipment log", () => {
  it("takes the plant charge back off the project and marks the log reversed", async () => {
    const log = world.sqlite.prepare(`SELECT id, journal_entry_id AS entryId, amount, substr(date, 1, 7) AS month FROM equipment_log WHERE status = 'confirmed' AND date >= '2026-08-01' ORDER BY id LIMIT 1`).safeIntegers().get() as { id: string; entryId: string; amount: bigint; month: string };
    const before = { wip: world.balance(WIP), recovery: world.balance("5160") };
    await expectJournalRouteClosed(world, log.entryId);
    await expectRefusedInClosedPeriod(world, `fp-${log.month}`, (date) => world.request("POST", `/contracting/site/equipment-logs/${log.id}/reverse`, { memo: "سبب العكس", date }));

    const reversed = await world.request("POST", `/contracting/site/equipment-logs/${log.id}/reverse`, { memo: "سبب العكس" });

    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    expect(reversed.body).toMatchObject({ id: log.id, status: "reversed" });
    expect(entry(world, log.entryId).status).toBe("reversed");
    expect(before.wip - world.balance(WIP)).toBe(log.amount);
    expect(world.balance("5160") - before.recovery).toBe(log.amount);
    expect(auditRows(world, "EQUIPMENT_LOG", log.id, "REVERSE")).toBe(1);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    const again = await world.request("POST", `/contracting/site/equipment-logs/${log.id}/reverse`, { memo: "سبب العكس" });
    expect(`${again.status} ${String(again.body.error)}`).toBe("409 SITE_DOCUMENT_STATUS");
    expect(typeof again.body.messageEn).toBe("string");
  });
});

describe("reversing a material consumption", () => {
  it("returns the goods to the site store at the cost they left at, on the day the ledger is credited back", async () => {
    const doc = world.sqlite
      .prepare(`SELECT id, warehouse_id AS warehouseId, journal_entry_id AS entryId, total_cost AS cost, substr(date, 1, 7) AS month, lines_json AS lines FROM material_consumption WHERE id = 'CON-DEMO-SUB-1'`)
      .safeIntegers()
      .get() as { id: string; warehouseId: string; entryId: string; cost: bigint; month: string; lines: string };
    const itemId = (JSON.parse(doc.lines) as { itemId: string }[])[0]!.itemId;
    const position = () =>
      world.sqlite.prepare(`SELECT on_hand AS qty, total_value AS value FROM wac_snapshot WHERE item_id = ? AND warehouse_id = ?`).safeIntegers().get(itemId, doc.warehouseId) as { qty: bigint; value: bigint };
    const before = { wip: world.balance(WIP), inventory: world.balance("1200"), position: position() };
    await expectJournalRouteClosed(world, doc.entryId);
    await expectRefusedInClosedPeriod(world, `fp-${doc.month}`, (date) => world.request("POST", "/contracting/site/consumptions/CON-DEMO-SUB-1/reverse", { memo: "سبب العكس", date }));
    expect(position()).toEqual(before.position);

    const reversed = await world.request("POST", "/contracting/site/consumptions/CON-DEMO-SUB-1/reverse", { memo: "سبب العكس", date: "2026-09-03" });

    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    expect(reversed.body).toMatchObject({ id: "CON-DEMO-SUB-1", status: "reversed" });
    expect(entry(world, doc.entryId).status).toBe("reversed");
    expect(before.wip - world.balance(WIP)).toBe(doc.cost);
    expect(world.balance("1200") - before.inventory).toBe(doc.cost);
    expect(position().qty).toBeGreaterThan(before.position.qty);
    expect(auditRows(world, "MATERIAL_CONSUMPTION", "CON-DEMO-SUB-1", "REVERSE")).toBe(1);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
    const monthEnd = (await world.request("GET", `/reconciliation?asOf=${doc.month}-31`)).body.rows as { key: string; difference: string }[];
    expect(monthEnd.find((r) => r.key === "inventory")?.difference).toBe("0.000000");
    const nextMonthEnd = (await world.request("GET", "/reconciliation?asOf=2026-09-30")).body.rows as { key: string; difference: string }[];
    expect(nextMonthEnd.find((r) => r.key === "inventory")?.difference).toBe("0.000000");
    const cameBackOn = world.sqlite
      .prepare(`SELECT substr(occurred_at, 1, 10) AS day FROM stock_movement WHERE source_doc_type = 'MATERIAL_CONSUMPTION' AND item_id = ? AND warehouse_id = ? ORDER BY rowid DESC LIMIT 1`)
      .get(itemId, doc.warehouseId) as { day: string };
    const mirroredOn = world.sqlite.prepare(`SELECT substr(date, 1, 10) AS day FROM journal_entry WHERE reverses_entry_id = ?`).get(doc.entryId) as { day: string };
    expect({ stock: cameBackOn.day, ledger: mirroredOn.day }).toEqual({ stock: "2026-09-03", ledger: "2026-09-03" });

    const again = await world.request("POST", "/contracting/site/consumptions/CON-DEMO-SUB-1/reverse", { memo: "سبب العكس" });
    expect(`${again.status} ${String(again.body.error)}`).toBe("409 SITE_DOCUMENT_STATUS");
  });
});

describe("reversing a material consumption after the site store was sold short", () => {
  it("levels the shortfall at the value it carried and books the rest of the mirrored entry to cost, so the store's stock still equals 1200", async () => {
    const settings = (await world.request("GET", "/settings")).body;
    expect((await world.request("PUT", "/settings", { ...settings, allowBackorder: true })).status).toBe(200);
    const doc = world.sqlite
      .prepare(`SELECT id, warehouse_id AS warehouseId, total_cost AS cost, lines_json AS lines FROM material_consumption WHERE status = 'confirmed' AND journal_entry_id IS NOT NULL ORDER BY id LIMIT 1`)
      .safeIntegers()
      .get() as { id: string; warehouseId: string; cost: bigint; lines: string };
    const itemId = (JSON.parse(doc.lines) as { itemId: string }[])[0]!.itemId;
    const position = () =>
      world.sqlite.prepare(`SELECT on_hand AS qty, total_value AS value FROM wac_snapshot WHERE item_id = ? AND warehouse_id = ?`).safeIntegers().get(itemId, doc.warehouseId) as { qty: bigint; value: bigint };
    const today = new Date().toISOString().slice(0, 10);
    const dearer = await world.request("POST", "/inventory/stock-adjustments/draft", { id: "SITE-SHORT-ADJ", date: today, lines: [{ itemId, warehouseId: doc.warehouseId, reason: "INITIAL_STOCK", direction: "IN", qty: "1", unitCost: "99999" }] });
    expect(dearer.status, JSON.stringify(dearer.body)).toBe(201);
    expect((await world.request("POST", "/inventory/stock-adjustments/SITE-SHORT-ADJ/confirm", {})).status).toBe(200);
    const shortBy = 2_000000n;
    const sold = await world.request("POST", "/sales-invoices", {
      id: "SITE-SHORT-INV", date: today, dueDate: today, customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: doc.warehouseId, branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
      lines: [{ lineId: "A", itemId, itemNameAr: "صنف", isStock: true, qty: (Number(position().qty + shortBy) / 1e6).toFixed(6), unitPrice: "10", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
    });
    expect(sold.status, JSON.stringify(sold.body)).toBe(201);
    const confirmed = await world.request("POST", "/sales-invoices/SITE-SHORT-INV/confirm", {});
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(position().qty).toBe(-shortBy);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
    const before = { inventory: world.balance("1200"), cost: world.balance("5100"), value: position().value };

    const reversed = await world.request("POST", `/contracting/site/consumptions/${doc.id}/reverse`, { memo: "سبب العكس", date: today });

    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    const took = position().value - before.value;
    expect(took).not.toBe(doc.cost);
    expect(world.balance("1200") - before.inventory).toBe(took);
    expect(world.balance("5100") - before.cost).toBe(doc.cost - took);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
