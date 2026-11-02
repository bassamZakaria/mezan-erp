import { postingRefusalResponse } from "./posting-refusal.js";
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
  type AuthContextResolver,
  branchScopeOf,
  withinScope,} from "./permission-gate.js";
import { MasterDataKind, refuseUnknownMasterData, type MasterDataChecks } from "./master-data-check.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";

/**
 * Permission-gated routes for طلبات عروض الأسعار (RFQs, docs/archive/catalog/02),
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
 *   GET  /stats                 pipeline KPI strip            (purchases.rfq.view)
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
  readonly masterData?: MasterDataChecks;
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
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof RfqNotFoundError || err instanceof RfqQuoteNotFoundError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 404);
  }
  if (
    err instanceof RfqNotDraftError ||
    err instanceof RfqNotSentError ||
    err instanceof RfqNotOpenError
  ) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
  if (err instanceof InvalidRfqError || err instanceof InvalidPurchaseDocumentError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, reasons: err.reasons }, 422);
  }
  throw err;
}

export function createRfqRoutes(
  deps: RfqRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const actor = (c: Context) => getAuthContext(c)?.userId ?? "system";

  interface RfqListFilter {
    readonly status?: string;
    readonly fromDate?: string;
    readonly toDate?: string;
    readonly branchId?: string;
    readonly warehouseId?: string;
    readonly search?: string;
  }

  function parseRfqListQuery(c: Context): RfqListFilter {
    const status = c.req.query("status");
    return {
      status: status && status !== "all" ? status : undefined,
      fromDate: c.req.query("fromDate") || undefined,
      toDate: c.req.query("toDate") || undefined,
      branchId: c.req.query("branchId") || undefined,
      warehouseId: c.req.query("warehouseId") || undefined,
      search: c.req.query("search") || undefined,
    };
  }

  /**
   * The single filter the rows, the chip counts and the KPI strip all go
   * through (R1.1). `/counts` used to read `deps.rfqs.list()` directly, so it
   * reported figures over the whole tenant while the rows beneath it were
   * branch-scoped and filtered — the chips and the table disagreed by
   * construction. `branchId`/`warehouseId`/`search` narrow an already-scoped
   * set; no query parameter widens `branchScopeOf`.
   */
  async function listFilteredRfqs(c: Context, filter: RfqListFilter): Promise<readonly PurchaseRfq[]> {
    let rows = withinScope(await deps.rfqs.list(), branchScopeOf(c), (r) => r.branchId);
    if (filter.status) rows = rows.filter((r) => r.status === filter.status);
    if (filter.fromDate) rows = rows.filter((r) => r.date >= filter.fromDate!);
    if (filter.toDate) rows = rows.filter((r) => r.date <= filter.toDate!);
    if (filter.branchId) rows = rows.filter((r) => r.branchId === filter.branchId);
    if (filter.warehouseId) rows = rows.filter((r) => r.warehouseId === filter.warehouseId);
    const term = filter.search?.trim().toLowerCase();
    if (term) rows = rows.filter((r) => r.number.toLowerCase().includes(term));
    return rows;
  }

  app.get("/", gate("purchases.rfq.view"), async (c) => {
    return c.json((await listFilteredRfqs(c, parseRfqListQuery(c))).map(serializeRfq));
  });

  /**
   * The status chips. Deliberately ignores its own `status` axis: a chip states
   * how many rows it WOULD show, so counting the already status-filtered set
   * renders every chip but the active one as zero. Every other filter applies.
   */
  app.get("/counts", gate("purchases.rfq.view"), async (c) => {
    const { status: _status, ...withoutStatus } = parseRfqListQuery(c);
    const rows = await listFilteredRfqs(c, withoutStatus);
    const counts: Record<string, number> = { all: rows.length, draft: 0, sent: 0, closed: 0, cancelled: 0 };
    for (const rfq of rows) counts[rfq.status] = (counts[rfq.status] ?? 0) + 1;
    return c.json(counts);
  });

  /**
   * The KPI strip over the whole filtered set. An RFQ carries no money of its
   * own — the prices live on the supplier quotes recorded against it — so the
   * strip is a pipeline count, not a total.
   */
  app.get("/stats", gate("purchases.rfq.view"), async (c) => {
    const rows = await listFilteredRfqs(c, parseRfqListQuery(c));
    let draft = 0;
    let sent = 0;
    let closed = 0;
    for (const rfq of rows) {
      if (rfq.status === "draft") draft += 1;
      if (rfq.status === "sent") sent += 1;
      if (rfq.status === "closed") closed += 1;
    }
    return c.json({ count: rows.length, draft, sent, closed });
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
    const partyRefusal = await refuseUnknownMasterData(c, deps.masterData, [
      { kind: MasterDataKind.Branch, ids: [parsed.data.branchId] },
      { kind: MasterDataKind.Warehouse, ids: [parsed.data.warehouseId] },
    ]);
    if (partyRefusal) return partyRefusal;
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
    const supplierRefusal = await refuseUnknownMasterData(c, deps.masterData, [{ kind: MasterDataKind.Supplier, ids: [parsed.data.supplierId] }]);
    if (supplierRefusal) return supplierRefusal;
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
    const convertRefusal = await refuseUnknownMasterData(c, deps.masterData, [{ kind: MasterDataKind.Supplier, ids: [parsed.data.supplierId] }]);
    if (convertRefusal) return convertRefusal;
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
