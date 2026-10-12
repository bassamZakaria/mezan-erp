import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const EGP = 1_000_000n;
const ITEM = "LCD-ITEM";
const position = () =>
  world.sqlite.prepare(`SELECT on_hand AS qty, total_value AS value FROM wac_snapshot WHERE item_id = ? AND warehouse_id = 'WH-MAIN'`).safeIntegers().get(ITEM) as { qty: bigint; value: bigint };
const drift = async () => {
  const report = (await world.request("GET", `/inventory/drift?itemId=${ITEM}&warehouseId=WH-MAIN`)).body as { cacheDrift: string; cachedValue: string; recomputedValue: string };
  return { cacheDrift: report.cacheDrift, cachedValue: report.cachedValue, recomputedValue: report.recomputedValue };
};
const adjust = (id: string, direction: "IN" | "OUT", qty: string, occurredAt: string, unitCost?: string) =>
  world.request("POST", "/inventory/adjustments", { adjustmentId: id, warehouseId: "WH-MAIN", reason: direction === "IN" ? "INITIAL_STOCK" : "DAMAGE", occurredAt, lines: [{ itemId: ITEM, direction, qty, ...(unitCost ? { unitCost } : {}) }] });

describe("a stock movement dated before a landed cost the position has absorbed", () => {
  let absorbedOn = "";

  it("is refused in both languages with the earliest day it may carry, and nothing moves", async () => {
    expect((await world.request("POST", "/items", { id: ITEM, code: ITEM, nameAr: "صنف", type: "stock", baseUnitCode: "PCS" })).status).toBe(201);
    expect((await adjust("LCD-IN", "IN", "10", "2026-08-05", "100")).status).toBe(201);
    expect(
      (await world.request("POST", "/landed-costs", {
        id: "LCD-1", date: "2026-08-10", memo: "شحن", distributionMethod: "BY_QUANTITY", costItems: [{ costType: "SHIPPING", description: "شحن", amount: "100" }],
        targets: [{ itemId: ITEM, warehouseId: "WH-MAIN", sourceInvoiceId: "LCD-IN", sourceInvoiceNumber: "LCD-IN", qty: "10", unitCost: "100" }],
      })).status,
    ).toBe(201);
    const confirmed = await world.request("POST", "/landed-costs/LCD-1/confirm", { absorptionDate: "2026-09-10" });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    absorbedOn = (confirmed.body.document as { absorptionDate: string }).absorptionDate;
    expect(absorbedOn).toBe("2026-09-10");
    expect(position()).toEqual({ qty: 10n * EGP, value: 1100n * EGP });
    const movements = world.count("stock_movement");
    const entries = world.count("journal_entry");

    const refused = await adjust("LCD-OUT-EARLY", "OUT", "6", "2026-08-20");

    expect(`${refused.status} ${String(refused.body.error)}`, JSON.stringify(refused.body)).toBe("422 STOCK_MOVEMENT_BEFORE_LANDED_COST");
    expect(refused.body).toMatchObject({
      message: `حركة المخزون بتاريخ 2026-08-20 على الصنف "${ITEM}" تسبق تحميل تكلفة إضافية على الرصيد نفسه بتاريخ 2026-09-10. أقرب تاريخ مسموح به هو 2026-09-10؛ أو اعكس التكلفة الإضافية أولاً.`,
      messageEn: `The stock movement dated 2026-08-20 on item "${ITEM}" is before a landed cost the same position absorbed on 2026-09-10. The earliest date allowed is 2026-09-10; or reverse the landed cost first.`,
      earliestAllowedDate: "2026-09-10",
    });
    expect(world.count("stock_movement")).toBe(movements);
    expect(world.count("journal_entry")).toBe(entries);
    expect(position()).toEqual({ qty: 10n * EGP, value: 1100n * EGP });
  });

  it("is accepted on the absorption day itself, leaves at the loaded cost, and a rebuild finds no drift", async () => {
    const issued = await adjust("LCD-OUT-OK", "OUT", "6", absorbedOn);
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);
    expect(position()).toEqual({ qty: 4n * EGP, value: 440n * EGP });
    expect(await drift()).toEqual({ cacheDrift: "0.000000", cachedValue: "440.000000", recomputedValue: "440.000000" });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("is accepted again on the earlier day once the landed cost is reversed", async () => {
    expect((await world.request("POST", "/landed-costs/LCD-1/reverse", { date: absorbedOn })).status).toBe(201);
    const early = await adjust("LCD-OUT-AFTER-REVERSAL", "OUT", "1", "2026-08-25");
    expect(early.status, JSON.stringify(early.body)).toBe(201);
    expect(position()).toEqual({ qty: 3n * EGP, value: 300n * EGP });
    expect(await drift()).toEqual({ cacheDrift: "0.000000", cachedValue: "300.000000", recomputedValue: "300.000000" });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
