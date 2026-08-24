import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  type DocumentStatus,
  DocumentNotFoundError,
  DuplicateDocumentError,
  InvalidDocumentError,
  InvalidDocumentTransitionError,
  NegativeStockError,
  InvalidStockMovementError,
  SameWarehouseTransferError,
  PhysicalCountNotFoundError,
  DuplicatePhysicalCountError,
  InvalidPhysicalCountError,
  InvalidPhysicalCountStatusError,
  revealsSystemQty,
  varianceLinesOf,
  summarizePhysicalCountVariance,
  type DocumentService,
  type FrameworkDocument,
  type StockAdjustmentDocLine,
  type StockTransferDocLine,
  type PhysicalCountService,
  type PhysicalCount,
  type PhysicalCountStatus,
} from "@mezan/domain";
import {
  createStockAdjustmentSchema,
  createStockTransferSchema,
  startPhysicalCountSchema,
  recordPhysicalCountEntriesSchema,
  generateAdjustmentFromCountSchema,
} from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, warehouseScopeOf, withinScope, type AuthContextResolver } from "./permission-gate.js";

/**
 * Document-layer routes for the phase4/inventory-ops document types, built on
 * `DocumentService`/`PhysicalCountService` (@mezan/domain) — the draft → confirm
 * CRUD sitting ABOVE the raw engine primitives already mounted at
 * `/inventory/adjustments` and `/inventory/transfers` (inventory-routes.ts).
 * Mounted at distinct paths (`/inventory/stock-adjustments`,
 * `/inventory/stock-transfers`, `/inventory/physical-counts`) so the two
 * layers never collide.
 */

function serializeAdjustment(doc: FrameworkDocument<StockAdjustmentDocLine>) {
  return {
    id: doc.id,
    docType: doc.docType,
    docNo: doc.docNo,
    date: doc.date,
    memo: doc.memo,
    status: doc.status,
    lines: doc.lines.map((l) => ({
      itemId: l.itemId,
      warehouseId: l.warehouseId,
      reason: l.reason,
      direction: l.direction,
      qty: l.qty.toString(),
      unitCost: l.unitCost ? l.unitCost.toString() : null,
    })),
    createdAt: doc.createdAt,
    confirmedAt: doc.confirmedAt,
    journalEntryId: doc.journalEntryId,
  };
}

function serializeTransfer(doc: FrameworkDocument<StockTransferDocLine>) {
  return {
    id: doc.id,
    docType: doc.docType,
    docNo: doc.docNo,
    date: doc.date,
    memo: doc.memo,
    status: doc.status,
    lines: doc.lines.map((l) => ({
      itemId: l.itemId,
      fromWarehouseId: l.fromWarehouseId,
      toWarehouseId: l.toWarehouseId,
      qty: l.qty.toString(),
    })),
    createdAt: doc.createdAt,
    confirmedAt: doc.confirmedAt,
  };
}

/**
 * A blind count (جرد أعمى) withholds the system snapshot — and therefore every
 * variance figure derived from it — from the READ side until the session is
 * closed. Suppressing it here rather than in the web client is the point: the
 * counter must not be able to read it off the wire.
 */
function serializeCount(count: PhysicalCount) {
  const reveal = revealsSystemQty(count);
  const summary = reveal ? summarizePhysicalCountVariance(count) : null;
  return {
    id: count.id,
    countNo: count.countNo,
    warehouseId: count.warehouseId,
    date: count.date,
    memo: count.memo,
    status: count.status,
    blind: count.blind,
    lines: varianceLinesOf(count).map((l) => ({
      itemId: l.itemId,
      systemQty: reveal ? l.systemQty.toString() : null,
      unitCost: reveal ? l.unitCost.toString() : null,
      countedQty: l.countedQty ? l.countedQty.toString() : null,
      varianceQty: reveal && l.varianceQty ? l.varianceQty.toString() : null,
      varianceValue: reveal && l.varianceValue ? l.varianceValue.toString() : null,
    })),
    variance: summary
      ? {
          totalLines: summary.totalLines,
          countedLines: summary.countedLines,
          uncountedLines: summary.uncountedLines,
          matchedLines: summary.matchedLines,
          overLines: summary.overLines,
          shortLines: summary.shortLines,
          overQty: summary.overQty.toString(),
          shortQty: summary.shortQty.toString(),
          netQty: summary.netQty.toString(),
          overValue: summary.overValue.toString(),
          shortValue: summary.shortValue.toString(),
          netValue: summary.netValue.toString(),
          absValue: summary.absValue.toString(),
        }
      : null,
    createdAt: count.createdAt,
    completedAt: count.completedAt,
    generatedAdjustmentId: count.generatedAdjustmentId,
  };
}

function handleDocumentError(c: Context, err: unknown): Response {
  if (err instanceof DocumentNotFoundError || err instanceof PhysicalCountNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateDocumentError || err instanceof DuplicatePhysicalCountError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidDocumentTransitionError || err instanceof InvalidPhysicalCountStatusError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (
    err instanceof InvalidDocumentError ||
    err instanceof InvalidPhysicalCountError ||
    err instanceof InvalidStockMovementError
  ) {
    return c.json({ error: err.code, message: err.message }, 400);
  }
  if (err instanceof NegativeStockError) {
    return c.json(
      { error: err.code, message: err.message, onHand: err.onHand.toString(), requested: err.requested.toString() },
      422,
    );
  }
  if (err instanceof SameWarehouseTransferError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

/** `/inventory/stock-adjustments` — draft/confirm CRUD over `stockAdjustmentDocumentType`. */
export function createStockAdjustmentsRoutes(
  service: DocumentService<StockAdjustmentDocLine>,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.post("/draft", gate("inventory.adjustment.create"), async (c) => {
    const parsed = createStockAdjustmentSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const doc = await service.createDraft({
        id: parsed.data.id,
        date: parsed.data.date,
        memo: parsed.data.memo ?? "",
        lines: parsed.data.lines.map((l) => ({
          itemId: l.itemId,
          warehouseId: l.warehouseId,
          reason: l.reason,
          direction: l.direction,
          qty: Qty.fromMajor(l.qty),
          unitCost: l.unitCost ? Money.fromMajor(l.unitCost) : undefined,
        })),
      });
      return c.json(serializeAdjustment(doc), 201);
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/confirm", gate("inventory.adjustment.confirm"), async (c) => {
    try {
      const { document, held } = await service.confirm(c.req.param("id"));
      return c.json({ document: serializeAdjustment(document), held });
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.get("/", gate("inventory.adjustment.view"), async (c) => {
    const status = c.req.query("status") as DocumentStatus | undefined;
    const docs = await service.list({
      status,
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
    });
    return c.json(docs.map(serializeAdjustment));
  });

  app.get("/:id", gate("inventory.adjustment.view"), async (c) => {
    const doc = await service.findById(c.req.param("id"));
    if (!doc) return c.json({ error: "DOCUMENT_NOT_FOUND" }, 404);
    return c.json(serializeAdjustment(doc));
  });

  return app;
}

/** `/inventory/stock-transfers` — draft/confirm CRUD over `stockTransferDocumentType`. */
export function createStockTransfersRoutes(
  service: DocumentService<StockTransferDocLine>,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.post("/draft", gate("inventory.transfer.create"), async (c) => {
    const parsed = createStockTransferSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const doc = await service.createDraft({
        id: parsed.data.id,
        date: parsed.data.date,
        memo: parsed.data.memo ?? "",
        lines: parsed.data.lines.map((l) => ({
          itemId: l.itemId,
          fromWarehouseId: l.fromWarehouseId,
          toWarehouseId: l.toWarehouseId,
          qty: Qty.fromMajor(l.qty),
        })),
      });
      return c.json(serializeTransfer(doc), 201);
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/confirm", gate("inventory.transfer.confirm"), async (c) => {
    try {
      const { document, held } = await service.confirm(c.req.param("id"));
      return c.json({ document: serializeTransfer(document), held });
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.get("/", gate("inventory.transfer.view"), async (c) => {
    const status = c.req.query("status") as DocumentStatus | undefined;
    const docs = await service.list({
      status,
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
    });
    return c.json(docs.map(serializeTransfer));
  });

  app.get("/:id", gate("inventory.transfer.view"), async (c) => {
    const doc = await service.findById(c.req.param("id"));
    if (!doc) return c.json({ error: "DOCUMENT_NOT_FOUND" }, 404);
    return c.json(serializeTransfer(doc));
  });

  return app;
}

/** `/inventory/physical-counts` — start → record counts → complete → generate adjustment. */
export function createPhysicalCountsRoutes(
  service: PhysicalCountService,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.post("/", gate("inventory.count.create"), async (c) => {
    const parsed = startPhysicalCountSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const count = await service.start(parsed.data);
      return c.json(serializeCount(count), 201);
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/counts", gate("inventory.count.create"), async (c) => {
    const parsed = recordPhysicalCountEntriesSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const count = await service.recordCounts(
        c.req.param("id"),
        parsed.data.entries.map((e) => ({ itemId: e.itemId, countedQty: Qty.fromMajor(e.countedQty) })),
      );
      return c.json(serializeCount(count));
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/complete", gate("inventory.count.create"), async (c) => {
    try {
      const count = await service.complete(c.req.param("id"));
      return c.json(serializeCount(count));
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/cancel", gate("inventory.count.create"), async (c) => {
    try {
      const count = await service.cancel(c.req.param("id"));
      return c.json(serializeCount(count));
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/generate-adjustment", gate("inventory.count.confirm"), async (c) => {
    const parsed = generateAdjustmentFromCountSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const result = await service.generateAdjustment({
        countId: c.req.param("id"),
        adjustmentId: parsed.data.adjustmentId,
      });
      return c.json({
        count: serializeCount(result.count),
        adjustment: result.adjustment ? serializeAdjustment(result.adjustment) : null,
      });
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.get("/", gate("inventory.count.view"), async (c) => {
    const status = c.req.query("status") as PhysicalCountStatus | undefined;
    const counts = withinScope(
      await service.list({ status, warehouseId: c.req.query("warehouseId") }),
      warehouseScopeOf(c),
      (count) => count.warehouseId,
    );
    return c.json(counts.map(serializeCount));
  });

  app.get("/:id", gate("inventory.count.view"), async (c) => {
    const count = await service.findById(c.req.param("id"));
    if (!count) return c.json({ error: "PHYSICAL_COUNT_NOT_FOUND" }, 404);
    return c.json(serializeCount(count));
  });

  return app;
}
