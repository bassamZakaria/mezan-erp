import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  StockLedgerService,
  ExpiredStockError,
  NegativeStockError,
  InvalidStockMovementError,
  SameWarehouseTransferError,
  rollupStockBalance,
  createDefaultSettings,
  type SettingsRepository,
  type StockMovement,
  type WacSnapshot,
  type DriftReport,
  type StockBalanceRow,
  type PostedAdjustment,
  type PostedTransfer,
  getAdjustmentReasonDefinition,
  routedAccountId,
  type AccountRoutingRepository,
  buildStockReservations,
  availableQty,
  type StockReservationSource,
  type StockReservations,
} from "@mezan/domain";
import {
  postAdjustmentSchema,
  postTransferSchema,
  postedAdjustmentListQuerySchema,
  postedTransferListQuerySchema,
} from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, warehouseScopeOf, withinScope, type AuthContextResolver } from "./permission-gate.js";

/**
 * Permission-gated routes for the costing + stock-ledger engine (docs/archive/catalog/03).
 * Reuses the documented inventory permission codes (docs/archive/catalog/09 §permission
 * matrix): `inventory.stock.view`, `inventory.adjustment.create`,
 * `inventory.transfer.create`, `inventory.valuation.view`,
 * `inventory.valuation.rebuild`. Money/Qty serialize as exact decimal strings.
 */

function serializeMovement(m: StockMovement) {
  return {
    id: m.id,
    itemId: m.itemId,
    warehouseId: m.warehouseId,
    direction: m.direction,
    qty: m.qty.toString(),
    unitCost: m.unitCost.toString(),
    sourceDocType: m.sourceDocType,
    sourceDocId: m.sourceDocId,
    sourceDocNumber: m.sourceDocNumber,
    reason: m.reason,
    occurredAt: m.occurredAt,
  };
}

function serializeBalance(s: WacSnapshot) {
  return {
    itemId: s.itemId,
    warehouseId: s.warehouseId,
    onHand: s.onHand.toString(),
    averageCost: s.averageCost.toString(),
    totalValue: s.totalValue.toString(),
  };
}

function serializeBalanceRow(r: StockBalanceRow) {
  return {
    itemId: r.itemId,
    onHand: r.onHand.toString(),
    totalValue: r.totalValue.toString(),
    averageCost: r.averageCost.toString(),
    warehouseCount: r.warehouseCount,
    warehouses: r.warehouses.map((w) => ({
      warehouseId: w.warehouseId,
      onHand: w.onHand.toString(),
      totalValue: w.totalValue.toString(),
      averageCost: w.averageCost.toString(),
    })),
  };
}

function serializeDrift(d: DriftReport) {
  return {
    itemId: d.itemId,
    warehouseId: d.warehouseId,
    onHand: d.onHand.toString(),
    cachedAverageCost: d.cachedAverageCost.toString(),
    recomputedAverageCost: d.recomputedAverageCost.toString(),
    layersAverageCost: d.layersAverageCost.toString(),
    cachedValue: d.cachedValue.toString(),
    recomputedValue: d.recomputedValue.toString(),
    layersValue: d.layersValue.toString(),
    layersQty: d.layersQty.toString(),
    cacheDrift: d.cacheDrift.toString(),
    layerDrift: d.layerDrift.toString(),
    withinTolerance: d.withinTolerance,
  };
}

function serializePostedAdjustment(a: PostedAdjustment) {
  return {
    id: a.id,
    docNo: a.docNo,
    warehouseId: a.warehouseId,
    reason: a.reason,
    occurredAt: a.occurredAt,
    lines: a.lines.map((l) => ({
      itemId: l.itemId,
      direction: l.direction,
      qty: l.qty.toString(),
      unitCost: l.unitCost.toString(),
      value: l.value.toString(),
    })),
    valueDelta: a.valueDelta.toString(),
  };
}

function serializePostedTransfer(t: PostedTransfer) {
  return {
    id: t.id,
    docNo: t.docNo,
    fromWarehouseId: t.fromWarehouseId,
    toWarehouseId: t.toWarehouseId,
    occurredAt: t.occurredAt,
    lines: t.lines.map((l) => ({
      itemId: l.itemId,
      qty: l.qty.toString(),
      unitCost: l.unitCost.toString(),
      value: l.value.toString(),
    })),
    totalValue: t.totalValue.toString(),
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof NegativeStockError) {
    return c.json(
      {
        error: err.code,
        message: err.message,
        onHand: err.onHand.toString(),
        requested: err.requested.toString(),
      },
      422,
    );
  }
  if (err instanceof ExpiredStockError) {
    return c.json({ error: err.code, message: err.message, batchNo: err.batchNo, expiryDate: err.expiryDate }, 422);
  }
  if (err instanceof SameWarehouseTransferError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof InvalidStockMovementError) {
    return c.json({ error: err.code, message: err.message }, 400);
  }
  throw err;
}

function requireQuery(c: Context, name: string): string {
  const value = c.req.query(name);
  if (!value) throw new InvalidStockMovementError([`query parameter "${name}" is required`]);
  return value;
}

export function createInventoryRoutes(
  service: StockLedgerService,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
  /**
   * Open documents that have committed stock they have not yet moved (R5.6).
   * Optional: without it every position reports zero reserved rather than a
   * figure it cannot substantiate.
   */
  reservations?: StockReservationSource,
  /** The tenant's account-routing table (R6.1); omit to use the shipped defaults. */
  accountRouting?: AccountRoutingRepository,
  /**
   * Tenant settings §"سياسة المخزون". `showOtherWarehouseStock` decides whether
   * `GET /availability` may say what the OTHER warehouses hold — a tenant that
   * switched it off does not want a counter clerk quoting another branch's stock.
   */
  settings?: SettingsRepository,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  async function currentReservations(): Promise<StockReservations> {
    return buildStockReservations(reservations ? await reservations.list() : []);
  }


  app.get("/availability", gate("inventory.stock.view"), async (c) => {
    const itemId = requireQuery(c, "itemId");
    const warehouseId = requireQuery(c, "warehouseId");
    const { positions } = await service.getValuation();
    const scoped = withinScope(positions, warehouseScopeOf(c), (p) => p.warehouseId);
    const mine = scoped.find((p) => p.itemId === itemId && p.warehouseId === warehouseId);
    const tenant = settings ? ((await settings.get()) ?? createDefaultSettings()) : null;
    const showOthers = tenant?.showOtherWarehouseStock ?? false;
    return c.json({
      itemId,
      warehouseId,
      onHand: (mine?.onHand ?? Qty.zero()).toString(),
      showOtherWarehouseStock: showOthers,
      otherWarehouses: showOthers
        ? scoped
            .filter((p) => p.itemId === itemId && p.warehouseId !== warehouseId && !p.onHand.isZero())
            .map((p) => ({ warehouseId: p.warehouseId, onHand: p.onHand.toString() }))
        : [],
    });
  });


  app.get("/balance", gate("inventory.stock.view"), async (c) => {
    try {
      const detail = await service.getBalanceDetail(requireQuery(c, "itemId"), requireQuery(c, "warehouseId"));
      return c.json(serializeBalance(detail));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/movements", gate("inventory.stock.view"), async (c) => {
    try {
      const movements = await service.getMovements(
        requireQuery(c, "itemId"),
        requireQuery(c, "warehouseId"),
      );
      return c.json(movements.map(serializeMovement));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/valuation", gate("inventory.valuation.view"), async (c) => {
    const { positions } = await service.getValuation();
    const scoped = withinScope(positions, warehouseScopeOf(c), (p) => p.warehouseId);
    return c.json({
      rows: scoped.map(serializeBalance),
      // Recomputed over the scoped rows: a total that still covered every
      // warehouse would contradict the list beneath it.
      totalValue: scoped.reduce((sum, p) => sum.add(p.totalValue), Money.zero()).toString(),
    });
  });

  // أرصدة المخزون (docs/archive/catalog/03) — cross-warehouse rollup, one row per item.
  app.get("/stock-balance", gate("inventory.stock.view"), async (c) => {
    const { positions } = await service.getValuation();
    const warehouseId = c.req.query("warehouseId");
    const scoped = withinScope(positions, warehouseScopeOf(c), (p) => p.warehouseId);
    const rows = rollupStockBalance(scoped, { warehouseId });
    const reserved = await currentReservations();
    return c.json({
      rows: rows.map((row) => {
        const held = reserved.forItem(row.itemId);
        const serialized = serializeBalanceRow(row);
        return {
          ...serialized,
          reserved: held.toString(),
          available: availableQty(row.onHand, held).toString(),
          warehouses: row.warehouses.map((w, index) => {
            const heldHere = reserved.forPosition(row.itemId, w.warehouseId);
            return {
              ...serialized.warehouses[index]!,
              reserved: heldHere.toString(),
              available: availableQty(w.onHand, heldHere).toString(),
            };
          }),
        };
      }),
    });
  });

  /**
   * Where one item's stock actually sits, and what it cost. The item card used
   * to print "ستُعرض أرصدة المخزون … (المرحلة الثانية)" over data the
   * stock-levels report was already serving (D43).
   */
  app.get("/items/:itemId/stock", gate("inventory.stock.view"), async (c) => {
    const itemId = c.req.param("itemId");
    const positions = withinScope(await service.getItemPositions(itemId), warehouseScopeOf(c), (p) => p.warehouseId);
    const layers = withinScope(await service.getItemCostLayers(itemId), warehouseScopeOf(c), (l) => l.warehouseId);
    const reserved = await currentReservations();
    return c.json({
      positions: positions.map((p) => {
        const held = reserved.forPosition(itemId, p.warehouseId);
        return {
          warehouseId: p.warehouseId,
          onHand: p.onHand.toString(),
          // متاح / محجوز / إجمالي — a warehouse balance the sales desk can act
          // on has to say how much of it is already spoken for (R5.5, R5.6).
          reserved: held.toString(),
          available: availableQty(p.onHand, held).toString(),
          totalValue: p.totalValue.toString(),
          averageCost: p.averageCost.toString(),
        };
      }),
      layers: layers.map((l) => ({
        id: l.id,
        warehouseId: l.warehouseId,
        unitCost: l.unitCost.toString(),
        originalQty: l.originalQty.toString(),
        remainingQty: l.remainingQty.toString(),
        sourceDocType: l.sourceDocType,
        sourceDocNumber: l.sourceDocNumber,
        createdAt: l.createdAt,
      })),
    });
  });

  app.get("/drift", gate("inventory.valuation.view"), async (c) => {
    try {
      const toleranceRaw = c.req.query("tolerance");
      const tolerance = toleranceRaw ? Money.fromMajor(toleranceRaw) : Money.zero();
      const report = await service.checkDriftFor(
        requireQuery(c, "itemId"),
        requireQuery(c, "warehouseId"),
        tolerance,
      );
      return c.json(serializeDrift(report));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/rebuild", gate("inventory.valuation.rebuild"), async (c) => {
    try {
      const position = await service.rebuild(requireQuery(c, "itemId"), requireQuery(c, "warehouseId"));
      return c.json({
        itemId: position.itemId,
        warehouseId: position.warehouseId,
        onHand: position.onHand.toString(),
        averageCost: position.averageCost.toString(),
        totalValue: position.totalValue.toString(),
      });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * The stock control account every adjustment moves against. Overridable per
   * request only for editions that remap 1200.
   */
  const DEFAULT_INVENTORY_ACCOUNT_ID = "1200";

  app.post("/adjustments", gate("inventory.adjustment.create"), async (c) => {
    const parsed = postAdjustmentSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      await service.postAdjustment({
        adjustmentId: parsed.data.adjustmentId,
        adjustmentNumber: parsed.data.adjustmentNumber ?? null,
        warehouseId: parsed.data.warehouseId,
        reason: parsed.data.reason,
        occurredAt: parsed.data.occurredAt,
        // The reason decides which account absorbs the value, not the caller
        // (R5.9). Seven of the eight reasons previously posted nothing at all.
        gl: {
          inventoryAccountId: parsed.data.gl?.inventoryAccountId ?? DEFAULT_INVENTORY_ACCOUNT_ID,
          counterpartAccountId:
            routedAccountId(await accountRouting?.get(), `inventory_adjustment.${parsed.data.reason}`) ??
            getAdjustmentReasonDefinition(parsed.data.reason).counterpartAccountId,
        },
        lines: parsed.data.lines.map((l) => ({
          itemId: l.itemId,
          direction: l.direction,
          qty: Qty.fromMajor(l.qty),
          unitCost: l.unitCost !== undefined ? Money.fromMajor(l.unitCost) : undefined,
        })),
      });
      return c.json({ ok: true }, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // History for the adjustments screen, folded out of the movement ledger —
  // the engine keeps no separate document row (posted-stock-documents.ts).
  app.get("/adjustments", gate("inventory.adjustment.view"), async (c) => {
    const parsed = postedAdjustmentListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const adjustments = await service.listPostedAdjustments(parsed.data);
    return c.json(withinScope(adjustments, warehouseScopeOf(c), (a) => a.warehouseId).map(serializePostedAdjustment));
  });

  app.get("/adjustments/:id", gate("inventory.adjustment.view"), async (c) => {
    const adjustment = await service.getPostedAdjustment(c.req.param("id"));
    if (!adjustment) return c.json({ error: "STOCK_ADJUSTMENT_NOT_FOUND" }, 404);
    return c.json(serializePostedAdjustment(adjustment));
  });

  app.get("/transfers", gate("inventory.transfer.view"), async (c) => {
    const parsed = postedTransferListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const transfers = await service.listPostedTransfers(parsed.data);
    // A transfer is visible from either end: hiding it from the receiving
    // warehouse would make stock appear from nowhere.
    const scope = warehouseScopeOf(c);
    const visible = !scope
      ? transfers
      : transfers.filter((t) => scope.includes(t.fromWarehouseId) || scope.includes(t.toWarehouseId));
    return c.json(visible.map(serializePostedTransfer));
  });

  app.get("/transfers/:id", gate("inventory.transfer.view"), async (c) => {
    const transfer = await service.getPostedTransfer(c.req.param("id"));
    if (!transfer) return c.json({ error: "STOCK_TRANSFER_NOT_FOUND" }, 404);
    return c.json(serializePostedTransfer(transfer));
  });

  app.post("/transfers", gate("inventory.transfer.create"), async (c) => {
    const parsed = postTransferSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      await service.postTransfer({
        transferId: parsed.data.transferId,
        transferNumber: parsed.data.transferNumber ?? null,
        fromWarehouseId: parsed.data.fromWarehouseId,
        toWarehouseId: parsed.data.toWarehouseId,
        occurredAt: parsed.data.occurredAt,
        lines: parsed.data.lines.map((l) => ({ itemId: l.itemId, qty: Qty.fromMajor(l.qty) })),
      });
      return c.json({ ok: true }, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
