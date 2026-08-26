import { Hono } from "hono";
import {
  Money,
  Qty,
  assertRefundable,
  buildSalesReturnLinesFromInvoice,
  isAwaitingRefund,
  refundDue,
  sumRefunds,
  SalesReturnNotRefundableError,
  type DocumentService,
  type FrameworkDocument,
  type SalesInvoiceLookupPort,
  type SalesReturnLine,
  type SalesReturnRefund,
  type SalesReturnRefundPort,
} from "@mezan/domain";
import {
  buildSalesReturnFromInvoiceSchema,
  createSalesReturnSchema,
  refundSalesReturnSchema,
} from "@mezan/contracts";
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

function serialize(doc: FrameworkDocument<SalesReturnLine>, refunds: readonly SalesReturnRefund[] = []) {
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
    awaitingRefund: isAwaitingRefund(doc, refunds),
    refundDue: refundDue(doc, refunds).toString(),
    refundedTotal: sumRefunds(refunds).toString(),
    refunds: refunds.map((r) => ({
      voucherId: r.voucherId,
      voucherNo: r.voucherNo,
      date: r.date,
      amount: r.amount.toString(),
    })),
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
  /**
   * The treasury seam «استرداد للعميل» rides on. Absent, the refund route
   * answers 503 rather than flipping a state flag that moves no money.
   */
  refunds?: SalesReturnRefundPort,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  async function refundsOf(id: string): Promise<readonly SalesReturnRefund[]> {
    return refunds ? refunds.list(id) : [];
  }

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
    return c.json(await Promise.all(scoped.map(async (doc) => serialize(doc, await refundsOf(doc.id)))));
  });

  app.get("/:id", gate("sales.return.view"), async (c) => {
    const doc = await service.findById(c.req.param("id"));
    if (!doc) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(doc, await refundsOf(doc.id)));
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

  /**
   * «مرتجع من فاتورة» — the shape the screen actually sends: a source invoice
   * and a quantity per item. Every figure that matters (price, cost, tax
   * share, what is still returnable) is read off the invoice HERE. The
   * `POST /` shape above lets a caller state its own prices; this one does
   * not, which is why it is the one the UI uses.
   */
  app.post("/from-invoice", gate("sales.return.create"), async (c) => {
    const parsed = buildSalesReturnFromInvoiceSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    if (!invoices) {
      return c.json({ error: "INVOICE_LOOKUP_UNAVAILABLE", message: "إنشاء مرتجع من فاتورة يتطلب وحدة فواتير المبيعات." }, 503);
    }
    const invoice = await invoices.findConfirmedInvoice(parsed.data.sourceInvoiceId);
    if (!invoice) {
      return c.json({ error: "SOURCE_INVOICE_NOT_FOUND", message: "الفاتورة المصدر غير موجودة أو غير مؤكدة." }, 404);
    }
    const lines = buildSalesReturnLinesFromInvoice(
      invoice,
      parsed.data.warehouseId,
      parsed.data.reason,
      parsed.data.requested.map((r) => ({ itemId: r.itemId, qty: Qty.fromMajor(r.qty), reason: r.reason })),
    );
    if (lines.length === 0) {
      return c.json({ error: "NO_RETURNABLE_LINES", message: "لا توجد بنود قابلة للإرجاع بالكميات المطلوبة." }, 422);
    }
    try {
      const doc = await service.createDraft({
        id: parsed.data.id,
        date: parsed.data.date,
        memo: parsed.data.memo,
        lines,
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
      return c.json({
        document: serialize(result.document, await refundsOf(result.document.id)),
        held: result.held,
      });
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  app.post("/:id/cancel", gate("sales.return.void"), async (c) => {
    try {
      const doc = await service.cancel(c.req.param("id"));
      return c.json(serialize(doc, await refundsOf(doc.id)));
    } catch (err) {
      return handleDocumentError(c, err);
    }
  });

  /**
   * «استرداد للعميل» (R3.9). Creates and CONFIRMS a رد مبلغ لعميل voucher, so
   * the till falls and AR is debited by the same figure in one balanced entry.
   * What may still be refunded is recomputed from the posted return and the
   * vouchers already posted against it — never from anything in this request
   * body. Reversing the voucher restores the ledger AND puts the return back
   * بانتظار دفع المبلغ, because the state is derived from the vouchers rather
   * than stored beside them.
   */
  app.post("/:id/refund", gate("sales.return.confirm"), async (c) => {
    const parsed = refundSalesReturnSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    if (!refunds) {
      return c.json({ error: "REFUND_UNAVAILABLE", message: "الاسترداد يتطلب سند صرف؛ وحدة الخزينة غير مفعّلة." }, 503);
    }
    const id = c.req.param("id");
    const doc = await service.findById(id);
    if (!doc) return c.json({ error: "NOT_FOUND" }, 404);
    const customerId = doc.lines[0]?.customerId;
    if (!customerId) return c.json({ error: "NO_CUSTOMER", message: "المرتجع بلا عميل." }, 422);

    const amount = Money.fromMajor(parsed.data.amount);
    try {
      assertRefundable(doc, await refundsOf(id), amount);
      const posted = await refunds.post({
        returnId: id,
        customerId,
        amount,
        treasuryAccountId: parsed.data.treasuryAccountId,
        paymentMethod: parsed.data.paymentMethod ?? "cash",
        date: parsed.data.date ?? doc.date,
        memo: parsed.data.notes ?? `استرداد على المرتجع ${doc.docNo ?? doc.id}`,
        referenceNo: parsed.data.referenceNo ?? null,
        actor: c.req.header("x-user-id") ?? undefined,
      });
      const settled = (await service.findById(id)) ?? doc;
      return c.json({
        ...serialize(settled, await refundsOf(id)),
        voucherId: posted.voucherId,
        voucherNo: posted.voucherNo,
      });
    } catch (err) {
      if (err instanceof SalesReturnNotRefundableError) {
        return c.json({ error: err.code, message: err.message }, 422);
      }
      return handleDocumentError(c, err);
    }
  });

  return app;
}
