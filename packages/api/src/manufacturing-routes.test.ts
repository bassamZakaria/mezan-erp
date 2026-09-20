import { describe, it, expect, afterEach } from "vitest";
import { StockLedgerService, Money, Qty, type Account, type WorkStation, type WorkStationRepository } from "@mezan/domain";
import {
  createSqliteUnitOfWork,
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteStockLedgerStore,
  createSqliteManufacturingStores,
} from "@mezan/persistence";
import { createApp } from "./app.js";
import { createManufacturingRoutes, type ManufacturingRoutesDeps } from "./manufacturing-routes.js";
import {
  InMemoryBoms,
  InMemoryWorkOrders,
  InMemoryConfigurableProducts,
  InMemoryConfigInstances,
  makeNumbering,
  makeStock,
  RecordingGlPort,
} from "../../domain/src/manufacturing/test-helpers.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
import { MasterDataKind, type MasterDataChecks, type MasterRecordCheck } from "./master-data-check.js";
class InMemoryWorkStations implements WorkStationRepository {
  readonly rows = new Map<string, WorkStation>();
  async findById(id: string): Promise<WorkStation | null> {
    return this.rows.get(id) ?? null;
  }
  async findByCode(code: string): Promise<WorkStation | null> {
    return [...this.rows.values()].find((w) => w.code === code) ?? null;
  }
  async list(): Promise<WorkStation[]> {
    return [...this.rows.values()];
  }
  async create(s: WorkStation): Promise<void> {
    this.rows.set(s.id, s);
  }
  async update(s: WorkStation): Promise<void> {
    this.rows.set(s.id, s);
  }
}

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

const RAW = "RAW-WH";
const WIP = "WIP-WH";
const FG = "FG-WH";
const ADMIN = "*";

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
  };
}

async function newApp(masterData?: MasterDataChecks) {
  const uow = createSqliteUnitOfWork();
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const mfg = createSqliteManufacturingStores();
  const stockStore = createSqliteStockLedgerStore();
  closers.push(uow, ledger, accounts, periods, mfg, stockStore);

  for (const id of ["1300-raw", "1310-fg", "5100-labor", "5200-oh"]) {
    await accounts.create(account(id, id === "1310-fg" ? {} : {}));
  }
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open",
  });

  const stock = new StockLedgerService({
    ledger: stockStore.ledger,
    layers: stockStore.layers,
    snapshots: stockStore.snapshots,
    policy: { allowNegativeStock: false },
    clock: () => "2026-08-22T00:00:00.000Z",
  });
  // Seed raw material stock (m1 @10, m2 @5) in the source warehouse.
  await stock.recordOpeningBalance({
    adjustmentId: "open",
    warehouseId: RAW,
    lines: [
      { itemId: "m1", qty: Qty.fromMajor("100"), unitCost: Money.fromMajor("10") },
      { itemId: "m2", qty: Qty.fromMajor("100"), unitCost: Money.fromMajor("5") },
    ],
  });

  const app = createApp(uow, {
    manufacturing: {
      ...(masterData ? { masterData } : {}),
      boms: mfg.boms,
      workOrders: mfg.workOrders,
      configurableProducts: mfg.configurableProducts,
      configInstances: mfg.configInstances,
      workStations: mfg.workStations,
      numbering: ledger.numbering,
      stock,
      gl: { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-22T10:00:00.000Z" },
      accounts: {
        finishedGoodsAccountId: "1310-fg",
        rawInventoryAccountId: "1300-raw",
        laborAppliedAccountId: "5100-labor",
        overheadAppliedAccountId: "5200-oh",
  abnormalScrapAccountId: "5220",
  wipAccountId: "1250",
      },
      resolveUnitCost: async (id) => (await stock.getBalanceDetail(id, RAW)).averageCost,
      now: () => "2026-08-22T00:00:00.000Z",
    },
  });
  return { app, ledger, stock };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const body = (res: Response): Promise<Record<string, any>> => res.json() as Promise<Record<string, any>>;

const bomBody = {
  id: "bom-1",
  productItemId: "FG",
  standardQty: "1",
  unit: "PCS",
  laborCost: "3",
  overheadCost: "2",
  lines: [
    { itemId: "m1", qty: "2" },
    { itemId: "m2", qty: "1" },
  ],
};

describe("manufacturing-routes — permission gates", () => {
  it("403s creating a BOM without manufacturing.bom.manage", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/manufacturing/boms", { method: "POST", body: JSON.stringify(bomBody) }));
    expect(res.status).toBe(403);
  });

  it("403s executing a work order without manufacturing.wo.execute", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/manufacturing/work-orders/x/issue", { method: "POST", permissions: "manufacturing.wo.view" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("manufacturing-routes — BOM versioning", () => {
  it("supersedes the prior active version when a new BOM is created", async () => {
    const { app } = await newApp();
    let res = await app.fetch(req("/manufacturing/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    expect(res.status).toBe(201);
    expect((await body(res)).number).toBe("BOM-0001");

    res = await app.fetch(
      req("/manufacturing/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify({ ...bomBody, id: "bom-2" }) }),
    );
    const v2 = await body(res);
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("active");

    res = await app.fetch(req("/manufacturing/boms/bom-1", { permissions: ADMIN }));
    expect((await body(res)).status).toBe("inactive");
  });
});

describe("manufacturing-routes — full 4-stage work order (stock + GL + WIP)", () => {
  it("drives start → issue → receive → complete and posts a balanced WIP entry", async () => {
    const { app, ledger, stock } = await newApp();

    await app.fetch(req("/manufacturing/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));

    let res = await app.fetch(
      req("/manufacturing/work-orders", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "wo-1",
          bomId: "bom-1",
          plannedQty: "10",
          sourceWarehouseId: RAW,
          wipWarehouseId: WIP,
          destinationWarehouseId: FG,
          scheduledStartDate: "2026-08-22",
          scheduledEndDate: "2026-08-25",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const wo = await body(res);
    expect(wo.number).toBe("WO-0001");
    expect(wo.laborCost).toBe("30.000000");

    const post = (action: string, body?: unknown) =>
      app.fetch(
        req(`/manufacturing/work-orders/wo-1/${action}`, {
          method: "POST",
          permissions: ADMIN,
          body: body ? JSON.stringify(body) : undefined,
        }),
      );

    expect((await body(await post("start"))).stage).toBe("started");

    const issued = await body(await post("issue"));
    expect(issued.stage).toBe("materials_issued");
    expect(issued.materialCost).toBe("250.000000");
    expect(issued.wipTotal).toBe("300.000000");
    expect((await stock.getBalance("m1", RAW)).toString()).toBe("80.000000");

    const received = await body(await post("receive", { producedQty: "10" }));
    expect(received.stage).toBe("product_received");
    expect((await stock.getBalanceDetail("FG", FG)).totalValue.toString()).toBe("300.000000");

    const completed = await body(await post("complete"));
    expect(completed.status).toBe("completed");
    expect(completed.glPosted).toBe(true);

    // Balanced JE posted: Dr FG 300 ; Cr raw 250 / labour 30 / overhead 20.
    const fg = await ledger.accountBalance("1310-fg");
    const raw = await ledger.accountBalance("1300-raw");
    const labor = await ledger.accountBalance("5100-labor");
    const oh = await ledger.accountBalance("5200-oh");
    expect(fg.debit.toString()).toBe("300.000000");
    expect(raw.credit.toString()).toBe("250.000000");
    expect(labor.credit.toString()).toBe("30.000000");
    expect(oh.credit.toString()).toBe("20.000000");
  });
});

describe("manufacturing-routes — configurable products + custom manufacturing", () => {
  const productBody = {
    id: "cp-1",
    code: "WINDOW",
    nameAr: "نافذة",
    outputItemId: "FG",
    unit: "PCS",
    inputs: [
      { id: "width", labelAr: "العرض", min: 1, max: 100 },
      { id: "height", labelAr: "الطول", min: 1, max: 100 },
    ],
    materials: [
      { itemId: "m1", qtyFormula: "2*(width+height)/100" },
      { itemId: "m2", qtyFormula: "width" },
    ],
    pricingMethod: "formula",
    priceFormula: "width*height*3.5",
    laborFormula: "2*width",
    overheadFormula: "width",
  };

  it("rejects an invalid formula at create (422)", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/manufacturing/configurable-products", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ ...productBody, materials: [{ itemId: "m1", qtyFormula: "2 *" }] }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("creates a product, previews, and spins off a linked work order", async () => {
    const { app } = await newApp();
    let res = await app.fetch(
      req("/manufacturing/configurable-products", { method: "POST", permissions: ADMIN, body: JSON.stringify(productBody) }),
    );
    expect(res.status).toBe(201);

    // preview computes materials/price without persisting.
    res = await app.fetch(
      req("/manufacturing/config-instances/preview", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ configurableProductId: "cp-1", spec: { width: "10", height: "20" } }),
      }),
    );
    const preview = await body(res);
    // per-unit material cost from seeded stock: m1 0.6×10 + m2 10×5 = 56.
    expect(preview.materialCostPerUnit).toBe("56.000000");
    expect(preview.unitPrice).toBe("700.000000");

    // create a custom manufacturing order → auto-generates a work order.
    res = await app.fetch(
      req("/manufacturing/config-instances", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "ci-1",
          configurableProductId: "cp-1",
          spec: { width: "10", height: "20" },
          qty: "2",
          sourceWarehouseId: RAW,
          wipWarehouseId: WIP,
          destinationWarehouseId: FG,
          scheduledStartDate: "2026-08-22",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const instance = await body(res);
    expect(instance.number).toBe("CM-000001");
    expect(instance.sellTotal).toBe("1400.000000");

    // the linked work order exists and points back to the instance.
    res = await app.fetch(req(`/manufacturing/work-orders/${instance.workOrderId}`, { permissions: ADMIN }));
    expect(res.status).toBe(200);
    expect((await body(res)).configInstanceId).toBe("ci-1");
  });
});

describe("manufacturing-routes — production dashboard", () => {
  it("summarises active orders into action buckets", async () => {
    const { app } = await newApp();
    await app.fetch(req("/manufacturing/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    await app.fetch(
      req("/manufacturing/work-orders", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "wo-1",
          bomId: "bom-1",
          plannedQty: "10",
          sourceWarehouseId: RAW,
          wipWarehouseId: WIP,
          destinationWarehouseId: FG,
          scheduledStartDate: "2026-08-01",
          scheduledEndDate: "2026-08-10",
        }),
      }),
    );
    await app.fetch(req("/manufacturing/work-orders/wo-1/start", { method: "POST", permissions: ADMIN }));

    const res = await app.fetch(req("/manufacturing/dashboard", { permissions: ADMIN }));
    expect(res.status).toBe(200);
    const d = await body(res);
    expect(d.kpis.activeWorkOrders).toBe(1);
    expect(d.buckets.awaitingMaterialIssue).toHaveLength(1);
    // scheduled end 2026-08-10 is before the clock date 2026-08-22 → overdue.
    expect(d.overdueCount).toBe(1);
  });
});

const woBody = (overrides: Record<string, unknown> = {}) => ({
  id: "wo-1",
  bomId: "bom-1",
  plannedQty: "10",
  sourceWarehouseId: RAW,
  wipWarehouseId: WIP,
  destinationWarehouseId: FG,
  scheduledStartDate: "2026-08-22",
  ...overrides,
});

describe("manufacturing-routes — BOM reads and refusals", () => {
  it("404s a bom, its cost-estimate and its version target when the id is unknown", async () => {
    const { app } = await newApp();
    for (const path of ["/manufacturing/boms/ghost", "/manufacturing/boms/ghost/cost-estimate"]) {
      const res = await app.fetch(req(path, { permissions: ADMIN }));
      expect(res.status).toBe(404);
    }
    const versionRes = await app.fetch(
      req("/manufacturing/boms/ghost/version", { method: "POST", permissions: ADMIN, body: JSON.stringify({ id: "v2" }) }),
    );
    expect(versionRes.status).toBe(404);
  });

  it("409s creating a BOM with a duplicate id", async () => {
    const { app } = await newApp();
    await app.fetch(req("/manufacturing/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    const dupe = await app.fetch(req("/manufacturing/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    expect(dupe.status).toBe(409);
    expect((await body(dupe)).error).toBe("DUPLICATE_MANUFACTURING_DOCUMENT");
  });

  it("computes the standard cost estimate and deactivates a BOM", async () => {
    const { app } = await newApp();
    await app.fetch(req("/manufacturing/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    const est = await app.fetch(req("/manufacturing/boms/bom-1/cost-estimate", { permissions: ADMIN }));
    expect(est.status).toBe(200);
    // material: 2×10 + 1×5 = 25; + labour 3 + overhead 2 = 30.
    const estBody = await body(est);
    expect(estBody.materialCost).toBe("25.000000");
    expect(estBody.totalCost).toBe("30.000000");

    const deactivated = await app.fetch(req("/manufacturing/boms/bom-1/deactivate", { method: "POST", permissions: ADMIN }));
    expect((await body(deactivated)).status).toBe("inactive");
  });
});

describe("manufacturing-routes — work-order list, filters, counts and stats", () => {
  it("filters by status/priority/stage/search, counts ignore the status filter, and stats count overdue orders", async () => {
    const { app } = await newApp();
    await app.fetch(req("/manufacturing/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    await app.fetch(
      req("/manufacturing/work-orders", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify(woBody({ id: "wo-a", priority: "high", scheduledEndDate: "2026-08-10" })),
      }),
    );
    await app.fetch(
      req("/manufacturing/work-orders", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify(woBody({ id: "wo-b", priority: "low", scheduledEndDate: "2026-09-30" })),
      }),
    );
    await app.fetch(req("/manufacturing/work-orders/wo-a/start", { method: "POST", permissions: ADMIN }));

    const byStatus = await app.fetch(req("/manufacturing/work-orders?status=planned", { permissions: ADMIN }));
    const byStatusBody = (await body(byStatus)) as { id: string }[];
    expect(byStatusBody).toHaveLength(1);
    expect(byStatusBody[0]?.id).toBe("wo-b");

    const byPriority = await app.fetch(req("/manufacturing/work-orders?priority=high", { permissions: ADMIN }));
    expect(((await body(byPriority)) as { id: string }[]).map((o) => o.id)).toEqual(["wo-a"]);

    const byStage = await app.fetch(req("/manufacturing/work-orders?stage=started", { permissions: ADMIN }));
    expect(((await body(byStage)) as { id: string }[]).map((o) => o.id)).toEqual(["wo-a"]);

    const bySearch = await app.fetch(req("/manufacturing/work-orders?search=WO-0002", { permissions: ADMIN }));
    expect(((await body(bySearch)) as { id: string }[]).map((o) => o.id)).toEqual(["wo-b"]);

    const noMatch = await app.fetch(req("/manufacturing/work-orders?search=no-such-order", { permissions: ADMIN }));
    expect(await body(noMatch)).toEqual([]);

    // Counts ignore ?status= — every chip reports what it WOULD show.
    const counts = await app.fetch(req("/manufacturing/work-orders/counts?status=planned", { permissions: ADMIN }));
    const countsBody = await body(counts);
    expect(countsBody).toMatchObject({ all: 2, planned: 1, in_progress: 1 });

    // wo-a is in_progress with scheduledEndDate 2026-08-10, before the clock date (2026-08-22) → overdue.
    const stats = await app.fetch(req("/manufacturing/work-orders/stats", { permissions: ADMIN }));
    expect(await body(stats)).toMatchObject({ count: 2, planned: 1, in_progress: 1, overdue: 1 });
  });

  it("404s a work order and its activity feed for an unknown id", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/manufacturing/work-orders/ghost", { permissions: ADMIN }));
    expect(res.status).toBe(404);
    const activity = await app.fetch(req("/manufacturing/work-orders/ghost/activity", { permissions: ADMIN }));
    expect(activity.status).toBe(404);
  });

  it("reports an empty activity feed when no ledger/journal/audit sink is wired", async () => {
    const { app } = await newApp();
    await app.fetch(req("/manufacturing/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    await app.fetch(req("/manufacturing/work-orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(woBody()) }));
    const res = await app.fetch(req("/manufacturing/work-orders/wo-1/activity", { permissions: ADMIN }));
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ movements: [], receipts: [], journalEntries: [], auditEvents: [] });
  });
});

describe("manufacturing-routes — extra-issue, return, log-waste, log-cost", () => {
  async function issuedOrder(app: Awaited<ReturnType<typeof newApp>>["app"]) {
    await app.fetch(req("/manufacturing/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    await app.fetch(req("/manufacturing/work-orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(woBody()) }));
    await app.fetch(req("/manufacturing/work-orders/wo-1/start", { method: "POST", permissions: ADMIN }));
    await app.fetch(req("/manufacturing/work-orders/wo-1/issue", { method: "POST", permissions: ADMIN }));
  }

  it("extra-issues more material, adding to issuedQty and materialCost", async () => {
    const { app } = await newApp();
    await issuedOrder(app);
    const res = await app.fetch(
      req("/manufacturing/work-orders/wo-1/extra-issue", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ lines: [{ itemId: "m1", qty: "3" }] }),
      }),
    );
    expect(res.status).toBe(200);
    const out = await body(res);
    // 20 issued + 3 extra of m1 @10 = 230; plus 10 of m2 @5 = 50 → 280.
    expect(out.materialCost).toBe("280.000000");
    expect(out.materials.find((m: { itemId: string }) => m.itemId === "m1").issuedQty).toBe("23.000000");
  });

  it("409s extra-issue and return before materials are issued", async () => {
    const { app } = await newApp();
    await app.fetch(req("/manufacturing/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    await app.fetch(req("/manufacturing/work-orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(woBody()) }));
    const extra = await app.fetch(
      req("/manufacturing/work-orders/wo-1/extra-issue", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ lines: [{ itemId: "m1", qty: "1" }] }),
      }),
    );
    expect(extra.status).toBe(409);
    const ret = await app.fetch(
      req("/manufacturing/work-orders/wo-1/return", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ lines: [{ itemId: "m1", qty: "1" }] }),
      }),
    );
    expect(ret.status).toBe(409);
  });

  it("returns unused material and reduces materialCost by the value the ledger says left WIP", async () => {
    const { app, stock } = await newApp();
    await issuedOrder(app);
    const res = await app.fetch(
      req("/manufacturing/work-orders/wo-1/return", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ lines: [{ itemId: "m1", qty: "5" }] }),
      }),
    );
    expect(res.status).toBe(200);
    // 5 of m1 @10 walks back → materialCost 250 − 50 = 200.
    expect((await body(res)).materialCost).toBe("200.000000");
    expect((await stock.getBalance("m1", RAW)).toString()).toBe("85.000000");
  });

  it("400s a malformed line-action body, naming the field", async () => {
    const { app } = await newApp();
    await issuedOrder(app);
    const res = await app.fetch(
      req("/manufacturing/work-orders/wo-1/return", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ lines: [] }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("VALIDATION_ERROR");
  });

  it("logs a cost and capitalises it into WIP", async () => {
    const { app } = await newApp();
    await issuedOrder(app);
    const res = await app.fetch(
      req("/manufacturing/work-orders/wo-1/log-cost", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ kind: "labor", amount: "15" }),
      }),
    );
    expect(res.status).toBe(200);
    const out = await body(res);
    // standard labour 30 + logged 15 = 45.
    expect(out.laborCost).toBe("45.000000");
    expect(out.wipTotal).toBe("315.000000"); // 250 material + 45 labour + 20 overhead
  });

  it("422s a zero logged cost", async () => {
    const { app } = await newApp();
    await issuedOrder(app);
    const res = await app.fetch(
      req("/manufacturing/work-orders/wo-1/log-cost", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ kind: "other", amount: "0" }),
      }),
    );
    expect(res.status).toBe(422);
  });
});

describe("manufacturing-routes — cancel", () => {
  it("cancels a not-yet-started order", async () => {
    const { app } = await newApp();
    await app.fetch(req("/manufacturing/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    await app.fetch(req("/manufacturing/work-orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(woBody()) }));
    const res = await app.fetch(req("/manufacturing/work-orders/wo-1/cancel", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(200);
    expect((await body(res)).status).toBe("cancelled");
  });

  it("409s cancelling a work order past material issue, leaving the issued material standing in WIP", async () => {
    const { app, stock } = await newApp();
    await app.fetch(req("/manufacturing/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    await app.fetch(req("/manufacturing/work-orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(woBody()) }));
    await app.fetch(req("/manufacturing/work-orders/wo-1/start", { method: "POST", permissions: ADMIN }));
    await app.fetch(req("/manufacturing/work-orders/wo-1/issue", { method: "POST", permissions: ADMIN }));

    const res = await app.fetch(req("/manufacturing/work-orders/wo-1/cancel", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe("WORK_ORDER_STAGE_INVALID");

    // The order is stuck: cancel is refused, and the 20 units of m1 issued
    // into WIP before the refusal are neither reversed nor recoverable through
    // this endpoint — they remain there, unreachable except by finishing the run.
    expect((await stock.getBalance("m1", WIP)).toString()).toBe("20.000000");
    const stillIssued = await app.fetch(req("/manufacturing/work-orders/wo-1", { permissions: ADMIN }));
    expect((await body(stillIssued)).stage).toBe("materials_issued");
  });
});

describe("manufacturing-routes — completing twice must not double-post", () => {
  it("409s a second completion and leaves the GL balances exactly as the first completion left them", async () => {
    const { app, ledger } = await newApp();
    await app.fetch(req("/manufacturing/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    await app.fetch(req("/manufacturing/work-orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(woBody()) }));
    await app.fetch(req("/manufacturing/work-orders/wo-1/start", { method: "POST", permissions: ADMIN }));
    await app.fetch(req("/manufacturing/work-orders/wo-1/issue", { method: "POST", permissions: ADMIN }));
    await app.fetch(
      req("/manufacturing/work-orders/wo-1/receive", { method: "POST", permissions: ADMIN, body: JSON.stringify({ producedQty: "10" }) }),
    );
    const first = await app.fetch(req("/manufacturing/work-orders/wo-1/complete", { method: "POST", permissions: ADMIN }));
    expect(first.status).toBe(200);
    const raw1 = await ledger.accountBalance("1300-raw");
    expect(raw1.credit.toString()).toBe("250.000000");

    const second = await app.fetch(req("/manufacturing/work-orders/wo-1/complete", { method: "POST", permissions: ADMIN }));
    expect(second.status).toBe(409);
    expect((await body(second)).error).toBe("WORK_ORDER_STAGE_INVALID");

    const raw2 = await ledger.accountBalance("1300-raw");
    expect(raw2.credit.toString()).toBe("250.000000"); // unchanged — no second posting
  });
});

describe("manufacturing-routes — config instance close and cancel", () => {
  const productBody2 = {
    id: "cp-2",
    code: "SHELF",
    nameAr: "رف",
    outputItemId: "FG",
    unit: "PCS",
    inputs: [{ id: "width", labelAr: "العرض", min: 1, max: 100 }],
    materials: [{ itemId: "m1", qtyFormula: "width" }],
    pricingMethod: "manual",
  };

  async function newInstance(app: Awaited<ReturnType<typeof newApp>>["app"]) {
    await app.fetch(req("/manufacturing/configurable-products", { method: "POST", permissions: ADMIN, body: JSON.stringify(productBody2) }));
    const res = await app.fetch(
      req("/manufacturing/config-instances", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "ci-2",
          configurableProductId: "cp-2",
          spec: { width: "3" },
          qty: "1",
          sourceWarehouseId: RAW,
          wipWarehouseId: WIP,
          destinationWarehouseId: FG,
          scheduledStartDate: "2026-08-22",
        }),
      }),
    );
    return (await body(res)).workOrderId as string;
  }

  it("cancels a config instance and 404s an unknown one", async () => {
    const { app } = await newApp();
    await newInstance(app);
    const res = await app.fetch(req("/manufacturing/config-instances/ci-2/cancel", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(200);
    expect((await body(res)).status).toBe("cancelled");

    const missing = await app.fetch(req("/manufacturing/config-instances/ghost/cancel", { method: "POST", permissions: ADMIN }));
    expect(missing.status).toBe(404);
  });

  it("closes a config instance, freezing actualCost from the linked work order's WIP", async () => {
    const { app } = await newApp();
    const workOrderId = await newInstance(app);
    await app.fetch(req(`/manufacturing/work-orders/${workOrderId}/start`, { method: "POST", permissions: ADMIN }));
    await app.fetch(req(`/manufacturing/work-orders/${workOrderId}/issue`, { method: "POST", permissions: ADMIN }));

    const res = await app.fetch(req("/manufacturing/config-instances/ci-2/close", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(200);
    const out = await body(res);
    expect(out.status).toBe("closed");
    // 3 units of m1 issued @10 = 30 material WIP; no labour/overhead on a manually-priced product.
    expect(out.actualCost).toBe("30.000000");
  });
});

// --- Tests below build the routes directly over in-memory fakes, to reach
// the optional deps (warehouses, operators, positions, activity feeds) the
// createApp() fixture above never wires. ---------------------------------

function fakeDeps(overrides: Partial<ManufacturingRoutesDeps> = {}) {
  const boms = new InMemoryBoms();
  const workOrders = new InMemoryWorkOrders();
  const workStations = new InMemoryWorkStations();
  const configurableProducts = new InMemoryConfigurableProducts();
  const configInstances = new InMemoryConfigInstances();
  const numbering = makeNumbering();
  const stock = makeStock();
  const gl = new RecordingGlPort();
  const now = () => "2026-08-22T09:00:00.000Z";
  const deps: ManufacturingRoutesDeps = {
    boms,
    workOrders,
    workStations,
    configurableProducts,
    configInstances,
    numbering,
    stock,
    gl,
    accounts: {
      finishedGoodsAccountId: "1310-fg",
      rawInventoryAccountId: "1300-raw",
      laborAppliedAccountId: "5100-labor",
      overheadAppliedAccountId: "5200-oh",
      abnormalScrapAccountId: "5220",
      wipAccountId: "1250",
    },
    now,
    ...overrides,
  };
  return { deps, boms, workOrders, workStations, configurableProducts, configInstances, stock, gl, now };
}

async function seedRawStock(stock: StockLedgerService) {
  await stock.recordOpeningBalance({
    adjustmentId: "open",
    warehouseId: RAW,
    lines: [
      { itemId: "m1", qty: Qty.fromMajor("100"), unitCost: Money.fromMajor("10") },
      { itemId: "m2", qty: Qty.fromMajor("100"), unitCost: Money.fromMajor("5") },
    ],
  });
}

describe("manufacturing-routes — warehouse ids are entity references, not free text", () => {
  it("422s a work order naming an unregistered or inactive warehouse", async () => {
    const { deps, stock } = fakeDeps({
      warehouses: {
        findById: async (id: string) => {
          if (id === RAW) return { id: RAW, name: "الخام", active: true };
          if (id === WIP) return { id: WIP, name: "التشغيل", active: false };
          return null;
        },
      },
    });
    await seedRawStock(stock);
    const app = createManufacturingRoutes(deps, insecureHeaderAuthContextResolver);
    await app.fetch(req("/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));

    const res = await app.fetch(
      req("/work-orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(woBody({ destinationWarehouseId: "GHOST-WH" })) }),
    );
    expect(res.status).toBe(422);
    const reasons = (await body(res)).reasons as string[];
    expect(reasons.some((r) => r.includes('"GHOST-WH" غير مسجّل كمستودع'))).toBe(true);
    expect(reasons.some((r) => r.includes("غير مفعّل"))).toBe(true); // wipWarehouseId = WIP, inactive
  });
});

describe("manufacturing-routes — materials columns are derived from real on-hand positions", () => {
  it("computes availableQty, wipOnHandQty and shortageQty from the positions feed, not from the caller", async () => {
    const { deps, stock } = fakeDeps({
      positions: async () => [
        { itemId: "m1", warehouseId: RAW, onHand: 15 },
        { itemId: "m1", warehouseId: WIP, onHand: 4 },
      ],
    });
    await seedRawStock(stock);
    const app = createManufacturingRoutes(deps, insecureHeaderAuthContextResolver);
    await app.fetch(req("/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    await app.fetch(req("/work-orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(woBody()) }));

    const res = await app.fetch(req("/work-orders/wo-1", { permissions: ADMIN }));
    const out = await body(res);
    const m1 = out.materials.find((m: { itemId: string }) => m.itemId === "m1");
    // required 20, issued 0 → shortage = max(0, 20 − 0 − 15) = 5.
    expect(m1.availableQty).toBe("15");
    expect(m1.shortageQty).toBe("5");
    expect(m1.wipOnHandQty).toBe("4");
    const m2 = out.materials.find((m: { itemId: string }) => m.itemId === "m2");
    // m2 has no entry in the positions feed at all → reports 0, not "—"/null.
    expect(m2.availableQty).toBe("0");
    expect(m2.shortageQty).toBe("10");
  });
});

describe("manufacturing-routes — shop-floor attribution resolves station and operator against their registries", () => {
  async function issuedFakeApp(overrides: Partial<ManufacturingRoutesDeps> = {}) {
    const setup = fakeDeps(overrides);
    await seedRawStock(setup.stock);
    const app = createManufacturingRoutes(setup.deps, insecureHeaderAuthContextResolver);
    await app.fetch(req("/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    await app.fetch(req("/work-orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(woBody()) }));
    await app.fetch(req("/work-orders/wo-1/start", { method: "POST", permissions: ADMIN }));
    return { app, ...setup };
  }

  it("422s an operatorId when no employee registry is wired, and when the id does not resolve", async () => {
    const { app } = await issuedFakeApp();
    const noRegistry = await app.fetch(
      req("/work-orders/wo-1/issue", { method: "POST", permissions: ADMIN, body: JSON.stringify({ operatorId: "op-1" }) }),
    );
    expect(noRegistry.status).toBe(422);
    expect((await body(noRegistry)).message).toContain("سجل الموظفين غير متاح");

    const { app: app2 } = await issuedFakeApp({ operators: { findById: async () => null } });
    const notFound = await app2.fetch(
      req("/work-orders/wo-1/issue", { method: "POST", permissions: ADMIN, body: JSON.stringify({ operatorId: "op-ghost" }) }),
    );
    expect(notFound.status).toBe(422);
    expect((await body(notFound)).message).toContain('"op-ghost"');
  });

  it("resolves a valid operator and station onto the shop-floor log", async () => {
    const { app, workStations } = await issuedFakeApp({
      operators: { findById: async (id) => (id === "op-1" ? { id: "op-1", fullName: "أحمد" } : null) },
    });
    await workStations.create({ id: "st-1", code: "ST1", nameAr: "خط التعبئة", nameEn: null, notes: null, status: "active", createdAt: "2026-08-22" });
    const res = await app.fetch(
      req("/work-orders/wo-1/issue", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ operatorId: "op-1", stationId: "st-1" }),
      }),
    );
    expect(res.status).toBe(200);
    const entry = (await body(res)).shopFloorLog.at(-1);
    expect(entry).toMatchObject({ kind: "issue", operatorId: "op-1", stationId: "st-1" });
  });

  it("422s an unknown or inactive station id", async () => {
    const { app, workStations } = await issuedFakeApp();
    const unknown = await app.fetch(
      req("/work-orders/wo-1/issue", { method: "POST", permissions: ADMIN, body: JSON.stringify({ stationId: "st-ghost" }) }),
    );
    expect(unknown.status).toBe(422);

    await workStations.create({ id: "st-2", code: "ST2", nameAr: "معطّلة", nameEn: null, notes: null, status: "inactive", createdAt: "2026-08-22" });
    const inactive = await app.fetch(
      req("/work-orders/wo-1/issue", { method: "POST", permissions: ADMIN, body: JSON.stringify({ stationId: "st-2" }) }),
    );
    expect(inactive.status).toBe(422);
    expect((await body(inactive)).message).toContain("غير مفعّلة");
  });
});

describe("manufacturing-routes — work stations CRUD", () => {
  it("creates, lists, deactivates and reactivates a work station; refuses a duplicate code and an unknown id", async () => {
    const { deps } = fakeDeps();
    const app = createManufacturingRoutes(deps, insecureHeaderAuthContextResolver);
    const create = await app.fetch(
      req("/work-stations", { method: "POST", permissions: ADMIN, body: JSON.stringify({ id: "st-1", code: "ST1", nameAr: "خط 1" }) }),
    );
    expect(create.status).toBe(201);

    const dupe = await app.fetch(
      req("/work-stations", { method: "POST", permissions: ADMIN, body: JSON.stringify({ id: "st-2", code: "ST1", nameAr: "خط 2" }) }),
    );
    expect(dupe.status).toBe(422);

    const list = await app.fetch(req("/work-stations", { permissions: ADMIN }));
    expect(((await body(list)) as unknown[]).length).toBe(1);

    const deactivated = await app.fetch(req("/work-stations/st-1/deactivate", { method: "POST", permissions: ADMIN }));
    expect((await body(deactivated)).status).toBe("inactive");
    const reactivated = await app.fetch(req("/work-stations/st-1/activate", { method: "POST", permissions: ADMIN }));
    expect((await body(reactivated)).status).toBe("active");

    const unknown = await app.fetch(req("/work-stations/ghost/activate", { method: "POST", permissions: ADMIN }));
    expect(unknown.status).toBe(422);
  });
});

describe("manufacturing-routes — activity feed joins station/operator by the shop-floor ref, and splits receipts from material moves", () => {
  it("classifies the finished-goods receipt separately from material movements, and attaches names", async () => {
    const { deps, workStations, stock } = fakeDeps({
      movementsOfDocument: async () => [
        { id: "WO-ISSUE:wo-1:0", itemId: "m1", warehouseId: WIP, direction: "IN", qty: "20", unitCost: "10", occurredAt: "t1" },
        { id: "WO-RECEIVE:wo-1:consume:0", itemId: "m1", warehouseId: WIP, direction: "OUT", qty: "20", unitCost: "10", occurredAt: "t2" },
        { id: "WO-RECEIVE:wo-1:0", itemId: "FG", warehouseId: FG, direction: "IN", qty: "10", unitCost: "30", occurredAt: "t2" },
      ],
      journalEntriesOfDocument: async () => [{ id: "je-1", entryNo: "JE-0001", date: "2026-08-22", memo: "m", status: "posted", totalDebit: "300", totalCredit: "300" }],
      auditOfDocument: async () => [{ action: "complete", actor: "u1", timestamp: "t3", severity: "info" }],
    });
    await seedRawStock(stock);
    await workStations.create({ id: "st-1", code: "ST1", nameAr: "خط 1", nameEn: null, notes: null, status: "active", createdAt: "t0" });
    const app = createManufacturingRoutes(deps, insecureHeaderAuthContextResolver);
    await app.fetch(req("/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    await app.fetch(req("/work-orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(woBody()) }));
    await app.fetch(req("/work-orders/wo-1/start", { method: "POST", permissions: ADMIN }));
    await app.fetch(req("/work-orders/wo-1/issue", { method: "POST", permissions: ADMIN, body: JSON.stringify({ stationId: "st-1" }) }));

    const res = await app.fetch(req("/work-orders/wo-1/activity", { permissions: ADMIN }));
    expect(res.status).toBe(200);
    const out = await body(res);
    expect(out.receipts).toHaveLength(1);
    expect(out.receipts[0].id).toBe("WO-RECEIVE:wo-1:0");
    expect(out.movements.map((m: { id: string }) => m.id).sort()).toEqual(["WO-ISSUE:wo-1:0", "WO-RECEIVE:wo-1:consume:0"]);
    // The issue movement's ref is "WO-ISSUE:wo-1" (the shop-floor entry's `ref`);
    // the movement's own id is "<ref>:0" — the join is a prefix match.
    const issueMovement = out.movements.find((m: { id: string }) => m.id === "WO-ISSUE:wo-1:0");
    expect(issueMovement.stationId).toBe("st-1");
    expect(issueMovement.stationName).toBe("خط 1");
    expect(out.journalEntries).toHaveLength(1);
    expect(out.auditEvents).toHaveLength(1);
  });
});

describe("manufacturing-routes — BOM list, versioning with an explicit line set, and deactivate 404", () => {
  it("lists every BOM with its cost estimate", async () => {
    const { deps, stock } = fakeDeps({
      resolveUnitCost: async (id) => (await stock.getBalanceDetail(id, RAW)).averageCost,
    });
    await seedRawStock(stock);
    const app = createManufacturingRoutes(deps, insecureHeaderAuthContextResolver);
    await app.fetch(req("/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    await app.fetch(req("/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify({ ...bomBody, id: "bom-2", productItemId: "FG2" }) }));
    const res = await app.fetch(req("/boms", { permissions: ADMIN }));
    const list = (await body(res)) as { id: string; estimate: { totalCost: string } }[];
    expect(list).toHaveLength(2);
    // material: 2×10 + 1×5 = 25; + labour 3 + overhead 2 = 30.
    expect(list.find((b) => b.id === "bom-1")?.estimate.totalCost).toBe("30.000000");
  });

  it("creates a new version with an explicit replacement line set", async () => {
    const { deps } = fakeDeps();
    const app = createManufacturingRoutes(deps, insecureHeaderAuthContextResolver);
    await app.fetch(req("/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));
    const res = await app.fetch(
      req("/boms/bom-1/version", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ id: "bom-1-v2", lines: [{ itemId: "m1", qty: "5" }] }),
      }),
    );
    expect(res.status).toBe(201);
    const out = await body(res);
    expect(out.version).toBe(2);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].qty).toBe("5.000000");
  });

  it("404s deactivating an unknown BOM", async () => {
    const { deps } = fakeDeps();
    const app = createManufacturingRoutes(deps, insecureHeaderAuthContextResolver);
    const res = await app.fetch(req("/boms/ghost/deactivate", { method: "POST", permissions: ADMIN }));
    expect(res.status).toBe(404);
  });
});

describe("manufacturing-routes — configurable products reads/updates and config-instance reads", () => {
  const cp = {
    id: "cp-9",
    code: "CP9",
    nameAr: "منتج",
    outputItemId: "FG",
    unit: "PCS",
    inputs: [{ id: "qty", labelAr: "الكمية", min: 1, max: 100 }],
    materials: [{ itemId: "m1", qtyFormula: "1" }],
    pricingMethod: "manual",
  };

  it("lists, reads, updates and deactivates a configurable product; 404s an unknown one", async () => {
    const { deps } = fakeDeps();
    const app = createManufacturingRoutes(deps, insecureHeaderAuthContextResolver);
    await app.fetch(req("/configurable-products", { method: "POST", permissions: ADMIN, body: JSON.stringify(cp) }));

    const list = await app.fetch(req("/configurable-products", { permissions: ADMIN }));
    expect(((await body(list)) as unknown[]).length).toBe(1);

    const found = await app.fetch(req("/configurable-products/cp-9", { permissions: ADMIN }));
    expect(found.status).toBe(200);
    const missing = await app.fetch(req("/configurable-products/ghost", { permissions: ADMIN }));
    expect(missing.status).toBe(404);

    const updated = await app.fetch(
      req("/configurable-products/cp-9", { method: "PUT", permissions: ADMIN, body: JSON.stringify({ ...cp, nameAr: "منتج معدّل" }) }),
    );
    expect(updated.status).toBe(200);
    expect((await body(updated)).nameAr).toBe("منتج معدّل");

    const deactivated = await app.fetch(req("/configurable-products/cp-9/deactivate", { method: "POST", permissions: ADMIN }));
    expect((await body(deactivated)).status).toBe("inactive");
  });

  it("404s a preview against an unknown configurable product", async () => {
    const { deps } = fakeDeps();
    const app = createManufacturingRoutes(deps, insecureHeaderAuthContextResolver);
    const res = await app.fetch(
      req("/config-instances/preview", { method: "POST", permissions: ADMIN, body: JSON.stringify({ configurableProductId: "ghost", spec: {} }) }),
    );
    expect(res.status).toBe(404);
  });

  it("lists and reads config instances; 404s an unknown one", async () => {
    const { deps, stock } = fakeDeps();
    await seedRawStock(stock);
    const app = createManufacturingRoutes(deps, insecureHeaderAuthContextResolver);
    await app.fetch(req("/configurable-products", { method: "POST", permissions: ADMIN, body: JSON.stringify(cp) }));
    await app.fetch(
      req("/config-instances", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "ci-9",
          configurableProductId: "cp-9",
          spec: { qty: "5" },
          qty: "1",
          sourceWarehouseId: RAW,
          wipWarehouseId: WIP,
          destinationWarehouseId: FG,
          scheduledStartDate: "2026-08-22",
        }),
      }),
    );
    const list = await app.fetch(req("/config-instances", { permissions: ADMIN }));
    expect(((await body(list)) as unknown[]).length).toBe(1);
    const found = await app.fetch(req("/config-instances/ci-9", { permissions: ADMIN }));
    expect(found.status).toBe(200);
    const missing = await app.fetch(req("/config-instances/ghost", { permissions: ADMIN }));
    expect(missing.status).toBe(404);
  });
});

describe("manufacturing-routes — dashboard next-action per stage", () => {
  it("names the next action for every stage a work order can be waiting in", async () => {
    const { deps, stock } = fakeDeps();
    await seedRawStock(stock);
    const app = createManufacturingRoutes(deps, insecureHeaderAuthContextResolver);
    await app.fetch(req("/boms", { method: "POST", permissions: ADMIN, body: JSON.stringify(bomBody) }));

    await app.fetch(req("/work-orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(woBody({ id: "wo-notstarted" })) }));
    await app.fetch(req("/work-orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(woBody({ id: "wo-started" })) }));
    await app.fetch(req("/work-orders/wo-started/start", { method: "POST", permissions: ADMIN }));
    await app.fetch(req("/work-orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(woBody({ id: "wo-issued" })) }));
    await app.fetch(req("/work-orders/wo-issued/start", { method: "POST", permissions: ADMIN }));
    await app.fetch(req("/work-orders/wo-issued/issue", { method: "POST", permissions: ADMIN }));
    await app.fetch(req("/work-orders", { method: "POST", permissions: ADMIN, body: JSON.stringify(woBody({ id: "wo-received" })) }));
    await app.fetch(req("/work-orders/wo-received/start", { method: "POST", permissions: ADMIN }));
    await app.fetch(req("/work-orders/wo-received/issue", { method: "POST", permissions: ADMIN }));
    await app.fetch(
      req("/work-orders/wo-received/receive", { method: "POST", permissions: ADMIN, body: JSON.stringify({ producedQty: "10" }) }),
    );

    const res = await app.fetch(req("/dashboard", { permissions: ADMIN }));
    const out = await body(res);
    const nextActionOf = (id: string) => out.activeOrders.find((o: { id: string }) => o.id === id).nextAction;
    expect(nextActionOf("wo-notstarted")).toBe("start");
    expect(nextActionOf("wo-started")).toBe("issue");
    expect(nextActionOf("wo-issued")).toBe("receive");
    expect(nextActionOf("wo-received")).toBe("complete");
  });
});

function roster(...ids: readonly string[]): MasterRecordCheck {
  const held = new Set(ids);
  return { findById: async (id) => (held.has(id) ? { id } : null) };
}

describe("D310 — a configured manufacturing order may not name a customer that does not exist", () => {
  const MASTER_DATA: MasterDataChecks = { [MasterDataKind.Customer]: roster("cust-1") };

  const productBody = {
    id: "cp-1",
    code: "WINDOW",
    nameAr: "نافذة",
    outputItemId: "FG",
    unit: "PCS",
    inputs: [
      { id: "width", labelAr: "العرض", min: 1, max: 100 },
      { id: "height", labelAr: "الطول", min: 1, max: 100 },
    ],
    materials: [
      { itemId: "m1", qtyFormula: "2*(width+height)/100" },
      { itemId: "m2", qtyFormula: "width" },
    ],
    pricingMethod: "formula",
    priceFormula: "width*height*3.5",
    laborFormula: "2*width",
    overheadFormula: "width",
  };

  async function seededProduct() {
    const h = await newApp(MASTER_DATA);
    await h.app.fetch(req("/manufacturing/configurable-products", { method: "POST", permissions: ADMIN, body: JSON.stringify(productBody) }));
    return h.app;
  }

  it("refuses an order whose customer has no master record", async () => {
    const app = await seededProduct();
    const res = await app.fetch(
      req("/manufacturing/config-instances", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "ci-phantom",
          configurableProductId: "cp-1",
          spec: { width: "10", height: "20" },
          qty: "1",
          customerId: "CUST-PHANTOM",
          sourceWarehouseId: RAW,
          wipWarehouseId: WIP,
          destinationWarehouseId: FG,
          scheduledStartDate: "2026-08-22",
        }),
      }),
    );
    expect(res.status).toBe(422);
    const b = (await res.json()) as { error: string; customerIds: string[]; messageEn: string };
    expect(b.error).toBe("CUSTOMER_NOT_FOUND");
    expect(b.customerIds).toEqual(["CUST-PHANTOM"]);
    expect(b.messageEn).toContain("CUST-PHANTOM");
  });

  it("still accepts an order whose customer is real", async () => {
    const app = await seededProduct();
    const res = await app.fetch(
      req("/manufacturing/config-instances", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          id: "ci-real",
          configurableProductId: "cp-1",
          spec: { width: "10", height: "20" },
          qty: "1",
          customerId: "cust-1",
          sourceWarehouseId: RAW,
          wipWarehouseId: WIP,
          destinationWarehouseId: FG,
          scheduledStartDate: "2026-08-22",
        }),
      }),
    );
    expect(res.status).toBe(201);
  });
});
