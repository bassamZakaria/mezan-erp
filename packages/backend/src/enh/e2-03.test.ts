import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE } from "@mezan/domain";
import { CountModeSessionDTO, CountScanOutcomeDTO, CountZoneStatusDTO, type CountModeMineEntryDTO, type CountModeScanResultDTO } from "@mezan/contracts";
import { INVARIANTS_ZERO, seededWorld, type Answer, type SeededWorld } from "../test-helpers/seeded-world.js";

type Caller = (method: string, url: string, body?: unknown) => Promise<Answer>;

let world: SeededWorld;
let alice: Caller;
let bob: Caller;
let carol: Caller;
let aliceId: string;
let carolId: string;
let countId: string;
let drinksZone: string;
let dryZone: string;

const WAREHOUSE = "WH-MAIN";

function callerFor(userId: string, permissions: readonly string[]): Caller {
  const token = world.backend.sessions.issue({ userId, permissions: [...permissions], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  return async (method, url, body) => {
    const res = await world.backend.app.fetch(
      new Request(`http://local${url}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  };
}

async function member(code: string, name: string, email: string, permissions: readonly string[]): Promise<string> {
  const role = await world.request("POST", "/roles", { code, name, permissions: [...permissions] });
  expect(role.status, JSON.stringify(role.body)).toBe(201);
  const user = await world.request("POST", "/users", { nameAr: name, email, roleId: role.body.id, isCompanyAdmin: false, branchScope: "*", warehouseScope: "*", password: "correct-horse-battery" });
  expect(user.status, JSON.stringify(user.body)).toBe(201);
  return user.body.id as string;
}

async function stocked(id: string, barcode: string, qty: string): Promise<void> {
  expect((await world.request("POST", "/items", { id, code: id, nameAr: `صنف ${id}`, type: "stock", baseUnitCode: "PCS", barcodes: [barcode] })).status).toBe(201);
  expect(
    (await world.request("POST", "/inventory/stock-adjustments/draft", { id: `${id}-OPEN`, date: "2026-10-05", lines: [{ itemId: id, warehouseId: WAREHOUSE, reason: "INITIAL_STOCK", direction: "IN", qty, unitCost: "10" }] })).status,
  ).toBe(201);
  expect((await world.request("POST", `/inventory/stock-adjustments/${id}-OPEN/confirm`, {})).status).toBe(200);
}

const scan = (caller: Caller, zone: string, body: Record<string, unknown>) => caller("POST", `/inventory/count-mode/${countId}/zones/${zone}/scan`, body);
const session = async (caller: Caller) => (await caller("GET", `/inventory/count-mode/${countId}`)).body as unknown as CountModeSessionDTO;

beforeAll(async () => {
  world = await seededWorld();
  aliceId = await member("CNT_COUNTER_A", "عدّاد ألف", "alice.counter@cyag.example", ["inventory.count.scan"]);
  const bobId = await member("CNT_COUNTER_B", "عدّاد باء", "bob.counter@cyag.example", ["inventory.count.scan"]);
  carolId = await member("CNT_REVIEWER", "مراجع جيم", "carol.reviewer@cyag.example", ["inventory.count.review", "inventory.count.approve"]);
  alice = callerFor(aliceId, ["inventory.count.scan"]);
  bob = callerFor(bobId, ["inventory.count.scan"]);
  carol = callerFor(carolId, ["inventory.count.review", "inventory.count.approve", "inventory.count.view"]);
  await stocked("CM-COLA", "6221000000011", "10");
  await stocked("CM-JUICE", "6221000000028", "6");
  await stocked("CM-RICE", "6221000000035", "4");
  const started = await world.request("POST", "/inventory/count-mode", {
    warehouseId: WAREHOUSE,
    date: "2026-10-17",
    blind: true,
    zones: [
      { name: "المشروبات", kind: "AD_HOC", itemIds: ["CM-COLA", "CM-JUICE"], counterUserIds: [aliceId] },
      { name: "الجاف", kind: "AD_HOC", itemIds: ["CM-RICE"], counterUserIds: [bobId] },
    ],
  });
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const body = started.body as unknown as CountModeSessionDTO;
  countId = body.id;
  drinksZone = body.zones[0]!.id;
  dryZone = body.zones[1]!.id;
}, 120_000);

afterAll(() => world?.close());

describe("scanner count over the real backend (ENH-E2-03)", () => {
  it("lists only the zones a counter is assigned to, and withholds expected quantities on a blind count", async () => {
    const mine = (await alice("GET", "/inventory/count-mode/mine")).body as unknown as CountModeMineEntryDTO[];
    expect(mine).toHaveLength(1);
    expect(mine[0]!.zones.map((z) => z.id)).toEqual([drinksZone]);
    const view = await session(alice);
    expect(view.items.map((i) => i.itemId).sort()).toEqual(["CM-COLA", "CM-JUICE"]);
    expect(view.items.every((i) => i.systemQty === null && i.varianceQty === null)).toBe(true);
    expect(view.revealsVariance).toBe(false);
  });

  it("a counter cannot scan in another counter's zone", async () => {
    const refused = await scan(alice, dryZone, { barcode: "6221000000035" });
    expect(refused.status).toBe(403);
  });

  it("resolves a barcode, counts it, and logs a stray and an unknown scan without counting them", async () => {
    const first = (await scan(alice, drinksZone, { barcode: "6221000000011" })).body as unknown as CountModeScanResultDTO;
    expect(first.outcome).toBe(CountScanOutcomeDTO.Counted);
    expect(first.item).toMatchObject({ itemId: "CM-COLA", countedQty: "1.000000", systemQty: null });
    await scan(alice, drinksZone, { barcode: "6221000000011", qty: "8", clientKey: "k-8" });
    const replay = await scan(alice, drinksZone, { barcode: "6221000000011", qty: "8", clientKey: "k-8" });
    expect(replay.status).toBe(200);
    expect((replay.body as unknown as CountModeScanResultDTO).replayed).toBe(true);
    const stray = (await scan(alice, drinksZone, { barcode: "6221000000035" })).body as unknown as CountModeScanResultDTO;
    const unknown = (await scan(alice, drinksZone, { barcode: "0000" })).body as unknown as CountModeScanResultDTO;
    expect([stray.outcome, unknown.outcome]).toEqual([CountScanOutcomeDTO.NotInZone, CountScanOutcomeDTO.UnknownBarcode]);
    const view = await session(alice);
    expect(view.items.find((i) => i.itemId === "CM-COLA")?.countedQty).toBe("9.000000");
    expect(world.count("physical_count_scan", `count_id = '${countId}'`)).toBe(4);
  });

  it("the trail is append-only at the storage layer", () => {
    expect(() => world.sqlite.prepare(`DELETE FROM physical_count_scan`).run()).toThrow(/append-only/);
  });

  it("refuses to submit while an item is uncounted, then submits after counting the rest", async () => {
    const early = await alice("POST", `/inventory/count-mode/${countId}/zones/${drinksZone}/submit`, {});
    expect(early.status).toBe(409);
    await scan(alice, drinksZone, { barcode: "6221000000028", qty: "6", mode: "SET" });
    const submitted = await alice("POST", `/inventory/count-mode/${countId}/zones/${drinksZone}/submit`, {});
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  });

  it("a reviewer who is not counting sees live variance on a blind count; the counter still does not", async () => {
    const review = await session(carol);
    expect(review.revealsVariance).toBe(true);
    const cola = review.items.find((i) => i.itemId === "CM-COLA");
    expect(cola).toMatchObject({ systemQty: "10.000000", countedQty: "9.000000", varianceQty: "-1.000000" });
    expect((await session(alice)).items.every((i) => i.systemQty === null)).toBe(true);
  });

  it("the counter cannot approve or flag a recount", async () => {
    expect((await alice("POST", `/inventory/count-mode/${countId}/zones/${drinksZone}/approve`, {})).status).toBe(403);
    expect((await alice("POST", `/inventory/count-mode/${countId}/zones/${drinksZone}/recount`, { itemIds: ["CM-COLA"], reason: "x" })).status).toBe(403);
  });

  it("a recount reopens the zone, clears the line and demands a fresh count before it can be approved", async () => {
    const flagged = await carol("POST", `/inventory/count-mode/${countId}/zones/${drinksZone}/recount`, { itemIds: ["CM-COLA"], reason: "فرق ملحوظ" });
    expect(flagged.status, JSON.stringify(flagged.body)).toBe(200);
    const view = await session(alice);
    expect(view.items.find((i) => i.itemId === "CM-COLA")).toMatchObject({ countedQty: null, recount: true });
    expect(view.zones[0]!.status).toBe(CountZoneStatusDTO.Open);
    expect((await carol("POST", `/inventory/count-mode/${countId}/zones/${drinksZone}/approve`, {})).status).toBe(409);
    await scan(alice, drinksZone, { barcode: "6221000000011", qty: "10", mode: "SET" });
    expect((await alice("POST", `/inventory/count-mode/${countId}/zones/${drinksZone}/submit`, {})).status).toBe(200);
  });

  it("approval, completion and posting run through the existing variance adjustment", async () => {
    await scan(bob, dryZone, { barcode: "6221000000035", qty: "3", mode: "SET" });
    expect((await bob("POST", `/inventory/count-mode/${countId}/zones/${dryZone}/submit`, {})).status).toBe(200);
    expect((await carol("POST", `/inventory/count-mode/${countId}/complete`, {})).status).toBe(409);
    expect((await carol("POST", `/inventory/count-mode/${countId}/zones/${drinksZone}/approve`, {})).status).toBe(200);
    expect((await carol("POST", `/inventory/count-mode/${countId}/zones/${dryZone}/approve`, {})).status).toBe(200);
    const done = await carol("POST", `/inventory/count-mode/${countId}/complete`, {});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(await world.request("POST", `/inventory/physical-counts/${countId}/counts`, { entries: [{ itemId: "CM-RICE", countedQty: "1" }] })).toMatchObject({ status: 409 });
    const generated = await world.request("POST", `/inventory/physical-counts/${countId}/generate-adjustment`, { adjustmentId: "CM-ADJ-1" });
    expect(generated.status, JSON.stringify(generated.body)).toBe(200);
    expect((generated.body.count as { status: string }).status).toBe("ADJUSTMENT_GENERATED");
    expect(world.count("stock_movement", "reason = 'PHYSICAL_COUNT'")).toBeGreaterThan(0);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("every control step left an audit event", () => {
    const actions = (world.sqlite.prepare(`SELECT DISTINCT action FROM audit_event WHERE action LIKE 'COUNT_MODE_%'`).all() as { action: string }[]).map((r) => r.action).sort();
    expect(actions).toEqual(["COUNT_MODE_COMPLETE", "COUNT_MODE_RECOUNT", "COUNT_MODE_START", "COUNT_MODE_ZONE_APPROVE", "COUNT_MODE_ZONE_SUBMIT"]);
  });
});
