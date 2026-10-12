import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIVE_INVARIANTS_ZERO, seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";
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
    await expectRefusedInClosedPeriod(world, `fp-${log.month}`, () => world.request("POST", `/contracting/site/equipment-logs/${log.id}/reverse`, {}));

    const reversed = await world.request("POST", `/contracting/site/equipment-logs/${log.id}/reverse`, {});

    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    expect(reversed.body).toMatchObject({ id: log.id, status: "reversed" });
    expect(entry(world, log.entryId).status).toBe("reversed");
    expect(before.wip - world.balance(WIP)).toBe(log.amount);
    expect(world.balance("5160") - before.recovery).toBe(log.amount);
    expect(auditRows(world, "EQUIPMENT_LOG", log.id, "REVERSE")).toBe(1);
    expect(await world.fiveInvariants()).toEqual(FIVE_INVARIANTS_ZERO);

    const again = await world.request("POST", `/contracting/site/equipment-logs/${log.id}/reverse`, {});
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
    await expectRefusedInClosedPeriod(world, `fp-${doc.month}`, () => world.request("POST", "/contracting/site/consumptions/CON-DEMO-SUB-1/reverse", {}));
    expect(position()).toEqual(before.position);

    const reversed = await world.request("POST", "/contracting/site/consumptions/CON-DEMO-SUB-1/reverse", {});

    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    expect(reversed.body).toMatchObject({ id: "CON-DEMO-SUB-1", status: "reversed" });
    expect(entry(world, doc.entryId).status).toBe("reversed");
    expect(before.wip - world.balance(WIP)).toBe(doc.cost);
    expect(world.balance("1200") - before.inventory).toBe(doc.cost);
    expect(position().qty).toBeGreaterThan(before.position.qty);
    expect(auditRows(world, "MATERIAL_CONSUMPTION", "CON-DEMO-SUB-1", "REVERSE")).toBe(1);
    expect(await world.fiveInvariants()).toEqual(FIVE_INVARIANTS_ZERO);
    const monthEnd = (await world.request("GET", `/reconciliation?asOf=${doc.month}-31`)).body.rows as { key: string; difference: string }[];
    expect(monthEnd.find((r) => r.key === "inventory")?.difference).toBe("0.000000");

    const again = await world.request("POST", "/contracting/site/consumptions/CON-DEMO-SUB-1/reverse", {});
    expect(`${again.status} ${String(again.body.error)}`).toBe("409 SITE_DOCUMENT_STATUS");
  });
});
