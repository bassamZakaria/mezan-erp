import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, CostPermission, VAN_STOCK_STEP_KINDS, type VanReconciliationStepKind } from "@mezan/domain";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

enum Expect {
  Omit = "omit",
  Refuse = "refuse",
}

enum Method {
  Get = "GET",
  Post = "POST",
  Patch = "PATCH",
}

interface Probe {
  readonly method: Method;
  readonly path: string;
  readonly body?: unknown;
  readonly expect: Expect;
  readonly costKeys: readonly string[];
  readonly notCost?: readonly string[];
}

const VIEWER = [
  "inventory.item.view",
  "inventory.item.create",
  "inventory.item.edit",
  "inventory.stock.view",
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
  "field.van_trip.view",
  "inventory.writedown.view",
  "projects.project.view",
  "purchases.landed_cost.view",
  "accounting.reports.view",
  "contracting.certificate.view",
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
  const writedownRuns = (await list("/inventory/writedown-runs")) as unknown[];
  let consumption: string | null = null;
  for (const project of (await list("/projects")) as { id: string }[]) {
    const rows = (await list(`/contracting/site/consumption-by-boq-line?projectId=${encodeURIComponent(project.id)}`)) as unknown[];
    if (Array.isArray(rows) && rows.length > 0) {
      consumption = project.id;
      break;
    }
  }

  const reconciliation = (await list("/reconciliation")) as { stockPositions: { rows: unknown[] } };
  const sitePositions = reconciliation.stockPositions.rows.length > 0;

  probes = [
    { method: Method.Get, path: "/items", expect: Expect.Omit, costKeys: ["costPrice"] },
    { method: Method.Get, path: `/items/${editable.id}`, expect: Expect.Omit, costKeys: ["costPrice", "totalValue"] },
    { method: Method.Get, path: `/items/${itemId}`, expect: Expect.Omit, costKeys: ["costPrice", "totalValue"] },
    { method: Method.Patch, path: `/items/${editable.id}`, body: { description: "probe" }, expect: Expect.Omit, costKeys: ["costPrice"] },
    { method: Method.Get, path: `/inventory/balance?${position}`, expect: Expect.Omit, costKeys: ["averageCost", "totalValue"] },
    { method: Method.Get, path: `/inventory/movements?${position}`, expect: Expect.Omit, costKeys: ["unitCost"] },
    { method: Method.Get, path: "/inventory/stock-balance", expect: Expect.Omit, costKeys: ["averageCost", "totalValue"] },
    { method: Method.Get, path: `/inventory/items/${itemId}/stock`, expect: Expect.Omit, costKeys: ["averageCost", "totalValue", "unitCost"] },
    { method: Method.Get, path: "/inventory/adjustments", expect: Expect.Omit, costKeys: ["unitCost", "value", "valueDelta"] },
    { method: Method.Get, path: "/inventory/transfers", expect: Expect.Omit, costKeys: ["unitCost", "value", "totalValue"] },
    { method: Method.Get, path: "/inventory/valuation", expect: Expect.Refuse, costKeys: [] },
    { method: Method.Get, path: `/inventory/drift?${position}`, expect: Expect.Refuse, costKeys: [] },
    { method: Method.Get, path: "/inventory/stock-adjustments", expect: Expect.Omit, costKeys: ["unitCost"] },
    { method: Method.Get, path: `/inventory/stock-adjustments/${adjustment.id}`, expect: Expect.Omit, costKeys: ["unitCost"] },
    { method: Method.Get, path: `/inventory/physical-counts/${count.id}`, expect: Expect.Omit, costKeys: ["unitCost", "varianceValue", "overValue", "shortValue", "netValue", "absValue"] },
    { method: Method.Get, path: "/inventory/product-templates", expect: Expect.Omit, costKeys: ["defaultCost"] },
    { method: Method.Get, path: `/inventory/product-templates/${template.id}`, expect: Expect.Omit, costKeys: ["defaultCost"] },
    { method: Method.Get, path: "/reports/inventory/stock-levels", expect: Expect.Omit, costKeys: ["averageCost", "value"] },
    { method: Method.Get, path: "/reports/inventory/stock-levels/summary", expect: Expect.Omit, costKeys: ["totalValue"] },
    { method: Method.Get, path: "/reports/inventory/ledger", expect: Expect.Omit, costKeys: ["unitCost"] },
    { method: Method.Get, path: "/reports/inventory/aging", expect: Expect.Omit, costKeys: ["totalValue", "over180Value", "over180Percent"] },
    { method: Method.Get, path: "/reports/inventory/expiring", expect: Expect.Omit, costKeys: ["totalValue", "expiredValue", "within30Value"] },
    { method: Method.Get, path: "/reports/inventory/slow-moving", expect: Expect.Omit, costKeys: ["value"] },
    { method: Method.Get, path: "/reports/inventory/goods-in-transit", expect: Expect.Omit, costKeys: ["value"] },
    { method: Method.Get, path: "/reports/inventory/valuation", expect: Expect.Refuse, costKeys: [] },
    { method: Method.Get, path: "/reports/inventory/drift", expect: Expect.Refuse, costKeys: [] },
    { method: Method.Get, path: "/reports/inventory/batches", expect: Expect.Omit, costKeys: ["value", "totalValue", "valueExact"] },
    { method: Method.Get, path: "/reports/manufacturing/make-vs-buy", expect: Expect.Refuse, costKeys: [] },
    { method: Method.Get, path: `/reports/drill-down/item/${itemId}`, expect: Expect.Omit, costKeys: ["value"] },
    { method: Method.Get, path: "/manufacturing/boms", expect: Expect.Omit, costKeys: ["estimate", "laborCost", "overheadCost", "materialCost", "totalCost", "unitCost"] },
    { method: Method.Get, path: `/manufacturing/boms/${bom.id}`, expect: Expect.Omit, costKeys: ["estimate", "laborCost", "overheadCost", "materialCost", "totalCost", "unitCost"] },
    { method: Method.Get, path: `/manufacturing/boms/${bom.id}/cost-estimate`, expect: Expect.Refuse, costKeys: [] },
    { method: Method.Get, path: "/manufacturing/work-orders", expect: Expect.Omit, costKeys: ["issuedUnitCost", "materialCost", "laborCost", "overheadCost", "extraCost", "wipTotal", "unitCost", "costLog", "normalCost", "abnormalCost"] },
    { method: Method.Get, path: `/manufacturing/work-orders/${workOrder.id}`, expect: Expect.Omit, costKeys: ["issuedUnitCost", "materialCost", "laborCost", "overheadCost", "extraCost", "wipTotal", "unitCost", "costLog", "normalCost", "abnormalCost"] },
    { method: Method.Get, path: "/manufacturing/dashboard", expect: Expect.Omit, costKeys: ["wipValue", "avgCostPerUnit"] },
    ...(configInstances[0]
      ? [{ method: Method.Get, path: `/manufacturing/config-instances/${configInstances[0].id}`, expect: Expect.Omit, costKeys: ["lineCost", "materialCostPerUnit", "laborCostPerUnit", "overheadCostPerUnit", "estimatedUnitCost", "actualCost"] }]
      : []),
    { method: Method.Get, path: "/inventory/expiry/alerts", expect: Expect.Omit, costKeys: ["value"] },
    { method: Method.Get, path: `/inventory/expiry/write-off-proposal?warehouseId=${encodeURIComponent(warehouseId)}`, expect: Expect.Omit, costKeys: ["totalValue", "value", "layerValue"] },
    { method: Method.Get, path: `/inventory/fefo-preview?${position}&qty=1`, expect: Expect.Omit, costKeys: [] },
    { method: Method.Get, path: "/reorder/worklist", expect: Expect.Omit, costKeys: [] },
    { method: Method.Get, path: "/field/van-trips", expect: Expect.Omit, costKeys: ["unitCost", "varianceValue"] },
    { method: Method.Get, path: "/inventory/writedown-runs", expect: Expect.Omit, costKeys: writedownRuns.length > 0 ? ["unitCost", "amount", "totalAmount"] : [] },
    ...(consumption
      ? [{ method: Method.Get, path: `/contracting/site/consumption-by-boq-line?projectId=${encodeURIComponent(consumption)}`, expect: Expect.Omit, costKeys: ["cost"] }]
      : []),
    { method: Method.Get, path: "/contracting/site/consumptions", expect: Expect.Omit, costKeys: ["totalCost"] },
    { method: Method.Get, path: "/contracting/reports/consumption-variance", expect: Expect.Omit, costKeys: ["consumedCost"] },
    { method: Method.Get, path: "/reports/field/rep-daily", expect: Expect.Omit, costKeys: ["shortageValue", "overageValue"] },
    { method: Method.Get, path: "/landed-costs", expect: Expect.Omit, costKeys: ["newUnitCost"], notCost: ["unitCost", "costItems", "costType"] },
    { method: Method.Get, path: "/reconciliation", expect: Expect.Omit, costKeys: sitePositions ? ["totalValue"] : [] },
  ];
}, 900_000);

afterAll(() => world?.close());

const COST_WORDS = /cost|value/i;
const NOT_COST = new Set(["value", "values", "costingMethod", "costCategory", "costCenterId", "returnsValue"]);

describe("item cost is visible only to a holder of inventory.cost.view (#119)", () => {
  it("omits every cost field, at any depth, from a session without it, and keeps them for a holder", async () => {
    const leaks: string[] = [];
    const missing: string[] = [];
    for (const probe of probes) {
      const without = await as(VIEWER, probe);
      const holder = await as([...VIEWER, "inventory.cost.view", "inventory.valuation.view"], probe);
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
      for (const key of seen) if (COST_WORDS.test(key) && !NOT_COST.has(key) && !probe.costKeys.includes(key) && !probe.notCost?.includes(key)) leaks.push(`${label} sent unlisted ${key}`);
      const held = keysIn(holder.body);
      if (!probe.costKeys.some((key) => held.has(key)) && probe.costKeys.length > 0) missing.push(`${label} sent none of ${probe.costKeys.join(",")} to a holder`);
    }
    expect(leaks).toEqual([]);
    expect(missing).toEqual([]);
  }, 900_000);

  it("does not order the catalogue by cost for a session without the right", async () => {
    const asc = await as(VIEWER, { method: Method.Get, path: "/items?sort=costPrice&sortDir=asc&pageSize=200", expect: Expect.Omit, costKeys: [] });
    const plain = await as(VIEWER, { method: Method.Get, path: "/items?pageSize=200", expect: Expect.Omit, costKeys: [] });
    expect((asc.body as { id: string }[]).map((row) => row.id)).toEqual((plain.body as { id: string }[]).map((row) => row.id));
  });

  it("a PATCH without the right cannot overwrite the item's cost", async () => {
    const item = first<{ id: string; costPrice: string | null }>((await world.request("GET", "/items")).body, (row) => (row as { costPrice: string | null }).costPrice !== null);
    await as(VIEWER, { method: Method.Patch, path: `/items/${item.id}`, body: { costPrice: "0.01" }, expect: Expect.Omit, costKeys: [] });
    const after = (await world.request("GET", `/items/${item.id}`)).body as { costPrice: string | null };
    expect(after.costPrice).toBe(item.costPrice);
  });

  it("prices a reorder line from the item's cost only for a holder", async () => {
    const probe = { method: Method.Get, path: "/reorder/worklist", expect: Expect.Omit, costKeys: [] };
    type Row = { key: string; unitPrice: string | null };
    const without = ((await as(VIEWER, probe)).body as { rows: Row[] }).rows;
    const holder = new Map(((await as([...VIEWER, "inventory.cost.view"], probe)).body as { rows: Row[] }).rows.map((row) => [row.key, row.unitPrice]));
    const fromCost = without.filter((row) => row.unitPrice !== holder.get(row.key));
    expect(fromCost.length).toBeGreaterThan(0);
    expect(fromCost.every((row) => row.unitPrice === null)).toBe(true);
  });

  it("hides the audit trail of a cost field from a session without the right", async () => {
    const item = first<{ id: string }>((await world.request("GET", "/items")).body);
    expect((await world.request("PATCH", `/items/${item.id}`, { costPrice: "77.50" })).status).toBe(200);
    const filtered = await as(VIEWER, { method: Method.Get, path: "/audit?field=costPrice", expect: Expect.Omit, costKeys: [] });
    expect(JSON.stringify(filtered.body)).not.toMatch(/costPrice/);
    type Change = { field: string; from: unknown; to: unknown; redacted?: boolean };
    const changesOf = async (permissions: readonly string[]) =>
      ((await as(permissions, { method: Method.Get, path: `/audit?entityType=ITEM&entityId=${encodeURIComponent(item.id)}`, expect: Expect.Omit, costKeys: [] })).body as { events: { details?: { changes?: Change[] } }[] }).events
        .flatMap((event) => event.details?.changes ?? [])
        .filter((change) => change.field === "costPrice");
    const hidden = await changesOf(VIEWER);
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((change) => change.from === null && change.to === null && change.redacted === true)).toBe(true);
    expect((await changesOf([...VIEWER, "inventory.cost.view"])).some((change) => change.to !== null)).toBe(true);
  });

  it("a branch-restricted edit without the right cannot test a cost guess against the stored price", async () => {
    const item = first<{ id: string; costPrice: string | null }>((await world.request("GET", "/items")).body, (row) => (row as { costPrice: string | null }).costPrice !== null);
    const token = await world.backend.sessions.issue({ userId: "cost-branch", permissions: [...VIEWER], roleCode: null, branchScope: ["BR-ALEX"], warehouseScope: ALL_SCOPE });
    const patch = async (costPrice: string) =>
      (await world.backend.app.fetch(new Request(`http://local/items/${item.id}`, { method: Method.Patch, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ costPrice }) }))).status;
    expect(await patch("0.01")).toBe(await patch(item.costPrice!));
    expect(((await world.request("GET", `/items/${item.id}`)).body as { costPrice: string | null }).costPrice).toBe(item.costPrice);
  });

  it("a create without the right neither stores nor echoes a cost price", async () => {
    const body = (id: string) => ({ id, nameAr: "صنف اختبار التكلفة", type: "stock", baseUnitCode: "PCS", costPrice: "12.50" });
    const without = await as(VIEWER, { method: Method.Post, path: "/items", body: body("COST-PROBE-1"), expect: Expect.Omit, costKeys: [] });
    expect(without.status).toBe(201);
    expect(without.body).not.toHaveProperty("costPrice");
    expect(((await world.request("GET", "/items/COST-PROBE-1")).body as { costPrice: string | null }).costPrice).toBeNull();
    const holder = await as([...VIEWER, "inventory.cost.view"], { method: Method.Post, path: "/items", body: body("COST-PROBE-2"), expect: Expect.Omit, costKeys: [] });
    expect(holder.status).toBe(201);
    expect((holder.body as { costPrice: string }).costPrice).toBe("12.500000");
  });

  it("an item import without the right drops the sheet's cost price, and a holder's import keeps it", async () => {
    const importer = [...VIEWER, "admin.settings.edit"];
    const importRow = (permissions: readonly string[], code: string) =>
      as(permissions, { method: Method.Post, path: "/data-migration/items/commit", body: { rows: [{ code, nameAr: "صنف استيراد التكلفة", baseUnitCode: "PCS", type: "stock", costPrice: "12.50" }] }, expect: Expect.Omit, costKeys: [] });
    const costOf = async (code: string) => first<{ code: string; costPrice: string | null }>((await world.request("GET", "/items")).body, (row) => (row as { code: string }).code === code).costPrice;
    expect((await importRow(importer, "COST-IMPORT-1")).status).toBe(201);
    expect((await importRow([...importer, CostPermission.Item], "COST-IMPORT-2")).status).toBe(201);
    expect(await costOf("COST-IMPORT-1")).toBeNull();
    expect(await costOf("COST-IMPORT-2")).toBe("12.500000");
  });

  it("a valuation viewer holds item cost, so the valuation report answers it", async () => {
    const answer = await as(["inventory.valuation.view"], { method: Method.Get, path: "/reports/inventory/valuation", expect: Expect.Refuse, costKeys: [] });
    expect(answer.status).toBe(200);
  });

  it("a van trip's stock reconciliation steps carry no value without the right, and its cash steps keep theirs", async () => {
    type Trips = { settlement: { reconciliation: { steps: { kind: VanReconciliationStepKind; value: string | null }[] } | null } | null }[];
    const stepsOf = (body: unknown) => (body as Trips).flatMap((trip) => trip.settlement?.reconciliation?.steps ?? []);
    const probe = { method: Method.Get, path: "/field/van-trips", expect: Expect.Omit, costKeys: [] };
    const without = stepsOf((await as(VIEWER, probe)).body);
    const held = stepsOf((await as([...VIEWER, CostPermission.Item], probe)).body);
    expect(held.some((step) => VAN_STOCK_STEP_KINDS.has(step.kind) && step.value !== null)).toBe(true);
    expect(without.filter((step) => VAN_STOCK_STEP_KINDS.has(step.kind) && step.value !== null)).toEqual([]);
    expect(without.filter((step) => !VAN_STOCK_STEP_KINDS.has(step.kind))).toEqual(held.filter((step) => !VAN_STOCK_STEP_KINDS.has(step.kind)));
  });

  it("a template write without the right neither stores a default cost nor hands one to the variants it generates", async () => {
    const writer = [...VIEWER, "inventory.template.manage", "inventory.template.generate"];
    const write = (method: Method, path: string, body: unknown) => as(writer, { method, path, body, expect: Expect.Omit, costKeys: [] });
    const created = await write(Method.Post, "/inventory/product-templates", { code: "COSTTPL", nameAr: "قالب اختبار التكلفة", baseUnitCode: "PCS", defaultSalePrice: "50.00", defaultCost: "33.00" });
    expect(created.status).toBe(201);
    const templateId = (created.body as { id: string }).id;
    expect(((await world.request("GET", `/inventory/product-templates/${templateId}`)).body as { defaultCost: string | null }).defaultCost).toBeNull();
    const withAttribute = await write(Method.Post, `/inventory/product-templates/${templateId}/attributes`, { nameAr: "اللون", values: ["أحمر"] });
    expect(withAttribute.status).toBe(201);
    const attributeId = (withAttribute.body as { attributes: { id: string }[] }).attributes[0]!.id;
    const generated = await write(Method.Post, `/inventory/product-templates/${templateId}/variants/generate`, { selections: [{ values: { [attributeId]: "أحمر" } }] });
    expect(generated.status).toBe(201);
    const itemId = (generated.body as { created: { itemId: string }[] }).created[0]!.itemId;
    expect(((await world.request("GET", `/items/${itemId}`)).body as { costPrice: string | null }).costPrice).toBeNull();
  });
});
