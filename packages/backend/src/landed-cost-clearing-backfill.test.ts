import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE, MODULE_CATALOG, createEntitlements } from "@mezan/domain";
import { createBackend, type BackendHandle } from "./create-backend.js";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld | undefined;
let restarted: BackendHandle | undefined;

afterEach(() => {
  restarted?.close();
  world?.close();
  restarted = undefined;
  world = undefined;
});

const EGP = 1_000_000n;
const account = (id: string) => world!.sqlite.prepare(`SELECT name_ar AS nameAr, type, parent_id AS parentId FROM account WHERE id = ?`).get(id);

async function restart(): Promise<(method: string, url: string, body?: unknown) => Promise<{ status: number; body: Record<string, unknown> }>> {
  restarted?.close();
  restarted = await createBackend({
    dbPath: world!.sqlite.name,
    seedDemoData: true,
    resolveEntitlements: () => createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null }),
  });
  const backend = restarted;
  const token = backend.sessions.issue({ userId: "admin", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  return async (method, url, body) => {
    const res = await backend.app.fetch(new Request(`http://local${url}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
}

async function lateFreight(request: Awaited<ReturnType<typeof restart>>, tag: string) {
  const item = `${tag}-ITEM`;
  const adjust = (id: string, direction: "IN" | "OUT", qty: string, occurredAt: string, unitCost?: string) =>
    request("POST", "/inventory/adjustments", { adjustmentId: id, warehouseId: "WH-MAIN", reason: direction === "IN" ? "INITIAL_STOCK" : "DAMAGE", occurredAt, lines: [{ itemId: item, direction, qty, ...(unitCost ? { unitCost } : {}) }] });
  expect((await request("POST", "/items", { id: item, code: item, nameAr: "صنف", type: "stock", baseUnitCode: "PCS" })).status).toBe(201);
  expect((await adjust(`${tag}-IN`, "IN", "10", "2026-08-05", "100")).status).toBe(201);
  expect((await adjust(`${tag}-OUT`, "OUT", "6", "2026-08-20")).status).toBe(201);
  expect(
    (await request("POST", "/landed-costs", {
      id: `${tag}-LC`, date: "2026-08-10", memo: "شحن", distributionMethod: "BY_QUANTITY", costItems: [{ costType: "SHIPPING", description: "شحن", amount: "100" }],
      targets: [{ itemId: item, warehouseId: "WH-MAIN", sourceInvoiceId: `${tag}-IN`, sourceInvoiceNumber: `${tag}-IN`, qty: "10", unitCost: "100" }],
    })).status,
  ).toBe(201);
  const confirmed = await request("POST", `/landed-costs/${tag}-LC/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
}

describe("books kept before the landed-cost clearing account existed", () => {
  it("get the account under current assets at the next start, once, with everything else in the chart left alone", async () => {
    world = await seededWorld();
    world.backend.close();
    world.sqlite.prepare(`DELETE FROM account WHERE id = '1240'`).run();
    const before = world.count("account");
    const indexes = world.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'account' ORDER BY name`).all();

    const request = await restart();

    expect(account("1240")).toEqual({ nameAr: "تكاليف واردة تحت التسوية", type: "asset", parentId: "1000" });
    expect(world.count("account")).toBe(before + 1);
    await restart();
    expect(world.count("account")).toBe(before + 1);
    expect(world.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'account' ORDER BY name`).all()).toEqual(indexes);
    void request;
  }, 900_000);

  it("whose chart already uses 1240 for an account of another kind keep that account untouched, and a late freight bill stays out of it", async () => {
    world = await seededWorld();
    world.backend.close();
    world.sqlite.prepare(`UPDATE account SET type = 'liability', natural_balance = 'credit', name_ar = 'أمانات للغير' WHERE id = '1240'`).run();
    const balance = () => (world!.sqlite.prepare(`SELECT COALESCE(SUM(debit - credit), 0) AS net FROM journal_line WHERE account_id = '1240'`).safeIntegers().get() as { net: bigint }).net;

    const request = await restart();
    await lateFreight(request, "LCF");

    expect(account("1240")).toMatchObject({ nameAr: "أمانات للغير", type: "liability" });
    expect(balance()).toBe(0n);
    const lines = world.sqlite
      .prepare(`SELECT jl.account_id AS account, jl.debit, jl.credit FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id WHERE je.id = 'LCF-LC' ORDER BY jl.line_no`)
      .safeIntegers()
      .all();
    expect(lines).toEqual([
      { account: "5100", debit: 100n * EGP, credit: 0n },
      { account: "2130", debit: 0n, credit: 100n * EGP },
    ]);
    expect(((await request("GET", "/reconciliation")).body.rows as { key: string; difference: string }[]).find((row) => row.key === "inventory")?.difference).toBe("0.000000");
  }, 900_000);
});
