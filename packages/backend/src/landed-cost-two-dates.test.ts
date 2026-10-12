import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const EGP = 1_000_000n;
const ITEM = "LCB-ITEM";
const CLEARING = "1240";
const position = () =>
  world.sqlite.prepare(`SELECT on_hand AS qty, total_value AS value FROM wac_snapshot WHERE item_id = ? AND warehouse_id = 'WH-MAIN'`).safeIntegers().get(ITEM) as { qty: bigint; value: bigint };
const inventoryTie = async (asOf?: string) =>
  ((await world.request("GET", `/reconciliation${asOf ? `?asOf=${asOf}` : ""}`)).body.rows as { key: string; difference: string }[]).find((r) => r.key === "inventory")?.difference;
const entries = (docId: string) =>
  world.sqlite
    .prepare(
      `SELECT je.id, substr(je.date, 1, 10) AS date, jl.account_id AS account, jl.debit, jl.credit FROM journal_entry je JOIN journal_line jl ON jl.entry_id = je.id
        WHERE je.source_doc_type = 'LANDED_COST' AND je.source_doc_id = ? AND je.reverses_entry_id IS NULL ORDER BY je.date, je.id, jl.line_no`,
    )
    .safeIntegers()
    .all(docId) as { id: string; date: string; account: string; debit: bigint; credit: bigint }[];
const adjust = (id: string, direction: "IN" | "OUT", qty: string, occurredAt: string | undefined, unitCost?: string) =>
  world.request("POST", "/inventory/adjustments", { adjustmentId: id, warehouseId: "WH-MAIN", reason: direction === "IN" ? "INITIAL_STOCK" : "DAMAGE", ...(occurredAt ? { occurredAt } : {}), lines: [{ itemId: ITEM, direction, qty, ...(unitCost ? { unitCost } : {}) }] });

describe("a freight invoice that arrives after part of the goods has left", () => {
  let confirmDay = "";

  it("is accepted on its own document date; it waits in a balance-sheet clearing account until the confirm day, when the goods still on hand take their share and the share of goods already gone is expensed — the earlier month's cost of sales is untouched", async () => {
    expect((await world.request("POST", "/items", { id: ITEM, code: ITEM, nameAr: "صنف شحنة متأخرة", type: "stock", baseUnitCode: "PCS" })).status).toBe(201);
    expect((await adjust("LCB-IN", "IN", "10", "2026-08-05", "100")).status).toBe(201);
    expect((await adjust("LCB-OUT-1", "OUT", "6", "2026-08-20")).status).toBe(201);
    expect(position()).toEqual({ qty: 4n * EGP, value: 400n * EGP });
    const accruedBefore = world.balance("2130", "2026-08-31");
    const augustCostOfSales = world.balance("5100", "2026-08-31");
    const clearingBefore = world.balance(CLEARING);

    const drafted = await world.request("POST", "/landed-costs", {
      id: "LCB-1",
      date: "2026-08-10",
      memo: "شحن وصلت فاتورته متأخرة",
      distributionMethod: "BY_QUANTITY",
      costItems: [{ costType: "SHIPPING", description: "شحن", amount: "100" }],
      targets: [{ itemId: ITEM, warehouseId: "WH-MAIN", sourceInvoiceId: "LCB-IN", sourceInvoiceNumber: "LCB-IN", qty: "10", unitCost: "100" }],
    });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);

    const confirmed = await world.request("POST", "/landed-costs/LCB-1/confirm", {});

    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const document = confirmed.body.document as { date: string; absorptionDate: string; status: string };
    confirmDay = document.absorptionDate;
    expect(document).toMatchObject({ status: "confirmed", date: "2026-08-10" });
    expect(confirmDay > "2026-08-31").toBe(true);
    expect(confirmed.body).toMatchObject({ absorbedTotal: "40.000000", unabsorbedTotal: "60.000000" });
    expect(position()).toEqual({ qty: 4n * EGP, value: 440n * EGP });
    expect(entries("LCB-1").map(({ date, account, debit, credit }) => ({ date, account, debit, credit }))).toEqual([
      { date: "2026-08-10", account: CLEARING, debit: 100n * EGP, credit: 0n },
      { date: "2026-08-10", account: "2130", debit: 0n, credit: 100n * EGP },
      { date: confirmDay, account: "1200", debit: 40n * EGP, credit: 0n },
      { date: confirmDay, account: CLEARING, debit: 0n, credit: 40n * EGP },
      { date: confirmDay, account: "5100", debit: 60n * EGP, credit: 0n },
      { date: confirmDay, account: CLEARING, debit: 0n, credit: 60n * EGP },
    ]);
    expect(world.balance("5100", "2026-08-31")).toBe(augustCostOfSales);
    expect(world.balance(CLEARING, "2026-08-31") - clearingBefore).toBe(100n * EGP);
    expect(world.balance(CLEARING)).toBe(clearingBefore);
    expect(world.sqlite.prepare(`SELECT name_ar AS nameAr, type, parent_id AS parentId FROM account WHERE id = ?`).get(CLEARING)).toEqual({ nameAr: "تكاليف واردة تحت التسوية", type: "asset", parentId: "1000" });
    expect(accruedBefore - world.balance("2130", "2026-08-31")).toBe(100n * EGP);
    expect(await inventoryTie("2026-08-31")).toBe("0.000000");
    expect(await inventoryTie("2026-09-30")).toBe("0.000000");
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
    expect((await world.request("GET", "/landed-costs/LCB-1")).body).toMatchObject({ date: "2026-08-10", absorptionDate: confirmDay });
  });

  it("is reversed after more of the goods has gone out — what is still on hand comes off the stock, what left with the goods comes off cost of sales", async () => {
    expect((await adjust("LCB-OUT-2", "OUT", "2", undefined)).status).toBe(201);
    expect(position()).toEqual({ qty: 2n * EGP, value: 220n * EGP });
    const before = { inventory: world.balance("1200"), expensed: world.balance("5100"), accrued: world.balance("2130"), clearing: world.balance(CLEARING), augustCostOfSales: world.balance("5100", "2026-08-31") };

    const reversed = await world.request("POST", "/landed-costs/LCB-1/reverse", {});

    expect(reversed.status, JSON.stringify(reversed.body)).toBe(201);
    expect((reversed.body.original as { status: string }).status).toBe("reversed");
    expect(position()).toEqual({ qty: 2n * EGP, value: 200n * EGP });
    expect(before.inventory - world.balance("1200")).toBe(20n * EGP);
    expect(world.balance("2130") - before.accrued).toBe(100n * EGP);
    expect(before.expensed - world.balance("5100")).toBe(80n * EGP);
    expect(world.balance(CLEARING)).toBe(before.clearing);
    expect(world.balance("5100", "2026-08-31")).toBe(before.augustCostOfSales);
    expect(await inventoryTie("2026-08-31")).toBe("0.000000");
    expect(await inventoryTie("2026-09-30")).toBe("0.000000");
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("the seeded draft confirms on its natural date, before stock that has since moved", async () => {
    expect((await world.request("GET", "/landed-costs/LC-DEMO-2")).body).toMatchObject({ status: "draft", date: "2026-08-21" });
    const confirmed = await world.request("POST", "/landed-costs/LC-DEMO-2/confirm", {});
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(await inventoryTie("2026-08-31")).toBe("0.000000");
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("a landed cost names who is owed each cost", () => {
  it("keeps the supplier of every cost item through a save and a reload", async () => {
    const drafted = await world.request("POST", "/landed-costs", {
      id: "LCB-SUP",
      date: "2026-08-22",
      memo: "شحن وتخليص",
      distributionMethod: "BY_QUANTITY",
      costItems: [
        { costType: "SHIPPING", description: "شحن", amount: "60", supplierId: "SUPP-DEMO-1" },
        { costType: "CUSTOMS", description: "جمارك", amount: "40" },
      ],
      targets: [{ itemId: ITEM, warehouseId: "WH-MAIN", sourceInvoiceId: "LCB-IN", sourceInvoiceNumber: "LCB-IN", qty: "10", unitCost: "100" }],
    });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);

    const reloaded = (await world.request("GET", "/landed-costs/LCB-SUP")).body as { lines: { costItems: { costType: string; supplierId: string | null }[] }[] };

    expect(reloaded.lines[0]!.costItems.map(({ costType, supplierId }) => ({ costType, supplierId }))).toEqual([
      { costType: "SHIPPING", supplierId: "SUPP-DEMO-1" },
      { costType: "CUSTOMS", supplierId: null },
    ]);
  });
});
