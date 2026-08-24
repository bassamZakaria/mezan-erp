import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  NextNumberService,
  createRfq,
  sendRfq,
  closeRfq,
  cancelRfq,
  recordRfqQuote,
  convertRfqToPurchaseOrder,
  compareRfqQuotes,
  RfqNotFoundError,
  InvalidRfqError,
  RfqNotDraftError,
  RfqNotSentError,
  RfqNotOpenError,
  RfqQuoteNotFoundError,
  DuplicatePurchaseDocumentError,
  InvalidPurchaseDocumentError,
  type PurchaseRfq,
  type PurchaseRfqRepository,
  type RfqQuote,
  type RfqQuoteRepository,
  type PurchaseOrderRepository,
} from "@mezan/domain";
import {
  createPurchaseRfqSchema,
  createRfqQuoteSchema,
  convertRfqSchema,
} from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  headerAuthContextResolver,
  type AuthContextResolver,
  branchScopeOf,
  withinScope,} from "./permission-gate.js";

/**
 * Permission-gated routes for طلبات عروض الأسعار (RFQs, docs/catalog/02),
 * mounted under `/rfqs`. Reuses the `purchases.rfq.*` permission codes
 * already reserved in the permissions catalog. Money/Qty serialize as exact
 * decimal strings.
 *
 *   POST /                    create draft RFQ            (purchases.rfq.create)
 *   POST /:id/send             draft → sent                (purchases.rfq.create)
 *   POST /:id/close            sent → closed (no PO)        (purchases.rfq.create)
 *   POST /:id/cancel           → cancelled                  (purchases.rfq.create)
 *   GET  /[/:id]               list / get one               (purchases.rfq.view)
 *   GET  /counts                status counts                (purchases.rfq.view)
 *   GET  /:id/quotes            list quotes                  (purchases.rfq.view)
 *   POST /:id/quotes            record a supplier quote      (purchases.rfq.create)
 *   GET  /:id/comparison        per-item/per-supplier grid    (purchases.rfq.view)
 *   POST /:id/convert           chosen quote → PO, closes RFQ (purchases.rfq.convert)
 */
export interface RfqRoutesDeps {
  readonly rfqs: PurchaseRfqRepository;
  readonly quotes: RfqQuoteRepository;
  readonly orders: PurchaseOrderRepository;
  readonly numbering: NextNumberService;
  readonly now?: () => string;
}

function serializeRfq(r: PurchaseRfq) {
  return {
    id: r.id,
    number: r.number,
    date: r.date,
    requiredByDate: r.requiredByDate,
    branchId: r.branchId,
    warehouseId: r.warehouseId,
    notes: r.notes,
    lines: r.lines.map((l) => ({
      itemId: l.itemId,
      description: l.description,
      qty: l.qty.toString(),
      notes: l.notes,
    })),
    status: r.status,
    purchaseOrderId: r.purchaseOrderId,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

function serializeQuote(q: RfqQuote) {
  return {
    id: q.id,
    rfqId: q.rfqId,
    supplierId: q.supplierId,
    lines: q.lines.map((l) => ({ itemId: l.itemId, unitPrice: l.unitPrice.toString(), notes: l.notes })),
    notes: q.notes,
    submittedAt: q.submittedAt,
  };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (err instanceof RfqNotFoundError || err instanceof RfqQuoteNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicatePurchaseDocumentError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (
    err instanceof RfqNotDraftError ||
    err instanceof RfqNotSentError ||
    err instanceof RfqNotOpenError
  ) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidRfqError || err instanceof InvalidPurchaseDocumentError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

export function createRfqRoutes(
  deps: RfqRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const actor = (c: Context) => getAuthContext(c)?.userId ?? "system";

  app.get("/", gate("purchases.rfq.view"), async (c) => {
    return c.json(withinScope(await deps.rfqs.list(), branchScopeOf(c), (r) => r.branchId).map(serializeRfq));
  });

  app.get("/counts", gate("purchases.rfq.view"), async (c) => {
    const all = await deps.rfqs.list();
    return c.json({
      all: all.length,
      draft: all.filter((r) => r.status === "draft").length,
      sent: all.filter((r) => r.status === "sent").length,
      closed: all.filter((r) => r.status === "closed").length,
      cancelled: all.filter((r) => r.status === "cancelled").length,
    });
  });

  app.get("/:id", gate("purchases.rfq.view"), async (c) => {
    const rfq = await deps.rfqs.findById(c.req.param("id"));
    if (!rfq) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeRfq(rfq));
  });

  app.post("/", gate("purchases.rfq.create"), async (c) => {
    const parsed = createPurchaseRfqSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const rfq = await createRfq(
        {
          ...parsed.data,
          createdBy: actor(c),
          lines: parsed.data.lines.map((l) => ({
            itemId: l.itemId,
            description: l.description,
            qty: Qty.fromMajor(l.qty),
            notes: l.notes,
          })),
        },
        { rfqs: deps.rfqs, numbering: deps.numbering, now: deps.now },
      );
      return c.json(serializeRfq(rfq), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/send", gate("purchases.rfq.create"), async (c) => {
    try {
      return c.json(serializeRfq(await sendRfq(c.req.param("id"), { rfqs: deps.rfqs })));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/close", gate("purchases.rfq.create"), async (c) => {
    try {
      return c.json(serializeRfq(await closeRfq(c.req.param("id"), { rfqs: deps.rfqs })));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/cancel", gate("purchases.rfq.create"), async (c) => {
    try {
      return c.json(serializeRfq(await cancelRfq(c.req.param("id"), { rfqs: deps.rfqs })));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id/quotes", gate("purchases.rfq.view"), async (c) => {
    return c.json((await deps.quotes.listByRfq(c.req.param("id"))).map(serializeQuote));
  });

  app.post("/:id/quotes", gate("purchases.rfq.create"), async (c) => {
    const parsed = createRfqQuoteSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const quote = await recordRfqQuote(
        {
          id: parsed.data.id,
          rfqId: c.req.param("id"),
          supplierId: parsed.data.supplierId,
          notes: parsed.data.notes,
          lines: parsed.data.lines.map((l) => ({
            itemId: l.itemId,
            unitPrice: Money.fromMajor(l.unitPrice),
            notes: l.notes,
          })),
        },
        { rfqs: deps.rfqs, quotes: deps.quotes, now: deps.now },
      );
      return c.json(serializeQuote(quote), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id/comparison", gate("purchases.rfq.view"), async (c) => {
    const rfq = await deps.rfqs.findById(c.req.param("id"));
    if (!rfq) return c.json({ error: "NOT_FOUND" }, 404);
    const quotes = await deps.quotes.listByRfq(rfq.id);
    const comparison = compareRfqQuotes(rfq, quotes);
    return c.json({
      rfq: serializeRfq(comparison.rfq),
      supplierIds: comparison.supplierIds,
      rows: comparison.rows.map((row) => ({
        itemId: row.itemId,
        qty: row.qty.toString(),
        quotesBySupplier: Object.fromEntries(
          [...row.quotesBySupplier.entries()].map(([supplierId, price]) => [supplierId, price.toString()]),
        ),
        cheapestSupplierId: row.cheapestSupplierId,
      })),
      totalsBySupplier: Object.fromEntries(
        [...comparison.totalsBySupplier.entries()].map(([supplierId, total]) => [supplierId, total.toString()]),
      ),
    });
  });

  app.post("/:id/convert", gate("purchases.rfq.convert"), async (c) => {
    const parsed = convertRfqSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const result = await convertRfqToPurchaseOrder(
        {
          rfqId: c.req.param("id"),
          purchaseOrderId: parsed.data.purchaseOrderId,
          supplierId: parsed.data.supplierId,
          expectedDeliveryDate: parsed.data.expectedDeliveryDate,
          createdBy: actor(c),
        },
        { rfqs: deps.rfqs, quotes: deps.quotes, orders: deps.orders, numbering: deps.numbering, now: deps.now },
      );
      return c.json({ rfq: serializeRfq(result.rfq), purchaseOrderId: result.order.id }, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
