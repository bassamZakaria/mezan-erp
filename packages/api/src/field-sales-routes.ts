import { Hono, type Context } from "hono";
import { randomUUID } from "node:crypto";
import {
  Money,
  Qty,
  openVanTrip,
  recordVanCashMovement,
  settleVanTrip,
  VanTripNotFoundError,
  InvalidVanTripError,
  VanTripNotOngoingError,
  SameWarehouseVanTripError,
  type VanTrip,
  type VanTripRepository,
  type StockLedgerService,
  type TreasuryTransferInput,
} from "@mezan/domain";
import { openVanTripSchema, recordVanCashMovementSchema, settleVanTripSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/**
 * Field/Van Sales routes (docs/catalog/07-mfg-projects-assets.md "رحلات
 * المندوبين"). Root-relative — a parent app mounts this router under
 * `/field/van-trips`.
 */
export interface FieldSalesRoutesDeps {
  readonly trips: VanTripRepository;
  readonly stock: Pick<StockLedgerService, "postTransfer">;
  readonly treasuryTransfer?: (input: TreasuryTransferInput) => Promise<void>;
}

function serialize(trip: VanTrip) {
  return {
    id: trip.id,
    tripNo: trip.tripNo,
    date: trip.date,
    branchId: trip.branchId,
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

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof VanTripNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof InvalidVanTripError || err instanceof SameWarehouseVanTripError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof VanTripNotOngoingError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  throw err;
}

export function createFieldSalesRoutes(
  deps: FieldSalesRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("field.van_trip.view"), async (c) => {
    const trips = await deps.trips.list();
    return c.json(trips.map(serialize));
  });

  app.post("/", gate("field.van_trip.open"), async (c) => {
    const parsed = openVanTripSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const body = parsed.data;
    try {
      const trip = await openVanTrip(
        {
          id: randomUUID(),
          tripNo: body.tripNo,
          date: body.date,
          branchId: body.branchId,
          vanWarehouseId: body.vanWarehouseId,
          vanTreasuryAccountId: body.vanTreasuryAccountId,
          sourceWarehouseId: body.sourceWarehouseId,
          sourceTreasuryAccountId: body.sourceTreasuryAccountId,
          openingCashFloat: body.openingCashFloat !== undefined ? Money.fromMajor(body.openingCashFloat) : undefined,
          crew: body.crew,
          loadedStock: body.loadedStock?.map((l) => ({ itemId: l.itemId, qty: Qty.fromMajor(l.qty) })),
          notes: body.notes,
        },
        { trips: deps.trips, stock: deps.stock, treasuryTransfer: deps.treasuryTransfer },
      );
      return c.json(serialize(trip), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id", gate("field.van_trip.view"), async (c) => {
    const trip = await deps.trips.findById(c.req.param("id"));
    if (!trip) return c.json({ error: "VAN_TRIP_NOT_FOUND" }, 404);
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
      const updated = recordVanCashMovement(trip, {
        id: randomUUID(),
        kind: body.kind,
        amount: Money.fromMajor(body.amount),
        occurredAt: body.occurredAt,
        notes: body.notes,
      });
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
        },
        { trips: deps.trips, treasuryTransfer: deps.treasuryTransfer },
      );
      return c.json(serialize(trip));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
