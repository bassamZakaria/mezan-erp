import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  purchaseReturnGrandTotal,
  type DocumentService,
  type FrameworkDocument,
  type PurchaseInvoiceLookupPort,
  type PurchaseReturnLine,
} from "@mezan/domain";
import { createPurchaseReturnSchema } from "@mezan/contracts";
import { type AuthContextResolver, callerUserId, createPermissionGate, headerAuthContextResolver, warehouseScopeOf, withinScope } from "./permission-gate.js";
import { handleDocumentError } from "./document-error-handling.js";

function serializeLine(l: PurchaseReturnLine) {
  return {
    itemId: l.itemId,
    warehouseId: l.warehouseId,
    supplierId: l.supplierId,
    sourceInvoiceId: l.sourceInvoiceId,
    sourceInvoiceNumber: l.sourceInvoiceNumber,
    reason: l.reason,
    availableQty: l.availableQty.toString(),
    qty: l.qty.toString(),
    unitCost: l.unitCost.toString(),
    taxAmount: l.taxAmount.toString(),
  };
}

function serialize(doc: FrameworkDocument<PurchaseReturnLine>) {
  return {
    id: doc.id,
    docType: doc.docType,
    docNo: doc.docNo,
    date: doc.date,
    memo: doc.memo,
    status: doc.status,
    lines: doc.lines.map(serializeLine),
    createdAt: doc.createdAt,
    confirmedAt: doc.confirmedAt,
    reversesDocId: doc.reversesDocId,
    reversedByDocId: doc.reversedByDocId,
    workflowRequestId: doc.workflowRequestId,
    journalEntryId: doc.journalEntryId,
  };
}

/** Purchase Returns routes (docs/archive/catalog/02 §"مرتجعات المشتريات"), mounted under `/purchase-returns`. Mirrors sales-returns-routes.ts. */
export function createPurchaseReturnsRoutes(
  service: DocumentService<PurchaseReturnLine>,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
  /**
   * Resolves the source invoice so the returnable quantity is derived HERE.
   * Without it the server validated against an `availableQty` the CLIENT sent,
   * so the same goods could be returned repeatedly. Mirrors sales-returns.
   */
  invoices?: PurchaseInvoiceLookupPort,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  /** The client's `availableQty` is a hint, never the cap. */
  async function resolveAvailableQty(sourceInvoiceId: string, itemId: string, claimed: string): Promise<Qty> {
    if (!invoices) return Qty.fromMajor(claimed);
    const invoice = await invoices.findConfirmedInvoice(sourceInvoiceId);
    const line = invoice?.lines.find((il) => il.itemId === itemId);
    if (!line) return Qty.zero();
    return line.qty.subtract(line.alreadyReturnedQty);
  }

  interface PurchaseReturnListFilter {
    readonly status?: string;
    readonly supplierId?: string;
    readonly fromDate?: string;
    readonly toDate?: string;
    readonly search?: string;
  }

  function parseListQuery(c: Context): PurchaseReturnListFilter {
    const status = c.req.query("status");
    return {
      status: status && status !== "all" ? status : undefined,
      supplierId: c.req.query("supplierId") || undefined,
      fromDate: c.req.query("fromDate") || undefined,
      toDate: c.req.query("toDate") || undefined,
      search: c.req.query("search") || undefined,
    };
  }

  /**
   * The single filter the rows, the chip counts and the KPI strip all go
   * through (R1.1). `supplierId` and `search` are presentation filters over an
   * already-scoped set — `warehouseScopeOf` still decides what this user may
   * see at all, and no query parameter widens it.
   */
  async function listFilteredReturns(
    c: Context,
    filter: PurchaseReturnListFilter,
  ): Promise<readonly FrameworkDocument<PurchaseReturnLine>[]> {
    const list = await service.list({
      status: filter.status as never,
      fromDate: filter.fromDate,
      toDate: filter.toDate,
    });
    // A return takes stock out of a warehouse, so the header's warehouse scope
    // has to narrow it (R1.14).
    // The warehouse is on the LINES, not the header, so a document is in
    // scope when any of its lines is — the same rule the stock-document
    // routes already apply.
    const scope = warehouseScopeOf(c);
    let rows = !scope ? list : list.filter((doc) => doc.lines.some((line) => scope.includes(line.warehouseId)));
    if (filter.supplierId) {
      rows = rows.filter((doc) => doc.lines.some((line) => line.supplierId === filter.supplierId));
    }
    const term = filter.search?.trim().toLowerCase();
    if (term) {
      rows = rows.filter(
        (doc) =>
          (doc.docNo ?? "").toLowerCase().includes(term) ||
          doc.lines.some(
            (line) =>
              (line.sourceInvoiceNumber ?? "").toLowerCase().includes(term) ||
              line.supplierId.toLowerCase().includes(term),
          ),
      );
    }
    return rows;
  }

  app.get("/", gate("purchases.return.view"), async (c) => {
    return c.json((await listFilteredReturns(c, parseListQuery(c))).map(serialize));
  });

  /**
   * The status chips. Deliberately ignores its own `status` axis: a chip states
   * how many rows it WOULD show, so counting the already status-filtered set
   * renders every chip but the active one as zero. Every other filter applies.
   */
  app.get("/counts", gate("purchases.return.view"), async (c) => {
    const { status: _status, ...withoutStatus } = parseListQuery(c);
    const rows = await listFilteredReturns(c, withoutStatus);
    const counts: Record<string, number> = {
      all: rows.length,
      draft: 0,
      pending: 0,
      confirmed: 0,
      cancelled: 0,
      reversed: 0,
    };
    for (const doc of rows) counts[doc.status] = (counts[doc.status] ?? 0) + 1;
    return c.json(counts);
  });

  /**
   * The KPI strip, summed in `Money` over the whole filtered set. Only a
   * confirmed return has taken anything off the supplier payable, so a draft's
   * value is not returned money.
   */
  app.get("/stats", gate("purchases.return.view"), async (c) => {
    const rows = await listFilteredReturns(c, parseListQuery(c));
    let confirmed = 0;
    let returnedTotal = Money.zero();
    for (const doc of rows) {
      if (doc.status !== "confirmed") continue;
      confirmed += 1;
      returnedTotal = returnedTotal.add(purchaseReturnGrandTotal(doc));
    }
    return c.json({ count: rows.length, confirmed, returnedTotal: returnedTotal.toString() });
  });

  app.get("/:id", gate("purchases.return.view"), async (c) => {
    const doc = await service.findById(c.req.param("id"));
    if (!doc) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(doc));
  });

  app.post("/", gate("purchases.return.create"), async (c) => {
    const parsed = createPurchaseReturnSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const doc = await service.createDraft({
        id: parsed.data.id,
        date: parsed.data.date,
        memo: parsed.data.memo,
        lines: await Promise.all(parsed.data.lines.map(async (l) => ({
          itemId: l.itemId,
          warehouseId: l.warehouseId,
          supplierId: l.supplierId,
          sourceInvoiceId: l.sourceInvoiceId,
          sourceInvoiceNumber: l.sourceInvoiceNumber,
          reason: l.reason,
          availableQty: await resolveAvailableQty(l.sourceInvoiceId, l.itemId, l.availableQty),
          qty: Qty.fromMajor(l.qty),
          unitCost: Money.fromMajor(l.unitCost),
          taxAmount: Money.fromMajor(l.taxAmount),
        }))),
      });
      return c.json(serialize(doc), 201);
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/confirm", gate("purchases.return.confirm"), async (c) => {
    try {
      const result = await service.confirm(c.req.param("id"), { actor: callerUserId(c) });
      return c.json({ document: serialize(result.document), held: result.held });
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/cancel", gate("purchases.return.void"), async (c) => {
    try {
      const doc = await service.cancel(c.req.param("id"));
      return c.json(serialize(doc));
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  return app;
}
