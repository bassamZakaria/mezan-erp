import { Hono, type Context } from "hono";
import { randomUUID } from "node:crypto";
import {
  Money,
  Qty,
  createVan,
  openVanTrip,
  recordVanCashMovement,
  resolveVanCascade,
  settleVanTrip,
  VanTripNotFoundError,
  InvalidVanTripError,
  InvalidVanError,
  VanCascadeMismatchError,
  VanNotFoundError,
  VanTripNotOngoingError,
  SameWarehouseVanTripError,
  type Van,
  type VanRepository,
  type VanTrip,
  type VanTripCashMovementKind,
  type VanTripRepository,
  type StockLedgerService,
  type SettleVanTripDeps,
  type TreasuryTransferInput,
  type VanTripNumberingHook,
} from "@mezan/domain";
import { createVanSchema, openVanTripSchema, recordVanCashMovementSchema, settleVanTripSchema } from "@mezan/contracts";
import {
  branchScopeOf,
  createAnyPermissionGate,
  createPermissionGate,
  getAuthContext,
  warehouseScopeOf,
  type AuthContextResolver,
} from "./permission-gate.js";
import { can } from "@mezan/domain";
import { tenantDay, tenantToday } from "./tenant-day.js";
import { MasterDataKind, refuseUnknownMasterData, type MasterDataChecks } from "./master-data-check.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";

/**
 * Field/Van Sales routes (docs/archive/catalog/07-mfg-projects-assets.md "رحلات
 * المندوبين"). Root-relative — a parent app mounts this router under
 * `/field/van-trips`.
 */
export interface FieldSalesRoutesDeps {
  /** Refuses a van or a trip naming a branch or warehouse no master record holds (D310). */
  readonly masterData?: MasterDataChecks;
  readonly trips: VanTripRepository;
  /**
   * المركبات — the registry the van→warehouse→treasury cascade resolves
   * against (R3.13). Without it the three stay independent, which is what let
   * van A's stock be settled into van B's till.
   */
  readonly vans?: VanRepository;
  /** Confirms a crew member is a real employee — the trip form used to take a typed id. */
  readonly employeeExists?: (employeeId: string) => Promise<boolean>;
  readonly stock: Pick<StockLedgerService, "postTransfer">;
  readonly treasuryTransfer?: (input: TreasuryTransferInput) => Promise<void>;
  /** Allocates a trip's `TRIP-####` number from the VAN_TRIP sequence (D: raw UUID shown otherwise). */
  readonly numbering?: VanTripNumberingHook;
  /**
   * Posts roadside takings INTO the van's treasury account. Without it the trip
   * document was the only record of them, while settlement transferred the full
   * counted cash — float plus those unposted takings — out of the van, so every
   * completed trip drove the van's cash account down by exactly what it sold
   * (D22).
   */
  readonly recordCashTaking?: (input: {
    tripId: string;
    movementId: string;
    kind: VanTripCashMovementKind;
    amount: Money;
    date: string;
    branchId: string;
    vanTreasuryAccountId: string;
  }) => Promise<void>;
  /** Writes a settlement's counted-versus-expected cash difference off the van treasury. */
  readonly recordCashVariance?: SettleVanTripDeps["recordCashVariance"];
}

function serialize(trip: VanTrip) {
  return {
    id: trip.id,
    tripNo: trip.tripNo,
    date: trip.date,
    branchId: trip.branchId,
    vanId: trip.vanId,
    vanWarehouseId: trip.vanWarehouseId,
    vanTreasuryAccountId: trip.vanTreasuryAccountId,
    sourceWarehouseId: trip.sourceWarehouseId,
    sourceTreasuryAccountId: trip.sourceTreasuryAccountId,
    openingCashFloat: trip.openingCashFloat.toString(),
    crew: trip.crew.map((c) => ({ employeeId: c.employeeId, role: c.role })),
    loadedStock: trip.loadedStock.map((l) => ({ itemId: l.itemId, qty: l.qty.toString() })),
    cashMovements: trip.cashMovements.map((m) => ({
      id: m.id,
      kind: m.kind,
      amount: m.amount.toString(),
      occurredAt: m.occurredAt,
      notes: m.notes,
    })),
    status: trip.status,
    openedAt: trip.openedAt,
    settledAt: trip.settledAt,
    settlement: trip.settlement
      ? {
          expectedCash: trip.settlement.expectedCash.toString(),
          countedCash: trip.settlement.countedCash.toString(),
          cashVariance: trip.settlement.cashVariance.toString(),
          stockCounts: trip.settlement.stockCounts.map((c) => ({
            itemId: c.itemId,
            expectedQty: c.expectedQty.toString(),
            countedQty: c.countedQty.toString(),
            varianceQty: c.varianceQty.toString(),
          })),
          settledAt: trip.settlement.settledAt,
        }
      : null,
    notes: trip.notes,
  };
}

function serializeVan(van: Van) {
  return {
    id: van.id,
    code: van.code,
    nameAr: van.nameAr,
    nameEn: van.nameEn,
    plateNumber: van.plateNumber,
    branchId: van.branchId,
    warehouseId: van.warehouseId,
    treasuryAccountId: van.treasuryAccountId,
    active: van.active,
  };
}

function withMessageEn(err: { code: string; message: string }) {
  const messageEn = (err as { messageEn?: string }).messageEn;
  return { error: err.code, message: err.message, ...(messageEn ? { messageEn } : {}) };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  if (err instanceof VanTripNotFoundError || err instanceof VanNotFoundError) {
    return c.json(withMessageEn(err), 404);
  }
  if (
    err instanceof InvalidVanTripError ||
    err instanceof SameWarehouseVanTripError ||
    err instanceof InvalidVanError ||
    err instanceof VanCascadeMismatchError
  ) {
    return c.json(withMessageEn(err), 422);
  }
  if (err instanceof VanTripNotOngoingError) {
    return c.json(withMessageEn(err), 409);
  }
  throw err;
}

/**
 * المركبات (R3.13) — mounted under `/field/vans`. A van owns the warehouse its
 * stock sits in and the till its cash sits in, so the trip form picks a van and
 * the server derives both rather than offering three unrelated dropdowns.
 */
export function createVansRoutes(
  vans: VanRepository,
  resolveAuthContext: AuthContextResolver,
  masterData?: MasterDataChecks,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("field.van_trip.view"), async (c) => {
    const all = await vans.list();
    const activeParam = c.req.query("active");
    const filtered = activeParam === undefined ? all : all.filter((v) => v.active === (activeParam === "true"));
    return c.json(filtered.map(serializeVan));
  });

  app.get("/:id", gate("field.van_trip.view"), async (c) => {
    const van = await vans.findById(c.req.param("id"));
    if (!van) return c.json({ error: "VAN_NOT_FOUND" }, 404);
    return c.json(serializeVan(van));
  });

  app.post("/", gate("field.van_trip.open"), async (c) => {
    const parsed = createVanSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const vanPlaceRefusal = await refuseUnknownMasterData(c, masterData, [
      { kind: MasterDataKind.Branch, ids: [parsed.data.branchId] },
      { kind: MasterDataKind.Warehouse, ids: [parsed.data.warehouseId] },
    ]);
    if (vanPlaceRefusal) return vanPlaceRefusal;
    try {
      const van = createVan({
        id: parsed.data.id ?? randomUUID(),
        code: parsed.data.code,
        nameAr: parsed.data.nameAr,
        nameEn: parsed.data.nameEn,
        plateNumber: parsed.data.plateNumber,
        branchId: parsed.data.branchId,
        warehouseId: parsed.data.warehouseId,
        treasuryAccountId: parsed.data.treasuryAccountId,
        active: parsed.data.active,
      });
      await vans.insert(van);
      return c.json(serializeVan(van), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

export function createFieldSalesRoutes(
  deps: FieldSalesRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const gateAny = createAnyPermissionGate(resolveAuthContext);

  /**
   * `field.van_trip.view_own` is a real tier — `VAN_SALES` and any role built
   * from `.open` hold it and nothing else — but a van trip records its crew by
   * EMPLOYEE id, and this router has no way to resolve the calling user's
   * employee record, so "own" cannot be evaluated here (D70).
   *
   * The narrowing that IS available is the scope the session already carries:
   * a van-sales rep is scoped to their van's warehouse. So a `view_own` caller
   * sees the trips inside their own branch/warehouse scope — and a `view_own`
   * caller carrying the all-scope sentinel is refused rather than shown the
   * whole tenant, because widening a gate without a narrowing key is a leak,
   * which is worse than the 403 it replaces.
   */
  const ownVisibilityOnly = (c: Context) => {
    const ctx = getAuthContext(c);
    return ctx ? !can(ctx, "field.van_trip.view") : false;
  };

  function visibleTrips(c: Context, trips: readonly VanTrip[]): readonly VanTrip[] {
    const branches = branchScopeOf(c);
    const warehouses = warehouseScopeOf(c);
    const own = ownVisibilityOnly(c);
    // A `view_own` caller matches on the VAN warehouse alone. Matching the
    // source store as well would show a rep scoped to one van every trip drawn
    // from the main store, which is the whole tenant's field sales.
    if (own && !warehouses) return [];
    let rows = trips;
    if (branches) rows = rows.filter((t) => branches.includes(t.branchId));
    if (warehouses) {
      rows = rows.filter(
        (t) => warehouses.includes(t.vanWarehouseId) || (!own && warehouses.includes(t.sourceWarehouseId)),
      );
    }
    return rows;
  }

  app.get("/", gateAny("field.van_trip.view", "field.van_trip.view_own"), async (c) => {
    const trips = await deps.trips.list();
    return c.json(visibleTrips(c, trips).map(serialize));
  });

  app.post("/", gate("field.van_trip.open"), async (c) => {
    const parsed = openVanTripSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const body = parsed.data;
    try {
      /**
       * The cascade, resolved from the registry rather than from the body: a
       * request that names a van gets that van's warehouse, till and branch,
       * and is REFUSED if it also names a different one. A request with no van
       * keeps the old three-field shape for editions that run no registry.
       */
      let vanId: string | null = null;
      let vanWarehouseId = body.vanWarehouseId;
      let vanTreasuryAccountId = body.vanTreasuryAccountId;
      let branchId = body.branchId;
      if (body.vanId) {
        if (!deps.vans) {
          return c.json({ error: "VAN_REGISTRY_UNAVAILABLE", message: "سجل المركبات غير مفعّل." }, 503);
        }
        const van = await deps.vans.findById(body.vanId);
        if (!van) throw new VanNotFoundError(body.vanId);
        const cascade = resolveVanCascade(van, {
          warehouseId: body.vanWarehouseId,
          treasuryAccountId: body.vanTreasuryAccountId,
        });
        vanId = van.id;
        vanWarehouseId = cascade.warehouseId;
        vanTreasuryAccountId = cascade.treasuryAccountId;
        branchId = body.branchId ?? cascade.branchId;
      }
      if (!vanWarehouseId || !vanTreasuryAccountId || !branchId) {
        return c.json(
          { error: "VAN_REQUIRED", message: "اختر المركبة، أو حدّد المستودع والخزينة والفرع." },
          422,
        );
      }
      const tripPlaceRefusal = await refuseUnknownMasterData(c, deps.masterData, [
        { kind: MasterDataKind.Branch, ids: [branchId] },
        { kind: MasterDataKind.Warehouse, ids: [vanWarehouseId, body.sourceWarehouseId] },
      ]);
      if (tripPlaceRefusal) return tripPlaceRefusal;

      const trip = await openVanTrip(
        {
          id: body.id,
          tripNo: body.tripNo,
          date: await tenantDay(c, body.date),
          branchId,
          vanId,
          vanWarehouseId,
          vanTreasuryAccountId,
          sourceWarehouseId: body.sourceWarehouseId,
          sourceTreasuryAccountId: body.sourceTreasuryAccountId,
          openingCashFloat: body.openingCashFloat !== undefined ? Money.fromMajor(body.openingCashFloat) : undefined,
          crew: body.crew,
          loadedStock: body.loadedStock?.map((l) => ({ itemId: l.itemId, qty: Qty.fromMajor(l.qty) })),
          notes: body.notes,
        },
        {
          trips: deps.trips,
          stock: deps.stock,
          treasuryTransfer: deps.treasuryTransfer,
          employeeExists: deps.employeeExists,
          numbering: deps.numbering,
        },
      );
      return c.json(serialize(trip), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id", gateAny("field.van_trip.view", "field.van_trip.view_own"), async (c) => {
    const trip = await deps.trips.findById(c.req.param("id"));
    if (!trip) return c.json({ error: "VAN_TRIP_NOT_FOUND" }, 404);
    // 404, not 403: whether a trip the caller may not see exists at all is
    // itself information.
    if (visibleTrips(c, [trip]).length === 0) return c.json({ error: "VAN_TRIP_NOT_FOUND" }, 404);
    return c.json(serialize(trip));
  });

  app.post("/:id/cash-movements", gate("field.van_trip.open"), async (c) => {
    const parsed = recordVanCashMovementSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const body = parsed.data;
    const trip = await deps.trips.findById(c.req.param("id"));
    if (!trip) return c.json({ error: "VAN_TRIP_NOT_FOUND" }, 404);
    try {
      const movementId = randomUUID();
      const amount = Money.fromMajor(body.amount);
      const updated = recordVanCashMovement(trip, {
        id: movementId,
        kind: body.kind,
        amount,
        occurredAt: body.occurredAt,
        notes: body.notes,
      });
      // Post before persisting: a refused posting must leave no cash movement
      // the ledger has never heard of.
      if (deps.recordCashTaking) {
        await deps.recordCashTaking({
          tripId: trip.id,
          movementId,
          kind: body.kind,
          amount,
          date: await tenantDay(c, body.occurredAt),
          branchId: trip.branchId,
          vanTreasuryAccountId: trip.vanTreasuryAccountId,
        });
      }
      await deps.trips.update(updated);
      return c.json(serialize(updated));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/settle", gate("field.van_trip.settle"), async (c) => {
    const parsed = settleVanTripSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const body = parsed.data;
    try {
      const trip = await settleVanTrip(
        {
          tripId: c.req.param("id"),
          countedCash: Money.fromMajor(body.countedCash),
          stockCounts: body.stockCounts.map((s) => ({ itemId: s.itemId, countedQty: Qty.fromMajor(s.countedQty) })),
          date: await tenantToday(c),
        },
        { trips: deps.trips, treasuryTransfer: deps.treasuryTransfer, recordCashVariance: deps.recordCashVariance },
      );
      return c.json(serialize(trip));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
