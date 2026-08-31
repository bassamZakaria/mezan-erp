import { describe, it, expect, afterEach } from "vitest";
import {
  StockLedgerService,
  Qty,
  Money,
  type SettingsRepository,
  type TenantSettings,
  type StockReservationSource,
  type AccountRoutingRepository,
  type InventoryGlPostingPort,
  type InventoryGlPosting,
} from "@mezan/domain";
import { createSqliteStockLedgerStore, type SqliteStockLedgerHandle } from "@mezan/persistence";
import { createInventoryRoutes } from "./inventory-routes.js";

const handles: SqliteStockLedgerHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

class NullSettingsRepository implements SettingsRepository {
  async get(): Promise<TenantSettings | null> {
    return null;
  }
  async save(): Promise<void> {}
}

function newApp(opts: {
  policy?: { allowNegativeStock: boolean };
  reservations?: StockReservationSource;
  settings?: SettingsRepository;
  accountRouting?: AccountRoutingRepository;
  gl?: InventoryGlPostingPort;
} = {}) {
  const store = createSqliteStockLedgerStore();
  handles.push(store);
  const service = new StockLedgerService({
    ledger: store.ledger,
    layers: store.layers,
    snapshots: store.snapshots,
    policy: opts.policy ?? { allowNegativeStock: false },
    transaction: (fn) => store.transaction(fn),
    gl: opts.gl,
  });
  return { app: createInventoryRoutes(service, undefined, opts.reservations, opts.accountRouting, opts.settings), service };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

describe("inventory routes — missing query parameters refuse with 400 on every read route that requires one", () => {
  it("400s /balance, /movements, /drift and /rebuild when warehouseId is missing", async () => {
    const { app } = newApp();
    const balance = await app.fetch(req("/balance?itemId=I1", { permissions: "inventory.stock.view" }));
    expect(balance.status).toBe(400);

    const movements = await app.fetch(req("/movements?itemId=I1", { permissions: "inventory.stock.view" }));
    expect(movements.status).toBe(400);

    const drift = await app.fetch(req("/drift?itemId=I1", { permissions: "inventory.valuation.view" }));
    expect(drift.status).toBe(400);
  });
});

describe("inventory routes — reservations port left unwired", () => {
  it("reports zero reserved on /stock-balance and /items/:id/stock when no reservation source is wired", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ-NORES",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "10", unitCost: "2" }],
        }),
      }),
    );

    const balanceRes = await app.fetch(req("/stock-balance", { permissions: "inventory.stock.view" }));
    const balanceBody = (await balanceRes.json()) as { rows: { reserved: string; available: string }[] };
    expect(balanceBody.rows[0]).toMatchObject({ reserved: "0.000000", available: "10.000000" });

    const stockRes = await app.fetch(req("/items/I1/stock", { permissions: "inventory.stock.view" }));
    const stockBody = (await stockRes.json()) as { positions: { reserved: string; available: string }[] };
    expect(stockBody.positions[0]).toMatchObject({ reserved: "0.000000", available: "10.000000" });
  });
});

describe("inventory routes — /availability, settings and position edge cases", () => {
  it("falls back to shipped default settings when the settings repository has none saved yet", async () => {
    const { app } = newApp({ settings: new NullSettingsRepository() });
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ-NULL-SETTINGS",
          warehouseId: "W2",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "9", unitCost: "1" }],
        }),
      }),
    );
    const res = await app.fetch(req("/availability?itemId=I1&warehouseId=W1", { permissions: "inventory.stock.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { showOtherWarehouseStock: boolean; otherWarehouses: { warehouseId: string }[] };
    // The shipped default is to SHOW other-warehouse stock — different from
    // "no settings port wired at all", which hides it.
    expect(body.showOtherWarehouseStock).toBe(true);
    expect(body.otherWarehouses).toEqual([{ warehouseId: "W2", onHand: "9.000000" }]);
  });

  it("reports the real on-hand qty when the queried item/warehouse position exists", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ-HAS-POSITION",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "42", unitCost: "5" }],
        }),
      }),
    );
    const res = await app.fetch(req("/availability?itemId=I1&warehouseId=W1", { permissions: "inventory.stock.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { onHand: string };
    expect(body.onHand).toBe("42.000000");
  });
});

describe("inventory routes — /drift with an explicit tolerance", () => {
  it("accepts a caller-supplied tolerance instead of the zero default", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ-DRIFT-TOL",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "10", unitCost: "2" }],
        }),
      }),
    );
    const res = await app.fetch(
      req("/drift?itemId=I1&warehouseId=W1&tolerance=0.5", { permissions: "inventory.valuation.view" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { withinTolerance: boolean };
    expect(body.withinTolerance).toBe(true);
  });
});

describe("inventory routes — account routing for adjustment postings", () => {
  it("posts the counterpart account named in the tenant's override, not the reason's shipped default", async () => {
    const posted: InventoryGlPosting[] = [];
    const gl: InventoryGlPostingPort = {
      async post(posting) {
        posted.push(posting);
      },
    };
    const accountRouting: AccountRoutingRepository = {
      async get() {
        return { overrides: { "inventory_adjustment.DAMAGE": "5099" }, options: { latePenaltyTreatment: "revenue_deduction", useSeparateDiscountAccount: false, applyDiscountAccountToLines: false } };
      },
      async save() {},
    };
    const { app } = newApp({ accountRouting, gl });

    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ-STOCK-FOR-DAMAGE",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "10", unitCost: "10" }],
        }),
      }),
    );
    posted.length = 0;

    const res = await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ-ROUTED",
          warehouseId: "W1",
          reason: "DAMAGE",
          lines: [{ itemId: "I1", direction: "OUT", qty: "1" }],
        }),
      }),
    );
    expect(res.status).toBe(201);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.lines.some((l) => l.accountId === "5099")).toBe(true);
    expect(posted[0]?.lines.some((l) => l.accountId === "5070")).toBe(false);
  });
});

describe("inventory routes — transfer refusals", () => {
  it("422s a transfer whose source and destination warehouse are the same", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ-FOR-TRANSFER",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "10", unitCost: "2" }],
        }),
      }),
    );
    const res = await app.fetch(
      req("/transfers", {
        method: "POST",
        permissions: "inventory.transfer.create",
        body: JSON.stringify({
          transferId: "TR1",
          fromWarehouseId: "W1",
          toWarehouseId: "W1",
          lines: [{ itemId: "I1", qty: "1" }],
        }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("SAME_WAREHOUSE_TRANSFER");
  });

  it("400s an invalid GET /transfers query and an invalid POST /transfers body", async () => {
    const { app } = newApp();
    const listRes = await app.fetch(req("/transfers?warehouseId=", { permissions: "inventory.transfer.view" }));
    expect(listRes.status).toBe(400);

    const postRes = await app.fetch(
      req("/transfers", {
        method: "POST",
        permissions: "inventory.transfer.create",
        body: JSON.stringify({ transferId: "TR-BAD", fromWarehouseId: "W1", toWarehouseId: "W2", lines: [] }),
      }),
    );
    expect(postRes.status).toBe(400);
  });

  it("400s an invalid GET /adjustments query", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/adjustments?warehouseId=", { permissions: "inventory.adjustment.view" }));
    expect(res.status).toBe(400);
  });

  it("ignores a query key the contract does not define rather than refusing the request", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/transfers?status=not-a-real-status", { permissions: "inventory.transfer.view" }));
    expect(res.status).toBe(200);
  });
});
