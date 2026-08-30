import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  assertRefundable,
  buildSalesReturnLinesFromInvoice,
  isAwaitingRefund,
  refundDue,
  salesReturnGrandTotal,
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
import { type AuthContextResolver, callerUserId, createPermissionGate, warehouseScopeOf, withinScope } from "./permission-gate.js";
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
    taxRatePercent: l.taxRatePercent ?? null,
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
 * Sales Returns routes (docs/archive/catalog/01 §"مرتجعات المبيعات"), mounted under
 * `/sales-returns`. `service` is a fully-wired `DocumentService<SalesReturnLine>`
 * (repo + numbering + GL hook + stock hook + workflow gate) — building it is
 * the caller's job (apps/server / apps/desktop composition root, or the web
 * demo store), matching how `/inventory` and `/gl` are mounted.
 */
export function createSalesReturnsRoutes(
  service: DocumentService<SalesReturnLine>,
  resolveAuthContext: AuthContextResolver,
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

  interface SalesReturnListFilter {
    readonly status?: string;
    readonly customerId?: string;
    readonly fromDate?: string;
    readonly toDate?: string;
    readonly awaitingRefund?: boolean;
    readonly search?: string;
  }

  function parseListQuery(c: Context): SalesReturnListFilter {
    const status = c.req.query("status");
    return {
      status: status && status !== "all" ? status : undefined,
      customerId: c.req.query("customerId") || undefined,
      fromDate: c.req.query("fromDate") || undefined,
      toDate: c.req.query("toDate") || undefined,
      awaitingRefund: c.req.query("awaitingRefund") === "true",
      search: c.req.query("search") || undefined,
    };
  }

  interface FilteredReturns {
    readonly rows: readonly FrameworkDocument<SalesReturnLine>[];
    readonly refunds: ReadonlyMap<string, readonly SalesReturnRefund[]>;
  }

  /**
   * The single filter the rows, the chip counts and the KPI strip all go
   * through (R1.1). The screen narrowed by customer, date and free text in the
   * browser while its three tiles counted every return the server had sent, so
   * applying a filter moved the rows and left the header alone.
   *
   * `customerId`/`search`/`awaitingRefund` are presentation filters over an
   * already-scoped set — `warehouseScopeOf` still decides what this user may
   * see at all, and no query parameter widens it.
   */
  async function listFilteredReturns(c: Context, filter: SalesReturnListFilter): Promise<FilteredReturns> {
    const list = await service.list({
      status: filter.status as never,
      fromDate: filter.fromDate,
      toDate: filter.toDate,
    });
    // A return moves stock back into a warehouse, so the header's warehouse
    // scope has to narrow it (R1.14).
    // The warehouse is on the LINES, not the header, so a document is in
    // scope when any of its lines is — the same rule the stock-document
    // routes already apply.
    const scope = warehouseScopeOf(c);
    let rows = !scope ? list : list.filter((doc) => doc.lines.some((line) => scope.includes(line.warehouseId)));
    if (filter.customerId) {
      rows = rows.filter((doc) => doc.lines.some((line) => line.customerId === filter.customerId));
    }
    const term = filter.search?.trim().toLowerCase();
    if (term) {
      rows = rows.filter(
        (doc) =>
          (doc.docNo ?? "").toLowerCase().includes(term) ||
          doc.lines.some(
            (line) =>
              (line.sourceInvoiceNumber ?? "").toLowerCase().includes(term) ||
              line.customerId.toLowerCase().includes(term),
          ),
      );
    }

    const refunds = new Map<string, readonly SalesReturnRefund[]>();
    for (const doc of rows) refunds.set(doc.id, await refundsOf(doc.id));
    if (filter.awaitingRefund) {
      rows = rows.filter((doc) => isAwaitingRefund(doc, refunds.get(doc.id) ?? []));
    }
    return { rows, refunds };
  }

  app.get("/", gate("sales.return.view"), async (c) => {
    const { rows, refunds } = await listFilteredReturns(c, parseListQuery(c));
    return c.json(rows.map((doc) => serialize(doc, refunds.get(doc.id) ?? [])));
  });

  /**
   * The status chips. Deliberately ignores its own `status` axis — and the
   * بانتظار دفع المبلغ toggle that sits beside it — because a chip states how
   * many rows it WOULD show; counting the already-filtered set renders every
   * chip but the active one as zero. Every other filter still applies.
   */
  app.get("/counts", gate("sales.return.view"), async (c) => {
    const { status: _status, awaitingRefund: _awaiting, ...withoutStatus } = parseListQuery(c);
    const { rows, refunds } = await listFilteredReturns(c, withoutStatus);
    const counts: Record<string, number> = {
      all: rows.length,
      draft: 0,
      pending: 0,
      confirmed: 0,
      cancelled: 0,
      reversed: 0,
      awaitingRefund: 0,
    };
    for (const doc of rows) {
      counts[doc.status] = (counts[doc.status] ?? 0) + 1;
      if (isAwaitingRefund(doc, refunds.get(doc.id) ?? [])) counts.awaitingRefund! += 1;
    }
    return c.json(counts);
  });

  /**
   * The KPI strip, summed in `Money` over the whole filtered set. Only a
   * confirmed return has taken anything off the customer's receivable, so a
   * draft's value is not returned money.
   */
  app.get("/stats", gate("sales.return.view"), async (c) => {
    const { rows, refunds } = await listFilteredReturns(c, parseListQuery(c));
    let confirmed = 0;
    let awaitingRefund = 0;
    let returnedTotal = Money.zero();
    let refundedTotal = Money.zero();
    let refundDueTotal = Money.zero();
    for (const doc of rows) {
      const paid = refunds.get(doc.id) ?? [];
      if (doc.status === "confirmed") {
        confirmed += 1;
        returnedTotal = returnedTotal.add(salesReturnGrandTotal(doc));
      }
      refundedTotal = refundedTotal.add(sumRefunds(paid));
      const due = refundDue(doc, paid);
      if (due.scaled > 0n) {
        awaitingRefund += 1;
        refundDueTotal = refundDueTotal.add(due);
      }
    }
    return c.json({
      count: rows.length,
      confirmed,
      awaitingRefund,
      returnedTotal: returnedTotal.toString(),
      refundedTotal: refundedTotal.toString(),
      refundDue: refundDueTotal.toString(),
    });
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
          taxRatePercent: l.taxRatePercent ?? null,
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
        actor: callerUserId(c),
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
        actor: callerUserId(c),
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
