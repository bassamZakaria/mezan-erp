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

async function newApp() {
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
