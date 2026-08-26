import { Hono } from "hono";
import {
  Money,
  Qty,
  isAwaitingRefund,
  type DocumentService,
  type FrameworkDocument,
  type SalesInvoiceLookupPort,
  type SalesReturnLine,
} from "@mezan/domain";
import { createSalesReturnSchema } from "@mezan/contracts";
import {
  createPermissionGate,
  headerAuthContextResolver,
  warehouseScopeOf,
  withinScope,
  type AuthContextResolver,
} from "./permission-gate.js";
import { handleDocumentError } from "./document-error-handling.js";

function serializeLine(l: SalesReturnLine) {
  return {
    itemId: l.itemId,
    warehouseId: l.warehouseId,
    customerId: l.customerId,
    sourceInvoiceId: l.sourceInvoiceId,
    sourceInvoiceNumber: l.sourceInvoiceNumber,
    reason: l.reason,
    availableQty: l.availableQty.toString(),
    qty: l.qty.toString(),
    unitPrice: l.unitPrice.toString(),
    unitCost: l.unitCost.toString(),
    taxAmount: l.taxAmount.toString(),
  };
}

function serialize(doc: FrameworkDocument<SalesReturnLine>) {
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
    awaitingRefund: isAwaitingRefund(doc),
  };
}

/**
 * Sales Returns routes (docs/catalog/01 §"مرتجعات المبيعات"), mounted under
 * `/sales-returns`. `service` is a fully-wired `DocumentService<SalesReturnLine>`
 * (repo + numbering + GL hook + stock hook + workflow gate) — building it is
 * the caller's job (apps/server / apps/desktop composition root, or the web
 * demo store), matching how `/inventory` and `/gl` are mounted.
 */
export function createSalesReturnsRoutes(
  service: DocumentService<SalesReturnLine>,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
  /**
   * Resolves the source invoice so the returnable quantity is derived HERE.
   * Without it the server validated the requested qty against an
   * `availableQty` the client supplied, so a caller could return the same
   * goods repeatedly by sending the full invoiced quantity every time.
   */
  invoices?: SalesInvoiceLookupPort,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  /**
   * The client's `availableQty` is a hint, never the cap. When the invoice is
   * resolvable the server uses what the invoice actually has left; otherwise it
   * falls back to the claim, which is the pre-existing behaviour for editions
   * that mount returns without an invoices module.
   */
  async function resolveAvailableQty(sourceInvoiceId: string, itemId: string, claimed: string): Promise<Qty> {
    if (!invoices) return Qty.fromMajor(claimed);
    const invoice = await invoices.findConfirmedInvoice(sourceInvoiceId);
    const line = invoice?.lines.find((il) => il.itemId === itemId);
    if (!line) return Qty.zero();
    return line.qty.subtract(line.alreadyReturnedQty);
  }

  app.get("/", gate("sales.return.view"), async (c) => {
    const status = c.req.query("status");
    const fromDate = c.req.query("fromDate");
    const toDate = c.req.query("toDate");
    const list = await service.list({
      status: status as never,
      fromDate: fromDate ?? undefined,
      toDate: toDate ?? undefined,
    });
    // A return moves stock back into a warehouse, so the header's warehouse
    // scope has to narrow it (R1.14).
    // The warehouse is on the LINES, not the header, so a document is in
    // scope when any of its lines is — the same rule the stock-document
    // routes already apply.
    const scope = warehouseScopeOf(c);
    const scoped = !scope ? list : list.filter((doc) => doc.lines.some((line) => scope.includes(line.warehouseId)));
    return c.json(scoped.map(serialize));
  });

  app.get("/:id", gate("sales.return.view"), async (c) => {
    const doc = await service.findById(c.req.param("id"));
    if (!doc) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(doc));
  });

  app.post("/", gate("sales.return.create"), async (c) => {
    const parsed = createSalesReturnSchema.safeParse(await c.req.json());
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
          customerId: l.customerId,
          sourceInvoiceId: l.sourceInvoiceId,
          sourceInvoiceNumber: l.sourceInvoiceNumber,
          reason: l.reason,
          availableQty: await resolveAvailableQty(l.sourceInvoiceId, l.itemId, l.availableQty),
          qty: Qty.fromMajor(l.qty),
          unitPrice: Money.fromMajor(l.unitPrice),
          unitCost: Money.fromMajor(l.unitCost),
          taxAmount: Money.fromMajor(l.taxAmount),
        }))),
      });
      return c.json(serialize(doc), 201);
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/confirm", gate("sales.return.confirm"), async (c) => {
    try {
      const result = await service.confirm(c.req.param("id"), {
        actor: c.req.header("x-user-id") ?? undefined,
      });
      return c.json({ document: serialize(result.document), held: result.held });
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/cancel", gate("sales.return.void"), async (c) => {
    try {
      const doc = await service.cancel(c.req.param("id"));
      return c.json(serialize(doc));
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  return app;
}
