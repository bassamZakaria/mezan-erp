import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  buildPurchaseReturnLinesFromInvoice,
  purchaseReturnGrandTotal,
  purchaseReturnLineCredit,
  type DocumentService,
  type FrameworkDocument,
  type PurchaseInvoiceLookupPort,
  type PurchaseReturnLine,
} from "@mezan/domain";
import { createPurchaseReturnSchema, returnSourceLinesSchema } from "@mezan/contracts";
import { type AuthContextResolver, callerUserId, createPermissionGate, warehouseScopeOf, withinScope } from "./permission-gate.js";
import { handleDocumentError } from "./document-error-handling.js";
import { tenantDay } from "./tenant-day.js";

function serializeLine(l: PurchaseReturnLine) {
  return {
    itemId: l.itemId,
    warehouseId: l.warehouseId,
    supplierId: l.supplierId,
    sourceInvoiceId: l.sourceInvoiceId,
    sourceInvoiceNumber: l.sourceInvoiceNumber,
    sourceLineId: l.sourceLineId ?? null,
    reason: l.reason,
    availableQty: l.availableQty.toString(),
    qty: l.qty.toString(),
    unitCost: l.unitCost.toString(),
    taxAmount: l.taxAmount.toString(),
    taxRatePercent: l.taxRatePercent ?? null,
    taxRateId: l.taxRateId ?? null,
    projectId: l.projectId ?? null,
    costCategory: l.costCategory ?? null,
    currency: l.currency ?? null,
    fxRate: l.fxRate ?? null,
    baseCredit: purchaseReturnLineCredit(l).toString(),
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
    grandTotal: purchaseReturnGrandTotal(doc).toString(),
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
  resolveAuthContext: AuthContextResolver,
  /**
   * Resolves the source invoice so the returnable quantity is derived HERE.
   * Without it the server validated against an `availableQty` the CLIENT sent,
   * so the same goods could be returned repeatedly. Mirrors sales-returns.
   */
  invoices?: PurchaseInvoiceLookupPort,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  type SourceInvoice = Awaited<ReturnType<PurchaseInvoiceLookupPort["findConfirmedInvoice"]>>;
  // Scoped to ONE request: `alreadyReturnedQty` moves every time a return
  // confirms, and a cache that outlives the request would keep serving the
  // cap from before it did.
  async function lookupInvoice(cache: Map<string, SourceInvoice>, sourceInvoiceId: string) {
    if (!invoices) return undefined;
    if (!cache.has(sourceInvoiceId)) {
      cache.set(sourceInvoiceId, await invoices.findConfirmedInvoice(sourceInvoiceId));
    }
    return cache.get(sourceInvoiceId) ?? null;
  }

  /**
   * A `POST /` line checked against the invoice it names: a return against an
   * invoice that does not exist, against another supplier's invoice, or for an
   * item the invoice never carried is a debit note nobody owes (the twin of
   * the sales check, D89). With no invoices module wired there is nothing to
   * check against.
   */
  function refuseInconsistentLine(
    line: { supplierId: string; itemId: string },
    invoice: SourceInvoice | undefined,
  ): { error: string; message: string } | null {
    if (invoice === undefined) return null;
    if (!invoice) {
      return { error: "SOURCE_INVOICE_NOT_FOUND", message: "الفاتورة المصدر غير موجودة أو غير مؤكدة." };
    }
    if (invoice.supplierId !== line.supplierId) {
      return { error: "RETURN_SUPPLIER_MISMATCH", message: "مورد المرتجع لا يطابق مورد الفاتورة المصدر." };
    }
    if (!invoice.lines.some((il) => il.itemId === line.itemId)) {
      return { error: "RETURN_ITEM_NOT_ON_INVOICE", message: "الصنف غير موجود في الفاتورة المصدر." };
    }
    return null;
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

  app.get("/source-lines/:invoiceId", gate("purchases.return.create"), async (c) => {
    if (!invoices) {
      return c.json({ error: "INVOICE_LOOKUP_UNAVAILABLE", message: "قراءة بنود الفاتورة المصدر تتطلب وحدة فواتير المشتريات." }, 503);
    }
    const invoice = await invoices.findConfirmedInvoice(c.req.param("invoiceId"));
    if (!invoice) return c.json({ error: "SOURCE_INVOICE_NOT_FOUND", message: "الفاتورة المصدر غير موجودة أو غير مؤكدة." }, 404);
    return c.json(
      returnSourceLinesSchema.parse({
        sourceInvoiceId: invoice.id,
        lines: invoice.lines.flatMap((line) =>
          line.sourceLineId
            ? [{ sourceLineId: line.sourceLineId, itemId: line.itemId, soldQty: line.qty.toString(), returnedQty: line.alreadyReturnedQty.toString() }]
            : [],
        ),
      }),
    );
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
    const requestInvoices = new Map<string, SourceInvoice>();
    for (const line of parsed.data.lines) {
      const refusal = refuseInconsistentLine(line, await lookupInvoice(requestInvoices, line.sourceInvoiceId));
      if (refusal) return c.json(refusal, 422);
    }
    // INVARIANT: a request's lines against one invoice are derived in ONE
    // call; derived one at a time, each is offered the whole of the line.
    type RequestLine = (typeof parsed.data.lines)[number];
    type StatedLine = RequestLine & { availableQty: string; unitCost: string; taxAmount: string };
    const statesItsFigures = (l: RequestLine): l is StatedLine =>
      l.availableQty !== undefined && l.unitCost !== undefined && l.taxAmount !== undefined;
    const claimedOf = (l: StatedLine): PurchaseReturnLine => ({
      itemId: l.itemId,
      warehouseId: l.warehouseId,
      supplierId: l.supplierId,
      sourceInvoiceId: l.sourceInvoiceId,
      sourceInvoiceNumber: l.sourceInvoiceNumber,
      sourceLineId: l.sourceLineId ?? null,
      reason: l.reason,
      availableQty: Qty.fromMajor(l.availableQty),
      qty: Qty.fromMajor(l.qty),
      unitCost: Money.fromMajor(l.unitCost),
      taxAmount: Money.fromMajor(l.taxAmount),
      taxRatePercent: l.taxRatePercent ?? null,
      projectId: parsed.data.projectId ?? null,
      costCategory: l.costCategory ?? null,
    });
    const lines: PurchaseReturnLine[] = [];
    for (const sourceInvoiceId of new Set(parsed.data.lines.map((l) => l.sourceInvoiceId))) {
      const ofInvoice = parsed.data.lines.filter((l) => l.sourceInvoiceId === sourceInvoiceId);
      const invoice = await lookupInvoice(requestInvoices, sourceInvoiceId);
      if (!invoice) {
        if (!ofInvoice.every(statesItsFigures)) {
          return c.json(
            {
              error: "RETURN_FIGURES_REQUIRED",
              message: "تعذّر قراءة الفاتورة المصدر؛ يجب إرسال تكلفة البند وضريبته والكمية المتاحة للإرجاع.",
            },
            422,
          );
        }
        lines.push(...ofInvoice.filter(statesItsFigures).map(claimedOf));
        continue;
      }
      const first = ofInvoice[0] as RequestLine;
      const built = buildPurchaseReturnLinesFromInvoice(
        invoice,
        first.warehouseId,
        first.reason,
        ofInvoice.map((l) => ({
          itemId: l.itemId,
          sourceLineId: l.sourceLineId ?? null,
          qty: Qty.fromMajor(l.qty),
          reason: l.reason,
          warehouseId: l.warehouseId,
          costCategory: l.costCategory ?? undefined,
        })),
      );
      if (built.unmatched.length > 0) {
        return c.json(
          {
            error: "RETURN_LINE_NOT_ON_INVOICE",
            message: "أحد بنود المرتجع غير موجود في الفاتورة المصدر.",
            unmatched: built.unmatched.map((u) => ({ itemId: u.itemId, sourceLineId: u.sourceLineId ?? null })),
          },
          422,
        );
      }
      lines.push(...built.lines.map((line) => ({ ...line, projectId: parsed.data.projectId ?? line.projectId ?? null })));
    }
    try {
      const doc = await service.createDraft({
        id: parsed.data.id,
        date: await tenantDay(c, parsed.data.date),
        memo: parsed.data.memo,
        lines,
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
