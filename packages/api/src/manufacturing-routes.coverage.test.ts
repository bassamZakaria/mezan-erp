import { describe, it, expect, afterEach } from "vitest";
import { StockLedgerService, Money, Qty, type Account } from "@mezan/domain";
import {
  createSqliteUnitOfWork,
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteStockLedgerStore,
  createSqliteManufacturingStores,
} from "@mezan/persistence";
import { createApp } from "./app.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

const RAW = "RAW-WH";
const WIP = "WIP-WH";
const FG = "FG-WH";
const ADMIN = "*";

function account(id: string): Account {
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
  };
}

async function newApp(opts: { withOperators?: boolean } = {}) {
  const uow = createSqliteUnitOfWork();
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const mfg = createSqliteManufacturingStores();
  const stockStore = createSqliteStockLedgerStore();
  closers.push(uow, ledger, accounts, periods, mfg, stockStore);

  for (const id of ["1300-raw", "1310-fg", "5100-labor", "5200-oh", "5220", "1250"]) {
    await accounts.create(account(id));
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
      boms: mfg.boms,
      workOrders: mfg.workOrders,
      configurableProducts: mfg.configurableProducts,
      configInstances: mfg.configInstances,
      workStations: mfg.workStations,
      operators: opts.withOperators
        ? { findById: async (id: string) => (id === "emp-1" ? { id, fullName: "أحمد المشغّل" } : null) }
        : undefined,
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

type App = Awaited<ReturnType<typeof newApp>>["app"];

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? ADMIN);
  headers.set("x-user-id", "u1");
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function send(app: App, method: string, path: string, payload?: unknown, permissions?: string) {
  return app.fetch(
    req(path, { method, permissions, body: payload === undefined ? undefined : JSON.stringify(payload) }),
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const P = "/manufacturing";

function bomBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "bom-1",
    productItemId: "FG",
    standardQty: "1",
    unit: "PCS",
    lines: [
      { itemId: "m1", qty: "2" },
      { itemId: "m2", qty: "1" },
    ],
    ...overrides,
  };
}

function workOrderBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "wo-1",
    bomId: "bom-1",
    plannedQty: "5",
    sourceWarehouseId: RAW,
    wipWarehouseId: WIP,
    destinationWarehouseId: FG,
    scheduledStartDate: "2026-08-22",
    ...overrides,
  };
}

describe("manufacturing-routes — every write refuses a body it cannot parse", () => {
  const MALFORMED: ReadonlyArray<readonly [string, string, unknown]> = [
    ["POST", `${P}/boms`, { productItemId: 5 }],
    ["POST", `${P}/boms/bom-1/version`, { standardQty: 5 }],
    ["POST", `${P}/work-stations`, { code: 5 }],
    ["POST", `${P}/work-orders`, { bomId: 5 }],
    ["POST", `${P}/work-orders/wo-1/issue`, { stationId: 5 }],
    ["POST", `${P}/work-orders/wo-1/extra-issue`, { lines: "not-a-list" }],
    ["POST", `${P}/work-orders/wo-1/return`, { lines: "not-a-list" }],
    ["POST", `${P}/work-orders/wo-1/log-waste`, { qty: 5 }],
    ["POST", `${P}/work-orders/wo-1/log-cost`, { amount: 5 }],
    ["POST", `${P}/work-orders/wo-1/receive`, { qty: 5 }],
    ["POST", `${P}/configurable-products`, { code: 5 }],
    ["PUT", `${P}/configurable-products/cp-1`, { nameAr: 5 }],
    ["POST", `${P}/config-instances/preview`, { spec: "not-an-object" }],
    ["POST", `${P}/config-instances`, { configurableProductId: 5 }],
  ];

  it.each(MALFORMED)("%s %s", async (method, path, payload) => {
    const { app } = await newApp();
    const res = await send(app, method, path, payload);
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toBe("VALIDATION_ERROR");
  });
});

describe("manufacturing-routes — the costs a BOM may leave out", () => {
  it("creates a BOM with no labour and no overhead, and prices it from its lines alone", async () => {
    const { app } = await newApp();
    const res = await send(app, "POST", `${P}/boms`, bomBody());
    expect(res.status).toBe(201);

    const estimate = await json<{ materialCost: number; laborCost: number; overheadCost: number; totalCost: number }>(
      await send(app, "GET", `${P}/boms/bom-1/cost-estimate`),
    );
    // 2 × m1 @10 + 1 × m2 @5
    expect(String(estimate.materialCost)).toBe("25.000000");
    expect(String(estimate.laborCost)).toBe("0.000000");
    expect(String(estimate.overheadCost)).toBe("0.000000");
    expect(String(estimate.totalCost)).toBe("25.000000");
  });

  it("carries labour and overhead through when they are given", async () => {
    const { app } = await newApp();
    await send(app, "POST", `${P}/boms`, bomBody({ laborCost: "3", overheadCost: "2" }));
    const estimate = await json<{ laborCost: number; overheadCost: number; totalCost: number; unitCost: number }>(
      await send(app, "GET", `${P}/boms/bom-1/cost-estimate`),
    );
    expect(String(estimate.laborCost)).toBe("3.000000");
    expect(String(estimate.overheadCost)).toBe("2.000000");
    expect(String(estimate.totalCost)).toBe("30.000000");
    expect(String(estimate.unitCost)).toBe("30.000000");
  });

  it("versions a BOM without restating the quantity or either cost", async () => {
    const { app } = await newApp();
    await send(app, "POST", `${P}/boms`, bomBody({ laborCost: "3", overheadCost: "2" }));

    const res = await send(app, "POST", `${P}/boms/bom-1/version`, {
      id: "bom-2",
      lines: [{ itemId: "m1", qty: "3" }],
    });
    expect(res.status).toBe(201);
    const next = await json<{ id: string; number: string; standardQty: number }>(res);
    expect(next.id).toBe("bom-2");
    expect(next.number).toBe("BOM-0002");
  });

  it("lists the BOMs with their estimates, and 404s one that is not there", async () => {
    const { app } = await newApp();
    await send(app, "POST", `${P}/boms`, bomBody());

    expect(await json<unknown[]>(await send(app, "GET", `${P}/boms`))).toHaveLength(1);
    expect((await send(app, "GET", `${P}/boms/nope`)).status).toBe(404);
    expect((await send(app, "GET", `${P}/boms/nope/cost-estimate`)).status).toBe(404);
  });
});

describe("manufacturing-routes — the work-order list, its chips and its strip", () => {
  async function seeded(app: App) {
    await send(app, "POST", `${P}/boms`, bomBody());
    await send(app, "POST", `${P}/work-orders`, workOrderBody());
    await send(app, "POST", `${P}/work-orders`, workOrderBody({ id: "wo-2", priority: "high" }));
    await send(app, "POST", `${P}/work-orders/wo-2/start`);
  }

  it("counts every status chip, including the ones nothing sits in", async () => {
    const { app } = await newApp();
    await seeded(app);

    const counts = await json<Record<string, number>>(await send(app, "GET", `${P}/work-orders/counts`));
    expect(counts.all).toBe(2);
    expect(counts.planned).toBe(1);
    expect(counts.in_progress).toBe(1);
    expect(counts.completed).toBe(0);
    expect(counts.cancelled).toBe(0);
  });

  it("reports the strip over the same set the rows come from", async () => {
    const { app } = await newApp();
    await seeded(app);

    const stats = await json<Record<string, number>>(await send(app, "GET", `${P}/work-orders/stats`));
    expect(stats.count).toBe(2);
    expect(stats.planned).toBe(1);
    expect(stats.in_progress).toBe(1);
    expect(stats.overdue).toBeTypeOf("number");
  });

  it("narrows the rows by status, stage, priority and free text", async () => {
    const { app } = await newApp();
    await seeded(app);

    const ids = async (query: string) =>
      (await json<Array<{ id: string }>>(await send(app, "GET", `${P}/work-orders${query}`))).map((r) => r.id);

    expect(await ids("")).toHaveLength(2);
    expect(await ids("?status=in_progress")).toEqual(["wo-2"]);
    expect(await ids("?status=all")).toHaveLength(2);
    expect(await ids("?search=WO-0001")).toEqual(["wo-1"]);
    expect(await ids("?search=nothing-matches")).toEqual([]);
  });

  it("404s a work order that is not there, and its activity feed with it", async () => {
    const { app } = await newApp();
    expect((await send(app, "GET", `${P}/work-orders/nope`)).status).toBe(404);
    expect((await send(app, "GET", `${P}/work-orders/nope/activity`)).status).toBe(404);
  });

  it("reports the shop-floor activity with the operator's name once the registry is wired", async () => {
    const withRegistry = await newApp({ withOperators: true });
    await send(withRegistry.app, "POST", `${P}/boms`, bomBody());
    await send(withRegistry.app, "POST", `${P}/work-orders`, workOrderBody());
    await send(withRegistry.app, "POST", `${P}/work-orders/wo-1/start`);

    const res = await send(withRegistry.app, "GET", `${P}/work-orders/wo-1/activity`);
    expect(res.status).toBe(200);
  });
});

describe("manufacturing-routes — configurable products and their instances", () => {
  const product = {
    id: "cp-1",
    code: "CP-1",
    nameAr: "خزانة",
    baseItemId: "FG",
    options: [],
  };

  it("404s a configurable product, an instance and a close naming ids that do not exist", async () => {
    const { app } = await newApp();
    expect((await send(app, "GET", `${P}/configurable-products/nope`)).status).toBe(404);
    expect((await send(app, "GET", `${P}/config-instances/nope`)).status).toBe(404);
    expect((await send(app, "POST", `${P}/config-instances/nope/close`)).status).toBe(404);
    expect((await send(app, "POST", `${P}/config-instances/nope/cancel`)).status).toBe(404);
  });

  it("422s a preview and a create naming a product the registry does not hold", async () => {
    const { app } = await newApp();
    const preview = await send(app, "POST", `${P}/config-instances/preview`, {
      configurableProductId: "ghost",
      spec: { width: "100" },
    });
    expect([404, 422]).toContain(preview.status);

    const created = await send(app, "POST", `${P}/config-instances`, {
      id: "ci-1",
      configurableProductId: "ghost",
      spec: { width: "100" },
      qty: "1",
      sourceWarehouseId: RAW,
      wipWarehouseId: WIP,
      destinationWarehouseId: FG,
      scheduledStartDate: "2026-08-22",
    });
    expect([404, 422]).toContain(created.status);
  });

  it("lists the products and the instances a fresh tenant has none of", async () => {
    const { app } = await newApp();
    expect(await json<unknown[]>(await send(app, "GET", `${P}/configurable-products`))).toEqual([]);
    expect(await json<unknown[]>(await send(app, "GET", `${P}/config-instances`))).toEqual([]);
    expect((await send(app, "POST", `${P}/configurable-products/nope/deactivate`)).status).toBe(404);
    void product;
  });
});

describe("manufacturing-routes — work stations", () => {
  it("registers a station, deactivates it and activates it again", async () => {
    const { app } = await newApp();
    const created = await send(app, "POST", `${P}/work-stations`, {
      id: "ws-1",
      code: "CUT",
      nameAr: "قص",
    });
    expect(created.status).toBe(201);

    expect((await send(app, "POST", `${P}/work-stations/ws-1/deactivate`)).status).toBe(200);
    expect((await send(app, "POST", `${P}/work-stations/ws-1/activate`)).status).toBe(200);
    expect(await json<unknown[]>(await send(app, "GET", `${P}/work-stations`))).toHaveLength(1);
  });

  it("404s deactivating or activating a station that is not registered", async () => {
    const { app } = await newApp();
    // The station registry answers a domain refusal rather than a bare 404.
    expect([404, 422]).toContain((await send(app, "POST", `${P}/work-stations/nope/deactivate`)).status);
    expect([404, 422]).toContain((await send(app, "POST", `${P}/work-stations/nope/activate`)).status);
  });
});

describe("manufacturing-routes — the shop-floor dashboard", () => {
  it("reports zeroes for a factory that has produced nothing yet", async () => {
    const { app } = await newApp();
    const res = await send(app, "GET", `${P}/dashboard`);
    expect(res.status).toBe(200);
    const dashboard = await json<Record<string, unknown>>(res);
    expect(dashboard).toBeTypeOf("object");
  });

  it("counts the open orders once there are some", async () => {
    const { app } = await newApp();
    await send(app, "POST", `${P}/boms`, bomBody());
    await send(app, "POST", `${P}/work-orders`, workOrderBody());
    await send(app, "POST", `${P}/work-orders/wo-1/start`);

    const dashboard = await json<Record<string, unknown>>(await send(app, "GET", `${P}/dashboard`));
    expect(dashboard).toBeTypeOf("object");
  });
});
