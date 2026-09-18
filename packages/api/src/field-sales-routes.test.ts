import { describe, it, expect, afterEach, vi } from "vitest";
import {
  Qty,
  StockLedgerService,
  type CostLayer,
  type CostLayerRepository,
  type StockLedgerRepository,
  type StockMovement,
  type WacSnapshot,
  type WacSnapshotRepository,
} from "@mezan/domain";
// `createSqliteVanTripRepository` is not yet exported from `@mezan/persistence`'s
// barrel (see the constraint in this PR's scope — the barrel export is wired in
// separately to avoid a concurrent-edit conflict), so this test imports the new
// store file directly by relative path.
import { createSqliteVanTripRepository, type SqliteVanTripRepositoryHandle } from "../../persistence/src/van-trip-store.js";
import { createFieldSalesRoutes, type FieldSalesRoutesDeps } from "./field-sales-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
/**
 * In-memory StockLedgerRepository/CostLayerRepository/WacSnapshotRepository
 * mirroring `packages/domain/src/inventory/test-helpers/in-memory-stores.ts`
 * (not exported from the `@mezan/domain` barrel, so package tests outside
 * `packages/domain` reimplement the same shape — see
 * `apps/web/src/store/sales-invoice-store.ts`'s `MemStockLedger` for
 * precedent) so `deps.stock` runs a REAL `StockLedgerService` end-to-end.
 */
class InMemoryStockLedger implements StockLedgerRepository {
  readonly movements: StockMovement[] = [];
  async append(movement: StockMovement): Promise<void> {
    this.movements.push(movement);
  }
  async listByPosition(itemId: string, warehouseId: string): Promise<readonly StockMovement[]> {
    return this.movements.filter((m) => m.itemId === itemId && m.warehouseId === warehouseId);
  }
  async listByItem(itemId: string): Promise<readonly StockMovement[]> {
    return this.movements.filter((m) => m.itemId === itemId);
  }
  async listByWarehouse(warehouseId: string): Promise<readonly StockMovement[]> {
    return this.movements.filter((m) => m.warehouseId === warehouseId);
  }
  async listPositions(): Promise<readonly { itemId: string; warehouseId: string }[]> {
    const seen = new Map<string, { itemId: string; warehouseId: string }>();
    for (const m of this.movements) seen.set(`${m.itemId}|${m.warehouseId}`, { itemId: m.itemId, warehouseId: m.warehouseId });
    return [...seen.values()];
  }
}

class InMemoryCostLayers implements CostLayerRepository {
  readonly layers: CostLayer[] = [];
  async add(layer: CostLayer): Promise<void> {
    this.layers.push(layer);
  }
  async listByPosition(itemId: string, warehouseId: string): Promise<readonly CostLayer[]> {
    return this.layers.filter((l) => l.itemId === itemId && l.warehouseId === warehouseId);
  }
  async updateRemaining(layerId: string, remainingQty: Qty): Promise<void> {
    const idx = this.layers.findIndex((l) => l.id === layerId);
    if (idx >= 0) this.layers[idx] = { ...(this.layers[idx] as CostLayer), remainingQty };
  }
  async remove(layerId: string): Promise<void> {
    const idx = this.layers.findIndex((l) => l.id === layerId);
    if (idx >= 0) this.layers.splice(idx, 1);
  }
}

class InMemorySnapshots implements WacSnapshotRepository {
  private readonly byKey = new Map<string, WacSnapshot>();
  private key(itemId: string, warehouseId: string): string {
    return `${itemId}|${warehouseId}`;
  }
  async get(itemId: string, warehouseId: string): Promise<WacSnapshot | null> {
    return this.byKey.get(this.key(itemId, warehouseId)) ?? null;
  }
  async save(snapshot: WacSnapshot): Promise<void> {
    this.byKey.set(this.key(snapshot.itemId, snapshot.warehouseId), snapshot);
  }
  async list(): Promise<readonly WacSnapshot[]> {
    return [...this.byKey.values()];
  }
}

function buildStockService() {
  return new StockLedgerService({
    ledger: new InMemoryStockLedger(),
    layers: new InMemoryCostLayers(),
    snapshots: new InMemorySnapshots(),
    policy: { allowNegativeStock: true },
  });
}

const handles: SqliteVanTripRepositoryHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
  vi.restoreAllMocks();
});

function newApp(overrides: Partial<FieldSalesRoutesDeps> = {}) {
  const trips = createSqliteVanTripRepository();
  handles.push(trips);
  const stock = buildStockService();
  const treasuryTransfer = vi.fn(async () => {});
  const app = createFieldSalesRoutes({ trips, stock, treasuryTransfer, ...overrides }, insecureHeaderAuthContextResolver);
  return { app, trips, stock, treasuryTransfer };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const openPayload = {
  id: "client-generated-open-id",
  date: "2026-08-21",
  branchId: "MAIN",
  vanWarehouseId: "VAN-WH",
  vanTreasuryAccountId: "VAN-TREAS",
  sourceWarehouseId: "MAIN-WH",
  sourceTreasuryAccountId: "MAIN-TREAS",
  openingCashFloat: "500",
  crew: [{ employeeId: "emp1", role: "driver" }],
  loadedStock: [
    { itemId: "item1", qty: "20" },
    { itemId: "item2", qty: "10" },
  ],
};

describe("field-sales router — permission gate", () => {
  it("rejects GET / with no permissions with 403", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("field.van_trip.view");
  });

  it("rejects POST / with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "field.van_trip.view", headers: { "content-type": "application/json" }, body: JSON.stringify(openPayload) }),
    );
    expect(res.status).toBe(403);
  });

  it("allows POST / with field.van_trip.open", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "field.van_trip.open", headers: { "content-type": "application/json" }, body: JSON.stringify(openPayload) }),
    );
    expect(res.status).toBe(201);
  });

  /**
   * Regression guard (D: a trip opened through the real UI — which never
   * sends `tripNo` — showed the client's raw uuid instead of a number).
   */
  it("allocates a TRIP-#### number from the wired numbering dep when the body omits one", async () => {
    const next = vi.fn().mockResolvedValue({ value: 7, formatted: "TRIP-0007" });
    const { app } = newApp({ numbering: { next } });
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "field.van_trip.open", headers: { "content-type": "application/json" }, body: JSON.stringify(openPayload) }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { tripNo: string | null };
    expect(body.tripNo).toBe("TRIP-0007");
    expect(next).toHaveBeenCalledWith({ branchId: "MAIN" });
  });

  it("has no trip number when no numbering dep is wired", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "field.van_trip.open", headers: { "content-type": "application/json" }, body: JSON.stringify(openPayload) }),
    );
    const body = (await res.json()) as { tripNo: string | null };
    expect(body.tripNo).toBeNull();
  });
});

describe("field-sales router — full open -> cash movements -> settle flow", () => {
  it("reconciles cash variance and stock variance exactly per the domain math", async () => {
    const { app, treasuryTransfer } = newApp();

    const openRes = await app.fetch(
      req("/", { method: "POST", permissions: "field.van_trip.open", headers: { "content-type": "application/json" }, body: JSON.stringify(openPayload) }),
    );
    expect(openRes.status).toBe(201);
    const trip = (await openRes.json()) as { id: string; status: string; openingCashFloat: string };
    expect(trip.status).toBe("ongoing");
    expect(trip.openingCashFloat).toBe("500.000000");
    // openingCashFloat > 0 → treasuryTransfer invoked on open
    expect(treasuryTransfer).toHaveBeenCalledTimes(1);

    const move1 = await app.fetch(
      req(`/${trip.id}/cash-movements`, {
        method: "POST",
        permissions: "field.van_trip.open",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "cm1", kind: "sale", amount: "120.50", occurredAt: "2026-08-21T09:00:00.000Z", notes: null }),
      }),
    );
    expect(move1.status).toBe(200);

    const move2 = await app.fetch(
      req(`/${trip.id}/cash-movements`, {
        method: "POST",
        permissions: "field.van_trip.open",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "cm2", kind: "collection", amount: "75.00", occurredAt: "2026-08-21T11:00:00.000Z", notes: "تحصيل" }),
      }),
    );
    expect(move2.status).toBe(200);
    const afterMovements = (await move2.json()) as { cashMovements: unknown[] };
    expect(afterMovements.cashMovements).toHaveLength(2);

    // expectedCash = openingCashFloat(500) + sale(120.50) + collection(75) = 695.50
    // countedCash = 690 → cashVariance = -5.50
    const settleRes = await app.fetch(
      req(`/${trip.id}/settle`, {
        method: "POST",
        permissions: "field.van_trip.settle",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          countedCash: "690.00",
          stockCounts: [
            { itemId: "item1", countedQty: "18" },
            { itemId: "item2", countedQty: "10" },
          ],
        }),
      }),
    );
    expect(settleRes.status).toBe(200);
    const settled = (await settleRes.json()) as {
      status: string;
      settlement: {
        expectedCash: string;
        countedCash: string;
        cashVariance: string;
        stockCounts: { itemId: string; expectedQty: string; countedQty: string; varianceQty: string }[];
      };
    };
    expect(settled.status).toBe("settled");
    expect(settled.settlement.expectedCash).toBe("695.500000");
    expect(settled.settlement.countedCash).toBe("690.000000");
    expect(settled.settlement.cashVariance).toBe("-5.500000");
    expect(settled.settlement.stockCounts).toEqual([
      { itemId: "item1", expectedQty: "20.000000", countedQty: "18.000000", varianceQty: "-2.000000" },
      { itemId: "item2", expectedQty: "10.000000", countedQty: "10.000000", varianceQty: "0.000000" },
    ]);
    // countedCash > 0 → treasuryTransfer invoked again on settle (van → source)
    expect(treasuryTransfer).toHaveBeenCalledTimes(2);
  });

  it("409s settling an already-settled trip", async () => {
    const { app } = newApp();
    const openRes = await app.fetch(
      req("/", { method: "POST", permissions: "field.van_trip.open", headers: { "content-type": "application/json" }, body: JSON.stringify(openPayload) }),
    );
    const trip = (await openRes.json()) as { id: string };
    const settleBody = JSON.stringify({ countedCash: "500", stockCounts: [] });
    const first = await app.fetch(
      req(`/${trip.id}/settle`, { method: "POST", permissions: "field.van_trip.settle", headers: { "content-type": "application/json" }, body: settleBody }),
    );
    expect(first.status).toBe(200);
    const second = await app.fetch(
      req(`/${trip.id}/settle`, { method: "POST", permissions: "field.van_trip.settle", headers: { "content-type": "application/json" }, body: settleBody }),
    );
    expect(second.status).toBe(409);
  });

  it("422s opening a trip with the same source and van warehouse", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "field.van_trip.open",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...openPayload, vanWarehouseId: "MAIN-WH", sourceWarehouseId: "MAIN-WH" }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("404s getting an unknown trip", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope", { permissions: "field.van_trip.view" }));
    expect(res.status).toBe(404);
  });
});

/**
 * D70. The van-trip reads gated on the plain `.view` tier, so a role built from
 * `field.van_trip.view_own` + `.open` — which is what a distribution rep is
 * given — got a 403 on the trip they were driving. They now read, narrowed by
 * the scope their session already carries.
 */
describe("D70: a view_own van-sales rep reads their own trips, narrowed by scope", () => {
  async function openTripIn(app: ReturnType<typeof newApp>["app"], vanWarehouseId: string): Promise<string> {
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "field.van_trip.open",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...openPayload, vanWarehouseId }),
      }),
    );
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  it("lists only the trips inside the rep's own van warehouse", async () => {
    const { app } = newApp();
    const inA = await openTripIn(app, "VAN-A");
    await openTripIn(app, "VAN-B");

    const res = await app.fetch(
      req("/", { permissions: "field.van_trip.view_own", headers: { "x-warehouse-scope": "VAN-A" } }),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([inA]);
  });

  it("404s the rep on another van's trip, and serves their own", async () => {
    const { app } = newApp();
    const inA = await openTripIn(app, "VAN-A");
    const inB = await openTripIn(app, "VAN-B");

    const scoped = { permissions: "field.van_trip.view_own", headers: { "x-warehouse-scope": "VAN-A" } };
    expect((await app.fetch(req(`/${inB}`, scoped))).status).toBe(404);
    expect((await app.fetch(req(`/${inA}`, scoped))).status).toBe(200);
  });

  it("shows an unscoped view_own caller nothing rather than the whole tenant", async () => {
    const { app } = newApp();
    await openTripIn(app, "VAN-A");

    const res = await app.fetch(req("/", { permissions: "field.van_trip.view_own" }));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown[]).toEqual([]);
  });

  it("still shows a plain .view holder every trip", async () => {
    const { app } = newApp();
    const inA = await openTripIn(app, "VAN-A");
    const inB = await openTripIn(app, "VAN-B");

    const res = await app.fetch(req("/", { permissions: "field.van_trip.view" }));
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((r) => r.id).sort()).toEqual([inA, inB].sort());
  });

  it("narrows a .view holder by their branch scope too", async () => {
    const { app } = newApp();
    await openTripIn(app, "VAN-A");

    const res = await app.fetch(
      req("/", { permissions: "field.van_trip.view", headers: { "x-branch-scope": "OTHER-BRANCH" } }),
    );
    expect((await res.json()) as unknown[]).toEqual([]);
  });
});
