import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE } from "@mezan/domain";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

enum Expect {
  Omit = "omit",
  Refuse = "refuse",
}

interface Probe {
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly body?: unknown;
  readonly expect: Expect;
  readonly costKeys: readonly string[];
}

const VIEWER = [
  "inventory.item.view",
  "inventory.item.create",
  "inventory.item.edit",
  "inventory.stock.view",
  "inventory.valuation.view",
  "inventory.adjustment.view",
  "inventory.adjustment.create",
  "inventory.transfer.view",
  "inventory.count.view",
  "inventory.reorder.view",
  "inventory.template.view",
  "manufacturing.bom.view",
  "manufacturing.wo.view",
  "audit.logs.view",
  "inventory.expiry.view",
];

let world: SeededWorld;
let probes: Probe[];

function keysIn(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const entry of value) keysIn(entry, into);
  else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if ((key === "kpis" || key === "facts") && Array.isArray(entry)) {
        for (const kpi of entry as { key: string }[]) into.add(kpi.key);
        continue;
      }
      into.add(key);
      keysIn(entry, into);
    }
  }
  return into;
}

async function as(permissions: readonly string[], probe: Probe): Promise<{ status: number; body: unknown }> {
  const token = await world.backend.sessions.issue({ userId: `cost-${permissions.length}`, permissions: [...permissions], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const res = await world.backend.app.fetch(
    new Request(`http://local${probe.path}`, {
      method: probe.method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: probe.body === undefined ? undefined : JSON.stringify(probe.body),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const first = <T>(rows: unknown, pick: (row: T) => boolean = () => true): T => {
  const found = (rows as T[]).find(pick);
  if (!found) throw new Error("the demo seed has no row for this probe");
  return found;
};

beforeAll(async () => {
  world = await seededWorld();
  const balance = (await world.request("GET", "/inventory/stock-balance")).body as unknown as { rows: { itemId: string; warehouses: { warehouseId: string; onHand: string }[] }[] };
  const stocked = first<{ itemId: string; warehouses: { warehouseId: string; onHand: string }[] }>(balance.rows, (r) => r.warehouses.some((w) => Number(w.onHand) > 0));
  const itemId = stocked.itemId;
  const warehouseId = stocked.warehouses.find((w) => Number(w.onHand) > 0)!.warehouseId;
  const position = `itemId=${encodeURIComponent(itemId)}&warehouseId=${encodeURIComponent(warehouseId)}`;
  const list = async (path: string) => (await world.request("GET", path)).body as unknown;
  const bom = first<{ id: string }>(await list("/manufacturing/boms"));
  const workOrder = first<{ id: string }>(await list("/manufacturing/work-orders"));
  const adjustment = first<{ id: string }>(await list("/inventory/stock-adjustments"));
  const count = first<{ id: string }>(await list("/inventory/physical-counts"));
  const template = first<{ id: string }>(await list("/inventory/product-templates"));
  const configInstances = (await list("/manufacturing/config-instances")) as { id: string }[];
  const editable = first<{ id: string }>(await list("/items"));

  probes = [
    { method: "GET", path: "/items", expect: Expect.Omit, costKeys: ["costPrice"] },
    { method: "GET", path: `/items/${editable.id}`, expect: Expect.Omit, costKeys: ["costPrice", "totalValue"] },
    { method: "GET", path: `/items/${itemId}`, expect: Expect.Omit, costKeys: ["costPrice", "totalValue"] },
    { method: "PATCH", path: `/items/${editable.id}`, body: { description: "probe" }, expect: Expect.Omit, costKeys: ["costPrice"] },
    { method: "GET", path: `/inventory/balance?${position}`, expect: Expect.Omit, costKeys: ["averageCost", "totalValue"] },
    { method: "GET", path: `/inventory/movements?${position}`, expect: Expect.Omit, costKeys: ["unitCost"] },
    { method: "GET", path: "/inventory/stock-balance", expect: Expect.Omit, costKeys: ["averageCost", "totalValue"] },
    { method: "GET", path: `/inventory/items/${itemId}/stock`, expect: Expect.Omit, costKeys: ["averageCost", "totalValue", "unitCost"] },
    { method: "GET", path: "/inventory/adjustments", expect: Expect.Omit, costKeys: ["unitCost", "value", "valueDelta"] },
    { method: "GET", path: "/inventory/transfers", expect: Expect.Omit, costKeys: ["unitCost", "value", "totalValue"] },
    { method: "GET", path: "/inventory/valuation", expect: Expect.Refuse, costKeys: [] },
    { method: "GET", path: `/inventory/drift?${position}`, expect: Expect.Refuse, costKeys: [] },
    { method: "GET", path: "/inventory/stock-adjustments", expect: Expect.Omit, costKeys: ["unitCost"] },
    { method: "GET", path: `/inventory/stock-adjustments/${adjustment.id}`, expect: Expect.Omit, costKeys: ["unitCost"] },
    { method: "GET", path: `/inventory/physical-counts/${count.id}`, expect: Expect.Omit, costKeys: ["unitCost", "varianceValue", "overValue", "shortValue", "netValue", "absValue"] },
    { method: "GET", path: "/inventory/product-templates", expect: Expect.Omit, costKeys: ["defaultCost"] },
    { method: "GET", path: `/inventory/product-templates/${template.id}`, expect: Expect.Omit, costKeys: ["defaultCost"] },
    { method: "GET", path: "/reports/inventory/stock-levels", expect: Expect.Omit, costKeys: ["averageCost", "value"] },
    { method: "GET", path: "/reports/inventory/stock-levels/summary", expect: Expect.Omit, costKeys: ["totalValue"] },
    { method: "GET", path: "/reports/inventory/ledger", expect: Expect.Omit, costKeys: ["unitCost"] },
    { method: "GET", path: "/reports/inventory/aging", expect: Expect.Omit, costKeys: ["totalValue", "over180Value", "over180Percent"] },
    { method: "GET", path: "/reports/inventory/expiring", expect: Expect.Omit, costKeys: ["totalValue", "expiredValue", "within30Value"] },
    { method: "GET", path: "/reports/inventory/slow-moving", expect: Expect.Omit, costKeys: ["value"] },
    { method: "GET", path: "/reports/inventory/goods-in-transit", expect: Expect.Omit, costKeys: ["value"] },
    { method: "GET", path: "/reports/inventory/valuation", expect: Expect.Refuse, costKeys: [] },
    { method: "GET", path: "/reports/inventory/drift", expect: Expect.Refuse, costKeys: [] },
    { method: "GET", path: "/reports/inventory/batches", expect: Expect.Omit, costKeys: ["value", "totalValue", "valueExact"] },
    { method: "GET", path: "/reports/manufacturing/make-vs-buy", expect: Expect.Refuse, costKeys: [] },
    { method: "GET", path: `/reports/drill-down/item/${itemId}`, expect: Expect.Omit, costKeys: ["value"] },
    { method: "GET", path: "/manufacturing/boms", expect: Expect.Omit, costKeys: ["estimate", "laborCost", "overheadCost", "materialCost", "totalCost", "unitCost"] },
    { method: "GET", path: `/manufacturing/boms/${bom.id}`, expect: Expect.Omit, costKeys: ["estimate", "laborCost", "overheadCost", "materialCost", "totalCost", "unitCost"] },
    { method: "GET", path: `/manufacturing/boms/${bom.id}/cost-estimate`, expect: Expect.Refuse, costKeys: [] },
    { method: "GET", path: "/manufacturing/work-orders", expect: Expect.Omit, costKeys: ["issuedUnitCost", "materialCost", "laborCost", "overheadCost", "extraCost", "wipTotal", "unitCost", "costLog", "normalCost", "abnormalCost"] },
    { method: "GET", path: `/manufacturing/work-orders/${workOrder.id}`, expect: Expect.Omit, costKeys: ["issuedUnitCost", "materialCost", "laborCost", "overheadCost", "extraCost", "wipTotal", "unitCost", "costLog", "normalCost", "abnormalCost"] },
    { method: "GET", path: "/manufacturing/dashboard", expect: Expect.Omit, costKeys: ["wipValue", "avgCostPerUnit"] },
    ...(configInstances[0]
      ? [{ method: "GET" as const, path: `/manufacturing/config-instances/${configInstances[0].id}`, expect: Expect.Omit, costKeys: ["lineCost", "materialCostPerUnit", "laborCostPerUnit", "overheadCostPerUnit", "estimatedUnitCost", "actualCost"] }]
      : []),
    { method: "GET", path: "/inventory/expiry/alerts", expect: Expect.Omit, costKeys: ["value"] },
    { method: "GET", path: `/inventory/expiry/write-off-proposal?warehouseId=${encodeURIComponent(warehouseId)}`, expect: Expect.Omit, costKeys: ["totalValue", "value", "layerValue"] },
    { method: "GET", path: `/inventory/fefo-preview?${position}&qty=1`, expect: Expect.Omit, costKeys: [] },
    { method: "GET", path: "/reorder/worklist", expect: Expect.Omit, costKeys: [] },
  ];
}, 900_000);

afterAll(() => world?.close());

const COST_WORDS = /cost|value/i;
const NOT_COST = new Set(["value", "values", "costingMethod", "costCategory", "costCenterId"]);

describe("item cost is visible only to a holder of inventory.cost.view (#119)", () => {
  it("omits every cost field, at any depth, from a session without it, and keeps them for a holder", async () => {
    const leaks: string[] = [];
    const missing: string[] = [];
    for (const probe of probes) {
      const without = await as(VIEWER, probe);
      const holder = await as([...VIEWER, "inventory.cost.view"], probe);
      const label = `${probe.method} ${probe.path}`;
      if (probe.expect === Expect.Refuse) {
        if (without.status !== 403) leaks.push(`${label} answered ${without.status} without the right`);
        if (holder.status !== 200) missing.push(`${label} answered ${holder.status} to a holder`);
        continue;
      }
      if (without.status !== 200 || holder.status !== 200) {
        leaks.push(`${label} answered ${without.status}/${holder.status}`);
        continue;
      }
      const seen = keysIn(without.body);
      for (const key of probe.costKeys) if (seen.has(key)) leaks.push(`${label} sent ${key}`);
      for (const key of seen) if (COST_WORDS.test(key) && !NOT_COST.has(key) && !probe.costKeys.includes(key)) leaks.push(`${label} sent unlisted ${key}`);
      const held = keysIn(holder.body);
      if (!probe.costKeys.some((key) => held.has(key)) && probe.costKeys.length > 0) missing.push(`${label} sent none of ${probe.costKeys.join(",")} to a holder`);
    }
    expect(leaks).toEqual([]);
    expect(missing).toEqual([]);
  }, 900_000);

  it("does not order the catalogue by cost for a session without the right", async () => {
    const asc = await as(VIEWER, { method: "GET", path: "/items?sort=costPrice&sortDir=asc&pageSize=200", expect: Expect.Omit, costKeys: [] });
    const plain = await as(VIEWER, { method: "GET", path: "/items?pageSize=200", expect: Expect.Omit, costKeys: [] });
    expect((asc.body as { id: string }[]).map((row) => row.id)).toEqual((plain.body as { id: string }[]).map((row) => row.id));
  });

  it("a PATCH without the right cannot overwrite the item's cost", async () => {
    const item = first<{ id: string; costPrice: string | null }>((await world.request("GET", "/items")).body, (row) => (row as { costPrice: string | null }).costPrice !== null);
    await as(VIEWER, { method: "PATCH", path: `/items/${item.id}`, body: { costPrice: "0.01" }, expect: Expect.Omit, costKeys: [] });
    const after = (await world.request("GET", `/items/${item.id}`)).body as { costPrice: string | null };
    expect(after.costPrice).toBe(item.costPrice);
  });

  it("prices a reorder line from the item's cost only for a holder", async () => {
    const probe = { method: "GET" as const, path: "/reorder/worklist", expect: Expect.Omit, costKeys: [] };
    type Row = { key: string; unitPrice: string | null };
    const without = ((await as(VIEWER, probe)).body as { rows: Row[] }).rows;
    const holder = new Map(((await as([...VIEWER, "inventory.cost.view"], probe)).body as { rows: Row[] }).rows.map((row) => [row.key, row.unitPrice]));
    const fromCost = without.filter((row) => row.unitPrice !== holder.get(row.key));
    expect(fromCost.length).toBeGreaterThan(0);
    expect(fromCost.every((row) => row.unitPrice === null)).toBe(true);
  });

  it("hides the audit trail of a cost field from a session without the right", async () => {
    const filtered = await as(VIEWER, { method: "GET", path: "/audit?field=costPrice", expect: Expect.Omit, costKeys: [] });
    expect(JSON.stringify(filtered.body)).not.toMatch(/costPrice/);
  });
});
