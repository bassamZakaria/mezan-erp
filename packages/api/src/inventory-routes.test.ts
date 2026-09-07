import { describe, it, expect, afterEach } from "vitest";
import { StockLedgerService, Qty, createDefaultSettings, type SettingsRepository, type TenantSettings } from "@mezan/domain";
import { createSqliteStockLedgerStore, type SqliteStockLedgerHandle } from "@mezan/persistence";
import { createInventoryRoutes } from "./inventory-routes.js";
import type { StockReservationSource } from "@mezan/domain";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const handles: SqliteStockLedgerHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

class FakeSettingsRepository implements SettingsRepository {
  private value: TenantSettings;
  constructor(overrides: Partial<TenantSettings> = {}) {
    this.value = createDefaultSettings(overrides);
  }
  async get(): Promise<TenantSettings | null> {
    return this.value;
  }
  async save(settings: TenantSettings): Promise<void> {
    this.value = settings;
  }
}

function newApp(
  policy = { allowNegativeStock: false },
  reservations?: StockReservationSource,
  settings?: SettingsRepository,
) {
  const store = createSqliteStockLedgerStore();
  handles.push(store);
  const service = new StockLedgerService({
    ledger: store.ledger,
    layers: store.layers,
    snapshots: store.snapshots,
    policy,
    transaction: (fn) => store.transaction(fn),
  });
  return { app: createInventoryRoutes(service, insecureHeaderAuthContextResolver, reservations, undefined, settings), service };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

describe("inventory routes — permission gate", () => {
  it("403s balance without inventory.stock.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/balance?itemId=I1&warehouseId=W1"));
    expect(res.status).toBe(403);
  });

  it("403s posting an adjustment without inventory.adjustment.create", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.stock.view",
        body: JSON.stringify({ adjustmentId: "A1", warehouseId: "W1", reason: "OTHER", lines: [] }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("403s rebuild without inventory.valuation.rebuild", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/rebuild?itemId=I1&warehouseId=W1", { method: "POST", permissions: "inventory.valuation.view" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("inventory routes — adjustments, balance, valuation, drift", () => {
  const openingBalance = {
    adjustmentId: "ADJ1",
    adjustmentNumber: "ADJ-000001",
    warehouseId: "W1",
    reason: "INITIAL_STOCK",
    lines: [{ itemId: "I1", direction: "IN", qty: "100", unitCost: "5000" }],
    gl: { inventoryAccountId: "1200", counterpartAccountId: "3100" },
  };

  it("posts an opening-balance adjustment and reads the balance back", async () => {
    const { app } = newApp();
    const post = await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create,inventory.adjustment.view",
        body: JSON.stringify(openingBalance),
      }),
    );
    expect(post.status).toBe(201);

    const bal = await app.fetch(req("/balance?itemId=I1&warehouseId=W1", { permissions: "inventory.stock.view" }));
    expect(bal.status).toBe(200);
    expect((await bal.json()) as unknown).toMatchObject({
      onHand: "100.000000",
      averageCost: "5000.000000",
      totalValue: "500000.000000",
    });
  });

  it("400s a malformed adjustment payload", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({ adjustmentId: "A1" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("422s an issue that would drive stock negative", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify(openingBalance),
      }),
    );
    const res = await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ2",
          warehouseId: "W1",
          reason: "SHORTAGE",
          lines: [{ itemId: "I1", direction: "OUT", qty: "999" }],
        }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("NEGATIVE_STOCK");
  });

  it("reports valuation across positions", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify(openingBalance),
      }),
    );
    const res = await app.fetch(req("/valuation", { permissions: "inventory.valuation.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; totalValue: string };
    expect(body.totalValue).toBe("500000.000000");
    expect(body.rows).toHaveLength(1);
  });

  it("returns a drift report reconciling cache, replay and layers", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify(openingBalance),
      }),
    );
    const res = await app.fetch(
      req("/drift?itemId=I1&warehouseId=W1", { permissions: "inventory.valuation.view" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cacheDrift: string; withinTolerance: boolean };
    expect(body.cacheDrift).toBe("0.000000");
    expect(body.withinTolerance).toBe(true);
  });
});

describe("inventory routes — valuation-neutral transfers", () => {
  it("keeps total valuation unchanged after a transfer", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ1",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "10", unitCost: "5" }],
        }),
      }),
    );
    const transfer = await app.fetch(
      req("/transfers", {
        method: "POST",
        permissions: "inventory.transfer.create",
        body: JSON.stringify({
          transferId: "TRF1",
          fromWarehouseId: "W1",
          toWarehouseId: "W2",
          lines: [{ itemId: "I1", qty: "4" }],
        }),
      }),
    );
    expect(transfer.status).toBe(201);

    const res = await app.fetch(req("/valuation", { permissions: "inventory.valuation.view" }));
    const body = (await res.json()) as { totalValue: string };
    expect(body.totalValue).toBe("50.000000");
  });
});

describe("inventory routes — movements, item stock and stock-balance", () => {
  it("returns the posted movement, and an empty list for an item with none", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ1",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "100", unitCost: "5000" }],
        }),
      }),
    );
    const res = await app.fetch(req("/movements?itemId=I1&warehouseId=W1", { permissions: "inventory.stock.view" }));
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { direction: string; qty: string; unitCost: string; sourceDocType: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: "IN", qty: "100.000000", unitCost: "5000.000000", sourceDocType: "ADJUSTMENT" });

    const empty = await app.fetch(req("/movements?itemId=I2&warehouseId=W1", { permissions: "inventory.stock.view" }));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);
  });

  it("reports positions, reserved and available qty, and cost layers on the item-stock route", async () => {
    const { app } = newApp({ allowNegativeStock: false }, {
      list: async () => [{ itemId: "I1", warehouseId: "W1", qty: Qty.fromMajor("30") }],
    });
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ1",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "100", unitCost: "5000" }],
        }),
      }),
    );
    const res = await app.fetch(req("/items/I1/stock", { permissions: "inventory.stock.view" }));
    expect(res.status).toBe(200);
    const out = (await res.json()) as {
      positions: { warehouseId: string; onHand: string; reserved: string; available: string; totalValue: string }[];
      layers: { warehouseId: string; unitCost: string; remainingQty: string }[];
    };
    expect(out.positions).toHaveLength(1);
    expect(out.positions[0]).toMatchObject({
      warehouseId: "W1",
      onHand: "100.000000",
      // 30 reserved out of 100 on hand → 70 available.
      reserved: "30.000000",
      available: "70.000000",
      totalValue: "500000.000000",
    });
    expect(out.layers).toHaveLength(1);
    expect(out.layers[0]).toMatchObject({ warehouseId: "W1", unitCost: "5000.000000", remainingQty: "100.000000" });
  });

  it("rolls stock-balance across warehouses, computes reserved/available, and empties on a filter that matches nothing", async () => {
    const { app } = newApp({ allowNegativeStock: false }, {
      list: async () => [{ itemId: "I1", warehouseId: "W1", qty: Qty.fromMajor("6") }],
    });
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ1",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "10", unitCost: "2" }],
        }),
      }),
    );
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ2",
          warehouseId: "W2",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "4", unitCost: "3" }],
        }),
      }),
    );

    const all = await app.fetch(req("/stock-balance", { permissions: "inventory.stock.view" }));
    const allBody = (await all.json()) as {
      rows: { itemId: string; onHand: string; reserved: string; available: string; warehouseCount: number }[];
    };
    expect(allBody.rows).toHaveLength(1);
    // 10 (W1) + 4 (W2) = 14 on hand; 6 reserved (all in W1) → 8 available.
    expect(allBody.rows[0]).toMatchObject({ itemId: "I1", onHand: "14.000000", reserved: "6.000000", available: "8.000000", warehouseCount: 2 });

    const filtered = await app.fetch(req("/stock-balance?warehouseId=W1", { permissions: "inventory.stock.view" }));
    const filteredBody = (await filtered.json()) as { rows: { onHand: string; warehouseCount: number }[] };
    expect(filteredBody.rows).toHaveLength(1);
    expect(filteredBody.rows[0]).toMatchObject({ onHand: "10.000000", warehouseCount: 1 });

    // A warehouse filter that holds none of the item empties the list rather than falling back to "all".
    const nothing = await app.fetch(req("/stock-balance?warehouseId=W-NONE", { permissions: "inventory.stock.view" }));
    expect(((await nothing.json()) as { rows: unknown[] }).rows).toEqual([]);
  });
});

describe("inventory routes — availability and other-warehouse visibility", () => {
  it("without a settings repository, defaults to hiding other-warehouse stock", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ1",
          warehouseId: "W2",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "9", unitCost: "1" }],
        }),
      }),
    );
    const res = await app.fetch(req("/availability?itemId=I1&warehouseId=W1", { permissions: "inventory.stock.view" }));
    const out = (await res.json()) as { onHand: string; showOtherWarehouseStock: boolean; otherWarehouses: unknown[] };
    expect(out.onHand).toBe("0.000000");
    expect(out.showOtherWarehouseStock).toBe(false);
    expect(out.otherWarehouses).toEqual([]);
  });

  it("shows what other warehouses hold only when the tenant setting allows it", async () => {
    const { app: shown } = newApp(undefined, undefined, new FakeSettingsRepository({ showOtherWarehouseStock: true }));
    await shown.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ1",
          warehouseId: "W2",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "9", unitCost: "1" }],
        }),
      }),
    );
    const visible = await shown.fetch(req("/availability?itemId=I1&warehouseId=W1", { permissions: "inventory.stock.view" }));
    const visibleBody = (await visible.json()) as { otherWarehouses: { warehouseId: string; onHand: string }[] };
    expect(visibleBody.otherWarehouses).toEqual([{ warehouseId: "W2", onHand: "9.000000" }]);

    const { app: hidden } = newApp(undefined, undefined, new FakeSettingsRepository({ showOtherWarehouseStock: false }));
    await hidden.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ1",
          warehouseId: "W2",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "9", unitCost: "1" }],
        }),
      }),
    );
    const hiddenRes = await hidden.fetch(req("/availability?itemId=I1&warehouseId=W1", { permissions: "inventory.stock.view" }));
    expect(((await hiddenRes.json()) as { otherWarehouses: unknown[] }).otherWarehouses).toEqual([]);
  });
});

describe("inventory routes — adjustment and transfer history", () => {
  async function postTwoAdjustments(app: ReturnType<typeof newApp>["app"]) {
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ-DAMAGE",
          warehouseId: "W1",
          reason: "DAMAGE",
          lines: [{ itemId: "I1", direction: "OUT", qty: "1" }],
        }),
      }),
    );
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ-COUNT",
          warehouseId: "W2",
          reason: "PHYSICAL_COUNT",
          lines: [{ itemId: "I1", direction: "IN", qty: "1", unitCost: "1" }],
        }),
      }),
    );
  }

  it("filters the adjustment history by warehouse and reason, and 404s an unknown id", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ1",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "10", unitCost: "1" }],
        }),
      }),
    );
    await postTwoAdjustments(app);

    const all = await app.fetch(req("/adjustments", { permissions: "inventory.adjustment.view" }));
    expect(((await all.json()) as unknown[]).length).toBe(3);

    const byWarehouse = await app.fetch(req("/adjustments?warehouseId=W2", { permissions: "inventory.adjustment.view" }));
    const byWarehouseBody = (await byWarehouse.json()) as { id: string }[];
    expect(byWarehouseBody).toHaveLength(1);
    expect(byWarehouseBody[0]?.id).toBe("ADJ-COUNT");

    const byReason = await app.fetch(req("/adjustments?reason=DAMAGE", { permissions: "inventory.adjustment.view" }));
    expect(((await byReason.json()) as { id: string }[])[0]?.id).toBe("ADJ-DAMAGE");

    const none = await app.fetch(req("/adjustments?warehouseId=W-NONE", { permissions: "inventory.adjustment.view" }));
    expect(await none.json()).toEqual([]);

    const found = await app.fetch(req("/adjustments/ADJ-DAMAGE", { permissions: "inventory.adjustment.view" }));
    expect(found.status).toBe(200);
    expect(((await found.json()) as { docNo: string | null }).docNo).toBeNull();

    const missing = await app.fetch(req("/adjustments/NOPE", { permissions: "inventory.adjustment.view" }));
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe("STOCK_ADJUSTMENT_NOT_FOUND");
  });

  it("filters transfer history by from/to warehouse, scopes visibility, and 404s an unknown id", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ1",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "10", unitCost: "1" }],
        }),
      }),
    );
    await app.fetch(
      req("/transfers", {
        method: "POST",
        permissions: "inventory.transfer.create",
        body: JSON.stringify({ transferId: "TRF1", fromWarehouseId: "W1", toWarehouseId: "W2", lines: [{ itemId: "I1", qty: "3" }] }),
      }),
    );

    const byFrom = await app.fetch(req("/transfers?fromWarehouseId=W1", { permissions: "inventory.transfer.view" }));
    expect(((await byFrom.json()) as unknown[])).toHaveLength(1);
    const byToNone = await app.fetch(req("/transfers?toWarehouseId=W-NONE", { permissions: "inventory.transfer.view" }));
    expect(await byToNone.json()).toEqual([]);

    // Scoped to a warehouse the transfer does not touch — invisible from either end.
    const scopedOut = await app.fetch(
      req("/transfers", { permissions: "inventory.transfer.view", headers: { "x-warehouse-scope": "W3" } }),
    );
    expect(await scopedOut.json()).toEqual([]);
    // Scoped to the RECEIVING warehouse — still visible, since a transfer is
    // visible from either end (goods must not appear to come from nowhere).
    const scopedIn = await app.fetch(
      req("/transfers", { permissions: "inventory.transfer.view", headers: { "x-warehouse-scope": "W2" } }),
    );
    expect(((await scopedIn.json()) as unknown[])).toHaveLength(1);

    const found = await app.fetch(req("/transfers/TRF1", { permissions: "inventory.transfer.view" }));
    expect(found.status).toBe(200);
    expect(((await found.json()) as { totalValue: string }).totalValue).toBe("3.000000");

    const missing = await app.fetch(req("/transfers/NOPE", { permissions: "inventory.transfer.view" }));
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe("STOCK_TRANSFER_NOT_FOUND");
  });
});

describe("inventory routes — rebuild", () => {
  it("recomputes onHand/averageCost/totalValue from the cost layers", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ1",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "10", unitCost: "5" }],
        }),
      }),
    );
    const res = await app.fetch(
      req("/rebuild?itemId=I1&warehouseId=W1", { method: "POST", permissions: "inventory.valuation.rebuild" }),
    );
    expect(res.status).toBe(200);
    const out = (await res.json()) as { onHand: string; averageCost: string; totalValue: string };
    expect(out).toMatchObject({ onHand: "10.000000", averageCost: "5.000000", totalValue: "50.000000" });
  });

  it("400s a missing query parameter, naming it", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/rebuild?itemId=I1", { method: "POST", permissions: "inventory.valuation.rebuild" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("warehouseId");
  });
});

describe("inventory routes — quantity/money boundary: exactly on hand vs. one micro-unit over", () => {
  it("allows issuing exactly what is on hand, and refuses one micro-unit more, leaving the balance untouched", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ1",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "10", unitCost: "5" }],
        }),
      }),
    );

    // Exactly on hand: allowed, drives balance to zero.
    const exact = await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ-EXACT",
          warehouseId: "W1",
          reason: "SHORTAGE",
          lines: [{ itemId: "I1", direction: "OUT", qty: "10" }],
        }),
      }),
    );
    expect(exact.status).toBe(201);
    const afterExact = await app.fetch(req("/balance?itemId=I1&warehouseId=W1", { permissions: "inventory.stock.view" }));
    expect(((await afterExact.json()) as { onHand: string }).onHand).toBe("0.000000");

    // One micro-unit over what is on hand (zero): refused, balance stays zero.
    const over = await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ-OVER",
          warehouseId: "W1",
          reason: "SHORTAGE",
          lines: [{ itemId: "I1", direction: "OUT", qty: "0.000001" }],
        }),
      }),
    );
    expect(over.status).toBe(422);
    const overBody = (await over.json()) as { error: string; onHand: string; requested: string };
    expect(overBody.error).toBe("NEGATIVE_STOCK");
    expect(overBody.onHand).toBe("0.000000");
    expect(overBody.requested).toBe("0.000001");
    const afterOver = await app.fetch(req("/balance?itemId=I1&warehouseId=W1", { permissions: "inventory.stock.view" }));
    expect(((await afterOver.json()) as { onHand: string }).onHand).toBe("0.000000");

    // The refused adjustment never entered the history.
    const history = await app.fetch(req("/adjustments/ADJ-OVER", { permissions: "inventory.adjustment.view" }));
    expect(history.status).toBe(404);
  });
});

describe("inventory routes — every quantity move pairs with its money consequence", () => {
  it("a DAMAGE write-off removes exactly the qty-derived value from the position", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ1",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "20", unitCost: "12.50" }],
        }),
      }),
    );
    // Total value: 20 × 12.50 = 250.
    const before = await app.fetch(req("/balance?itemId=I1&warehouseId=W1", { permissions: "inventory.stock.view" }));
    expect(((await before.json()) as { totalValue: string }).totalValue).toBe("250.000000");

    const damage = await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ-DAMAGE",
          warehouseId: "W1",
          reason: "DAMAGE",
          lines: [{ itemId: "I1", direction: "OUT", qty: "6" }],
        }),
      }),
    );
    expect(damage.status).toBe(201);

    const after = await app.fetch(req("/balance?itemId=I1&warehouseId=W1", { permissions: "inventory.stock.view" }));
    const afterBody = (await after.json()) as { onHand: string; totalValue: string; averageCost: string };
    // 6 units leave at the moving-average cost (12.50): value falls by 75, qty by 6.
    expect(afterBody.onHand).toBe("14.000000");
    expect(afterBody.totalValue).toBe("175.000000");
    expect(afterBody.averageCost).toBe("12.500000");
  });
});

describe("inventory write paths enforce warehouseScopeOf (D103)", () => {
  it("D103: refuses an adjustment against an out-of-scope warehouse, and posts no movement", async () => {
    const { app, service } = newApp();
    const res = await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        headers: { "x-warehouse-scope": "W1" },
        body: JSON.stringify({
          adjustmentId: "ADJ-OUT-OF-SCOPE",
          warehouseId: "W9",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "5", unitCost: "1" }],
        }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()) as unknown).toMatchObject({ error: "WAREHOUSE_OUT_OF_SCOPE", warehouseId: "W9" });

    expect((await service.getBalanceDetail("I1", "W9")).onHand.toString()).toBe("0.000000");
    expect(await service.getMovements("I1", "W9")).toEqual([]);
  });

  it("D103: refuses a transfer OUT of a warehouse the caller may not see, leaving both positions untouched", async () => {
    const { app, service } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ1",
          warehouseId: "W9",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "5", unitCost: "1" }],
        }),
      }),
    );
    const res = await app.fetch(
      req("/transfers", {
        method: "POST",
        permissions: "inventory.transfer.create",
        headers: { "x-warehouse-scope": "W1" },
        body: JSON.stringify({ transferId: "TRF-OUT-OF-SCOPE", fromWarehouseId: "W9", toWarehouseId: "W8", lines: [{ itemId: "I1", qty: "2" }] }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()) as unknown).toMatchObject({ error: "WAREHOUSE_OUT_OF_SCOPE", warehouseId: "W9" });

    expect((await service.getBalanceDetail("I1", "W9")).onHand.toString()).toBe("5.000000");
    expect((await service.getBalanceDetail("I1", "W8")).onHand.toString()).toBe("0.000000");
  });

  it("D103: refuses a transfer INTO a warehouse the caller may not see, leaving both positions untouched", async () => {
    const { app, service } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ1",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "5", unitCost: "1" }],
        }),
      }),
    );
    const res = await app.fetch(
      req("/transfers", {
        method: "POST",
        permissions: "inventory.transfer.create",
        headers: { "x-warehouse-scope": "W1" },
        body: JSON.stringify({ transferId: "TRF-INTO-BLIND", fromWarehouseId: "W1", toWarehouseId: "W8", lines: [{ itemId: "I1", qty: "2" }] }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()) as unknown).toMatchObject({ error: "WAREHOUSE_OUT_OF_SCOPE", warehouseId: "W8" });

    expect((await service.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("5.000000");
    expect((await service.getBalanceDetail("I1", "W8")).onHand.toString()).toBe("0.000000");
  });

  it("D103: a caller scoped to the warehouse they name still posts an adjustment", async () => {
    const { app, service } = newApp();
    const res = await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        headers: { "x-warehouse-scope": "W1,W2" },
        body: JSON.stringify({
          adjustmentId: "ADJ-IN-SCOPE",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "5", unitCost: "1" }],
        }),
      }),
    );
    expect(res.status).toBe(201);
    expect((await service.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("5.000000");
  });

  it("D103: a caller scoped to both ends still posts a transfer", async () => {
    const { app, service } = newApp();
    await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        headers: { "x-warehouse-scope": "W1,W2" },
        body: JSON.stringify({
          adjustmentId: "ADJ-SEED",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "5", unitCost: "1" }],
        }),
      }),
    );
    const res = await app.fetch(
      req("/transfers", {
        method: "POST",
        permissions: "inventory.transfer.create",
        headers: { "x-warehouse-scope": "W1,W2" },
        body: JSON.stringify({ transferId: "TRF-IN-SCOPE", fromWarehouseId: "W1", toWarehouseId: "W2", lines: [{ itemId: "I1", qty: "2" }] }),
      }),
    );
    expect(res.status).toBe(201);
    expect((await service.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("3.000000");
    expect((await service.getBalanceDetail("I1", "W2")).onHand.toString()).toBe("2.000000");
  });

  it("D103: an unscoped caller — no x-warehouse-scope header, or \"*\" — still writes anywhere", async () => {
    const { app, service } = newApp();
    const noHeader = await app.fetch(
      req("/adjustments", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          adjustmentId: "ADJ-NO-HEADER",
          warehouseId: "W9",
          reason: "INITIAL_STOCK",
          lines: [{ itemId: "I1", direction: "IN", qty: "5", unitCost: "1" }],
        }),
      }),
    );
    expect(noHeader.status).toBe(201);

    const star = await app.fetch(
      req("/transfers", {
        method: "POST",
        permissions: "inventory.transfer.create",
        headers: { "x-warehouse-scope": "*" },
        body: JSON.stringify({ transferId: "TRF-STAR", fromWarehouseId: "W9", toWarehouseId: "W8", lines: [{ itemId: "I1", qty: "2" }] }),
      }),
    );
    expect(star.status).toBe(201);
    expect((await service.getBalanceDetail("I1", "W8")).onHand.toString()).toBe("2.000000");
  });
});
