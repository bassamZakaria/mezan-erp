import { describe, it, expect, afterEach } from "vitest";
import type { Account } from "@mezan/domain";
import {
  DocumentService,
  PhysicalCountService,
  StockLedgerService,
  stockAdjustmentDocumentType,
  stockTransferDocumentType,
  createInventoryOpsStockHook,
  createInventoryGlPostingHook,
  createDocumentWorkflowGate,
  type StockAdjustmentDocLine,
  type StockTransferDocLine,
} from "@mezan/domain";
import {
  createSqliteStockLedgerStore,
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteInventoryOpsStore,
} from "@mezan/persistence";
import {
  createStockAdjustmentsRoutes,
  createStockTransfersRoutes,
  createPhysicalCountsRoutes,
} from "./stock-documents-routes.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

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

async function newHarness() {
  const stockStore = createSqliteStockLedgerStore();
  const glLedger = createSqliteLedgerStore();
  const ops = createSqliteInventoryOpsStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  closers.push(stockStore, glLedger, ops, accounts, periods);

  await accounts.create(account("1200"));
  await accounts.create(account("3100", { type: "equity", naturalBalance: "credit" }));
  await periods.create({
    id: "fp-2026-01",
    year: 2026,
    periodNumber: 1,
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    status: "open",
  });

  const glHook = createInventoryGlPostingHook({
    ledger: glLedger,
    accounts,
    periods,
    numbering: glLedger.numbering,
    now: () => "2026-01-15T10:00:00.000Z",
  });

  const stockLedger = new StockLedgerService({
    ledger: stockStore.ledger,
    layers: stockStore.layers,
    snapshots: stockStore.snapshots,
    policy: { allowNegativeStock: false },
    transaction: (fn) => stockStore.transaction(fn),
    gl: glHook,
  });

  const stockHook = createInventoryOpsStockHook(stockLedger, (reason) =>
    reason === "INITIAL_STOCK" ? { inventoryAccountId: "1200", counterpartAccountId: "3100" } : null,
  );

  const adjustments = new DocumentService<StockAdjustmentDocLine>(stockAdjustmentDocumentType, {
    repo: ops.stockAdjustments,
    numbering: { next: () => glLedger.numbering.next("STOCK_ADJUSTMENT") },
    workflow: createDocumentWorkflowGate(() => null),
    stock: stockHook,
  });
  const transfers = new DocumentService<StockTransferDocLine>(stockTransferDocumentType, {
    repo: ops.stockTransfers,
    numbering: { next: () => glLedger.numbering.next("STOCK_TRANSFER") },
    workflow: createDocumentWorkflowGate(() => null),
    stock: stockHook,
  });
  const counts = new PhysicalCountService({
    repo: ops.physicalCounts,
    stockLedger,
    adjustments,
    numbering: { next: () => glLedger.numbering.next("PHYSICAL_COUNT") },
  });

  return {
    adjustmentsApp: createStockAdjustmentsRoutes(adjustments),
    transfersApp: createStockTransfersRoutes(transfers),
    countsApp: createPhysicalCountsRoutes(counts),
    stockLedger,
  };
}

type App = Awaited<ReturnType<typeof newHarness>>["adjustmentsApp"];

const ADMIN = "*";

function req(
  path: string,
  init: RequestInit & { permissions?: string; warehouseScope?: string } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? ADMIN);
  if (init.warehouseScope !== undefined) headers.set("x-warehouse-scope", init.warehouseScope);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

type ReqInit = Parameters<typeof req>[1];

async function post(app: App, path: string, payload?: unknown, init: ReqInit = {}) {
  return app.fetch(
    req(path, { method: "POST", ...init, body: payload === undefined ? undefined : JSON.stringify(payload) }),
  );
}

async function get(app: App, path: string, init: ReqInit = {}) {
  return app.fetch(req(path, init));
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function adjustmentBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "adj-1",
    date: "2026-01-10",
    memo: "رصيد افتتاحي",
    lines: [
      {
        itemId: "ITEM-A",
        warehouseId: "WH1",
        reason: "INITIAL_STOCK",
        direction: "IN",
        qty: "100",
        unitCost: "10.00",
      },
    ],
    ...overrides,
  };
}

async function seedStock(app: App, id = "adj-seed", warehouseId = "WH1", qty = "100") {
  await post(app, "/draft", adjustmentBody({ id, lines: [
    { itemId: "ITEM-A", warehouseId, reason: "INITIAL_STOCK", direction: "IN", qty, unitCost: "10.00" },
  ] }));
  await post(app, `/${id}/confirm`);
}

describe("stock-adjustments routes — the list, its chips and its strip", () => {
  async function seeded(app: App) {
    await seedStock(app, "adj-1", "WH1");
    await post(
      app,
      "/draft",
      adjustmentBody({
        id: "adj-2",
        date: "2026-01-20",
        memo: "هالك",
        lines: [
          { itemId: "ITEM-A", warehouseId: "WH2", reason: "DAMAGE", direction: "OUT", qty: "1", unitCost: "10.00" },
        ],
      }),
    );
  }

  async function idsOf(app: App, query: string, init: ReqInit = {}) {
    const rows = await json<Array<{ id: string }>>(await get(app, `/${query}`, init));
    return rows.map((r) => r.id);
  }

  it("filters by status, reason, warehouse, both date bounds and free text", async () => {
    const { adjustmentsApp: app } = await newHarness();
    await seeded(app);

    expect(await idsOf(app, "")).toHaveLength(2);
    expect(await idsOf(app, "?status=all")).toHaveLength(2);
    expect(await idsOf(app, "?status=draft")).toEqual(["adj-2"]);
    expect(await idsOf(app, "?status=confirmed")).toEqual(["adj-1"]);
    expect(await idsOf(app, "?reason=DAMAGE")).toEqual(["adj-2"]);
    expect(await idsOf(app, "?warehouseId=WH2")).toEqual(["adj-2"]);
    expect(await idsOf(app, "?fromDate=2026-01-15")).toEqual(["adj-2"]);
    expect(await idsOf(app, "?toDate=2026-01-15")).toEqual(["adj-1"]);
    expect(await idsOf(app, "?search=هالك")).toEqual(["adj-2"]);
    expect(await idsOf(app, "?search=ADJ-000001")).toEqual(["adj-1"]);
  });

  it("scopes the rows by warehouse, and no query parameter widens that (D103)", async () => {
    const { adjustmentsApp: app } = await newHarness();
    await seeded(app);

    expect(await idsOf(app, "", { warehouseScope: "WH2" })).toEqual(["adj-2"]);
    expect(await idsOf(app, "?warehouseId=WH1", { warehouseScope: "WH2" })).toEqual([]);
  });

  it("counts every chip from the filtered set, dropping only the status axis", async () => {
    const { adjustmentsApp: app } = await newHarness();
    await seeded(app);

    const counts = await json<Record<string, number>>(await get(app, "/counts?status=draft"));
    expect(counts).toMatchObject({ all: 2, draft: 1, confirmed: 1 });

    const byReason = await json<Record<string, number>>(await get(app, "/counts?reason=DAMAGE"));
    expect(byReason.all).toBe(1);
  });

  it("honours the status filter in the strip, unlike the chips", async () => {
    const { adjustmentsApp: app } = await newHarness();
    await seeded(app);

    expect(await json<Record<string, number>>(await get(app, "/stats"))).toEqual({
      count: 2,
      draft: 1,
      confirmed: 1,
    });
    expect(await json<Record<string, number>>(await get(app, "/stats?status=draft"))).toEqual({
      count: 1,
      draft: 1,
      confirmed: 0,
    });
  });

  it("serves one adjustment by id and 404s one that is not there", async () => {
    const { adjustmentsApp: app } = await newHarness();
    await seeded(app);
    expect((await json<{ id: string }>(await get(app, "/adj-1"))).id).toBe("adj-1");

    const missing = await get(app, "/nope");
    expect(missing.status).toBe(404);
    expect((await json<{ error: string }>(missing)).error).toBe("DOCUMENT_NOT_FOUND");
  });

  it("409s a draft reusing an id and a confirm on an already-confirmed document", async () => {
    const { adjustmentsApp: app } = await newHarness();
    await seedStock(app, "adj-1");

    expect((await post(app, "/draft", adjustmentBody({ id: "adj-1" }))).status).toBe(409);
    expect((await post(app, "/adj-1/confirm")).status).toBe(409);
  });

  it("422s a confirm that would drive stock negative", async () => {
    const { adjustmentsApp: app } = await newHarness();
    await post(
      app,
      "/draft",
      adjustmentBody({
        id: "adj-out",
        lines: [{ itemId: "ITEM-B", warehouseId: "WH1", reason: "DAMAGE", direction: "OUT", qty: "5" }],
      }),
    );
    const res = await post(app, "/adj-out/confirm");
    expect(res.status).toBe(422);
    const payload = await json<{ error: string; onHand: string; requested: string }>(res);
    expect(payload.error).toBe("NEGATIVE_STOCK");
    expect(payload.onHand).toBe("0.000000");
    expect(payload.requested).toBe("5.000000");
  });

  it("403s the read endpoints for a caller with no inventory.adjustment.view", async () => {
    const { adjustmentsApp: app } = await newHarness();
    for (const path of ["/", "/counts", "/stats", "/adj-1"]) {
      expect((await get(app, path, { permissions: "sales.invoice.view" })).status).toBe(403);
    }
  });
});

describe("stock-transfers routes — the list, its chips and its strip", () => {
  function transferBody(overrides: Record<string, unknown> = {}) {
    return {
      id: "tr-1",
      date: "2026-01-12",
      memo: "نقل",
      lines: [{ itemId: "ITEM-A", fromWarehouseId: "WH1", toWarehouseId: "WH2", qty: "10" }],
      ...overrides,
    };
  }

  it("filters, counts and sums transfers over one chokepoint", async () => {
    const { adjustmentsApp, transfersApp } = await newHarness();
    await seedStock(adjustmentsApp, "adj-1", "WH1");
    await post(transfersApp, "/draft", transferBody());
    await post(transfersApp, "/tr-1/confirm");
    await post(transfersApp, "/draft", transferBody({ id: "tr-2", date: "2026-01-25", memo: "نقل ثانٍ" }));

    const ids = async (query: string, init: ReqInit = {}) =>
      (await json<Array<{ id: string }>>(await get(transfersApp, `/${query}`, init))).map((r) => r.id);

    expect(await ids("")).toHaveLength(2);
    expect(await ids("?status=confirmed")).toEqual(["tr-1"]);
    expect(await ids("?warehouseId=WH2")).toHaveLength(2);
    expect(await ids("?fromDate=2026-01-20")).toEqual(["tr-2"]);
    expect(await ids("?toDate=2026-01-20")).toEqual(["tr-1"]);
    expect(await ids("?search=ثانٍ")).toEqual(["tr-2"]);

    const counts = await json<Record<string, number>>(await get(transfersApp, "/counts?status=draft"));
    expect(counts).toMatchObject({ all: 2, draft: 1, confirmed: 1 });

    expect(await json<Record<string, number>>(await get(transfersApp, "/stats"))).toEqual({
      count: 2,
      draft: 1,
      confirmed: 1,
    });
  });

  it("400s a transfer whose source and destination are the same warehouse", async () => {
    const { transfersApp } = await newHarness();
    const res = await post(
      transfersApp,
      "/draft",
      transferBody({ lines: [{ itemId: "ITEM-A", fromWarehouseId: "WH1", toWarehouseId: "WH1", qty: "1" }] }),
    );
    expect([400, 422]).toContain(res.status);
  });

  it("400s a malformed body and 404s a transfer that is not there", async () => {
    const { transfersApp } = await newHarness();
    expect((await post(transfersApp, "/draft", { id: "tr-1" })).status).toBe(400);
    expect((await get(transfersApp, "/nope")).status).toBe(404);
    expect((await post(transfersApp, "/nope/confirm")).status).toBe(404);
  });

  it("scopes transfer rows by the warehouse either leg touches", async () => {
    const { adjustmentsApp, transfersApp } = await newHarness();
    await seedStock(adjustmentsApp, "adj-1", "WH1");
    await post(transfersApp, "/draft", transferBody());

    const visible = await json<unknown[]>(await get(transfersApp, "/", { warehouseScope: "WH2" }));
    expect(visible).toHaveLength(1);
    const invisible = await json<unknown[]>(await get(transfersApp, "/", { warehouseScope: "WH-OTHER" }));
    expect(invisible).toEqual([]);
  });
});

describe("physical-counts routes — the session and what it reveals", () => {
  async function started(app: App, adjustmentsApp: App, overrides: Record<string, unknown> = {}) {
    await seedStock(adjustmentsApp, "adj-1", "WH1");
    return post(app, "/", {
      id: "pc-1",
      warehouseId: "WH1",
      date: "2026-01-15",
      memo: "جرد يناير",
      itemIds: ["ITEM-A"],
      ...overrides,
    });
  }

  it("withholds the system quantity and every variance from a blind count until it closes", async () => {
    const { countsApp, adjustmentsApp } = await newHarness();
    await started(countsApp, adjustmentsApp, { blind: true });

    const open = await json<{
      blind: boolean;
      variance: unknown;
      lines: Array<{ systemQty: string | null; unitCost: string | null; varianceQty: string | null }>;
    }>(await get(countsApp, "/pc-1"));
    expect(open.blind).toBe(true);
    expect(open.variance).toBeNull();
    expect(open.lines[0]?.systemQty).toBeNull();
    expect(open.lines[0]?.unitCost).toBeNull();

    await post(countsApp, "/pc-1/counts", { entries: [{ itemId: "ITEM-A", countedQty: "97" }] });
    await post(countsApp, "/pc-1/complete");

    const closed = await json<{
      variance: { shortLines: number; netQty: string } | null;
      lines: Array<{ systemQty: string | null; varianceQty: string | null }>;
    }>(await get(countsApp, "/pc-1"));
    expect(closed.lines[0]?.systemQty).toBe("100.000000");
    expect(closed.variance?.shortLines).toBe(1);
    expect(closed.variance?.netQty).toBe("-3.000000");
  });

  it("shows the system quantity all along on a count that is not blind", async () => {
    const { countsApp, adjustmentsApp } = await newHarness();
    await started(countsApp, adjustmentsApp);
    const open = await json<{ lines: Array<{ systemQty: string | null }>; variance: unknown }>(
      await get(countsApp, "/pc-1"),
    );
    expect(open.lines[0]?.systemQty).toBe("100.000000");
    expect(open.variance).not.toBeNull();
  });

  it("cancels a session, and refuses to record counts against it afterwards", async () => {
    const { countsApp, adjustmentsApp } = await newHarness();
    await started(countsApp, adjustmentsApp);

    const cancelled = await post(countsApp, "/pc-1/cancel");
    expect(cancelled.status).toBe(200);
    expect((await json<{ status: string }>(cancelled)).status).toBe("CANCELLED");

    const late = await post(countsApp, "/pc-1/counts", { entries: [{ itemId: "ITEM-A", countedQty: "5" }] });
    expect(late.status).toBe(409);
  });

  it("filters, counts and sums the sessions over one chokepoint", async () => {
    const { countsApp, adjustmentsApp } = await newHarness();
    await started(countsApp, adjustmentsApp);
    await seedStock(adjustmentsApp, "adj-2", "WH2");
    await post(countsApp, "/", {
      id: "pc-2",
      warehouseId: "WH2",
      date: "2026-01-16",
      memo: "جرد الفرع",
      itemIds: ["ITEM-A"],
    });
    await post(countsApp, "/pc-2/cancel");

    const ids = async (query: string, init: ReqInit = {}) =>
      (await json<Array<{ id: string }>>(await get(countsApp, `/${query}`, init))).map((r) => r.id);

    expect(await ids("")).toHaveLength(2);
    expect(await ids("?status=all")).toHaveLength(2);
    expect(await ids("?status=IN_PROGRESS")).toEqual(["pc-1"]);
    expect(await ids("?warehouseId=WH2")).toEqual(["pc-2"]);
    expect(await ids("?search=الفرع")).toEqual(["pc-2"]);
    expect(await ids("", { warehouseScope: "WH2" })).toEqual(["pc-2"]);

    const counts = await json<Record<string, number>>(await get(countsApp, "/counts?status=COMPLETED"));
    expect(counts).toMatchObject({ all: 2, IN_PROGRESS: 1, CANCELLED: 1, COMPLETED: 0 });

    expect(await json<Record<string, number>>(await get(countsApp, "/stats"))).toMatchObject({
      count: 2,
      IN_PROGRESS: 1,
      COMPLETED: 0,
      ADJUSTMENT_GENERATED: 0,
    });
  });

  it("400s a malformed start, count or generate body", async () => {
    const { countsApp, adjustmentsApp } = await newHarness();
    await started(countsApp, adjustmentsApp);
    expect((await post(countsApp, "/", { id: "pc-x" })).status).toBe(400);
    expect((await post(countsApp, "/pc-1/counts", { entries: [{ itemId: "ITEM-A" }] })).status).toBe(400);
    expect((await post(countsApp, "/pc-1/generate-adjustment", {})).status).toBe(400);
  });

  it("404s every action naming a session that does not exist", async () => {
    const { countsApp } = await newHarness();
    expect((await get(countsApp, "/nope")).status).toBe(404);
    expect((await post(countsApp, "/nope/counts", { entries: [{ itemId: "A", countedQty: "1" }] })).status).toBe(404);
    expect((await post(countsApp, "/nope/complete")).status).toBe(404);
    expect((await post(countsApp, "/nope/cancel")).status).toBe(404);
    expect((await post(countsApp, "/nope/generate-adjustment", { adjustmentId: "adj-x" })).status).toBe(404);
  });

  it("409s generating an adjustment before the session is completed", async () => {
    const { countsApp, adjustmentsApp } = await newHarness();
    await started(countsApp, adjustmentsApp);
    const res = await post(countsApp, "/pc-1/generate-adjustment", { adjustmentId: "adj-from-count" });
    expect(res.status).toBe(409);
  });

  it("generates no adjustment at all when the count matched the system exactly", async () => {
    const { countsApp, adjustmentsApp } = await newHarness();
    await started(countsApp, adjustmentsApp);
    await post(countsApp, "/pc-1/counts", { entries: [{ itemId: "ITEM-A", countedQty: "100" }] });
    await post(countsApp, "/pc-1/complete");

    const res = await post(countsApp, "/pc-1/generate-adjustment", { adjustmentId: "adj-from-count" });
    expect(res.status).toBe(200);
    const payload = await json<{ adjustment: unknown; count: { status: string } }>(res);
    expect(payload.adjustment).toBeNull();
    expect(payload.count.status).toBe("ADJUSTMENT_GENERATED");
  });

  it("403s the read endpoints for a caller without inventory.count.view", async () => {
    const { countsApp } = await newHarness();
    for (const path of ["/", "/counts", "/stats", "/pc-1"]) {
      expect((await get(countsApp, path, { permissions: "sales.invoice.view" })).status).toBe(403);
    }
  });
});
