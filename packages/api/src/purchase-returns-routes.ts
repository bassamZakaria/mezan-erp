import { Hono } from "hono";
import { Money, Qty, type DocumentService, type FrameworkDocument, type PurchaseInvoiceLookupPort, type PurchaseReturnLine } from "@mezan/domain";
import { createPurchaseReturnSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";
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

/** Purchase Returns routes (docs/catalog/02 §"مرتجعات المشتريات"), mounted under `/purchase-returns`. Mirrors sales-returns-routes.ts. */
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

  app.get("/", gate("purchases.return.view"), async (c) => {
    const status = c.req.query("status");
    const fromDate = c.req.query("fromDate");
    const toDate = c.req.query("toDate");
    const list = await service.list({ status: status as never, fromDate: fromDate ?? undefined, toDate: toDate ?? undefined });
    return c.json(list.map(serialize));
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
      const result = await service.confirm(c.req.param("id"), { actor: c.req.header("x-user-id") ?? undefined });
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
