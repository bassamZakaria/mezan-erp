import { describe, it, expect, afterEach } from "vitest";
import { StockLedgerService } from "@mezan/domain";
import { createSqliteStockLedgerStore, type SqliteStockLedgerHandle } from "@mezan/persistence";
import { createInventoryRoutes } from "./inventory-routes.js";

const handles: SqliteStockLedgerHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp(policy = { allowNegativeStock: false }) {
  const store = createSqliteStockLedgerStore();
  handles.push(store);
  const service = new StockLedgerService({
    ledger: store.ledger,
    layers: store.layers,
    snapshots: store.snapshots,
    policy,
    transaction: (fn) => store.transaction(fn),
  });
  return { app: createInventoryRoutes(service), service };
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
