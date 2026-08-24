import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  type DocumentNumberingHook,
  type DocumentGlHook,
  SalesQuoteService,
  InvalidSalesQuoteError,
  SalesQuoteNotFoundError,
  DuplicateSalesQuoteError,
  InvalidSalesQuoteTransitionError,
  type SalesQuote,
  type SalesQuoteDiscount,
  type SalesQuoteTotals,
  type SalesQuoteRepository,
  type SalesQuoteServiceDeps,
  type CreateSalesQuoteCommand,
  SalesInvoiceService,
  InvalidSalesInvoiceError,
  DuplicateSalesInvoiceError,
  type SalesInvoiceRepository,
  type SalesInvoiceStockHook,
  type CreateSalesInvoiceCommand,
} from "@mezan/domain";
import {
  createSalesQuoteSchema,
  salesQuoteListQuerySchema,
  convertSalesQuoteToInvoiceSchema,
  type SalesQuoteDiscountDTO,
} from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  headerAuthContextResolver,
  type AuthContextResolver,
  branchScopeOf,
  withinScope,} from "./permission-gate.js";

/**
 * External dependencies the sales-quote routes bind the domain service to.
 * The numbering hook is the SAME `DocumentNumberingHook` port the document
 * framework defines — bind it at the composition root with
 * `{ next: () => numberingService.next("SALES_QUOTE") }`, exactly the way
 * sales-invoices does it for `"SALES_INVOICE"`.
 */
export interface SalesQuoteRoutesDeps {
  readonly repo: SalesQuoteRepository;
  readonly numbering: DocumentNumberingHook;
  readonly now?: () => string;
  /** Generates a quote id when the request omits one. Defaults to a UUID. */
  readonly idGen?: () => string;
  /**
   * Bridges "إنشاء من عرض سعر" — converting an accepted quote into a draft
   * sales invoice — through `POST /:id/convert-to-invoice`. Reuses the SAME
   * `SalesInvoiceRepository`/GL/stock hooks the `/sales-invoices` routes bind
   * to, with its own `SALES_INVOICE` numbering hook (allocated once the
   * created invoice is itself confirmed, same as any other invoice). Omit it
   * and the convert route responds 501 — this module never depends on
   * sales-invoices being mounted.
   */
  readonly invoice?: {
    readonly repo: SalesInvoiceRepository;
    readonly numbering: DocumentNumberingHook;
    readonly gl: DocumentGlHook;
    readonly stock: SalesInvoiceStockHook;
  };
}

function discountToDomain(dto: SalesQuoteDiscountDTO | undefined): SalesQuoteDiscount | undefined {
  if (!dto) return undefined;
  return dto.type === "percent"
    ? { type: "percent", percent: dto.percent }
    : { type: "amount", amount: Money.fromMajor(dto.amount) };
}

function serializeDiscount(discount: SalesQuoteDiscount) {
  return discount.type === "percent"
    ? { type: "percent" as const, percent: discount.percent }
    : { type: "amount" as const, amount: discount.amount.toString() };
}

function serializeTotals(totals: SalesQuoteTotals) {
  return {
    grossTotal: totals.grossTotal.toString(),
    lineDiscountTotal: totals.lineDiscountTotal.toString(),
    invoiceDiscountTotal: totals.invoiceDiscountTotal.toString(),
    subtotal: totals.subtotal.toString(),
    taxableTotal: totals.taxableTotal.toString(),
    taxTotal: totals.taxTotal.toString(),
    grandTotal: totals.grandTotal.toString(),
  };
}

function serialize(quote: SalesQuote, totals: SalesQuoteTotals) {
  return {
    id: quote.id,
    docType: quote.docType,
    docNo: quote.docNo,
    status: quote.status,
    date: quote.date,
    expiryDate: quote.expiryDate,
    customerId: quote.customerId,
    customerNameAr: quote.customerNameAr,
    customerTaxExempt: quote.customerTaxExempt,
    branchId: quote.branchId,
    currency: quote.currency,
    notes: quote.notes,
    internalNotes: quote.internalNotes,
    discount: serializeDiscount(quote.discount),
    priceListId: quote.priceListId,
    couponCode: quote.couponCode,
    createdAt: quote.createdAt,
    sentAt: quote.sentAt,
    respondedAt: quote.respondedAt,
    convertedAt: quote.convertedAt,
    convertedInvoiceId: quote.convertedInvoiceId,
    lines: quote.lines.map((l) => ({
      lineId: l.lineId,
      itemId: l.itemId,
      itemNameAr: l.itemNameAr,
      qty: l.qty.toString(),
      unitPrice: l.unitPrice.toString(),
      discountPercent: l.discountPercent,
      taxRatePercent: l.taxRatePercent,
    })),
    totals: serializeTotals(totals),
  };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (err instanceof InvalidSalesQuoteError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (err instanceof SalesQuoteNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateSalesQuoteError || err instanceof InvalidSalesQuoteTransitionError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  throw err;
}

/**
 * Sales-quote routes (docs/catalog/01 §"عروض الأسعار"), mounted under
 * `/sales-quotes`:
 *   POST /                  create a draft                 (sales.quote.create)
 *   GET  /                  list (status/customer/date)     (sales.quote.view)
 *   GET  /:id               get one                         (sales.quote.view)
 *   POST /:id/send          send → allocates the doc number (sales.quote.send)
 *   POST /:id/accept                                        (sales.quote.edit)
 *   POST /:id/reject                                        (sales.quote.edit)
 *   POST /:id/cancel                                        (sales.quote.edit)
 *
 * Converting an accepted quote to a sales invoice bridges two modules and is
 * implemented by the coordinator outside this file (the domain service's
 * `markConverted` is ready for it).
 */
export function createSalesQuotesRoutes(
  deps: SalesQuoteRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? (() => randomUUID());

  function service(c: Context): SalesQuoteService {
    const svcDeps: SalesQuoteServiceDeps = {
      repo: deps.repo,
      numbering: deps.numbering,
      now: deps.now,
      actor: getAuthContext(c)?.userId ?? "system",
    };
    return new SalesQuoteService(svcDeps);
  }

  function totalsFor(svc: SalesQuoteService, quote: SalesQuote): SalesQuoteTotals {
    return svc.totalsOf(quote);
  }

  app.post("/", gate("sales.quote.create"), async (c) => {
    const parsed = createSalesQuoteSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const d = parsed.data;
    const cmd: CreateSalesQuoteCommand = {
      id: d.id ?? idGen(),
      date: d.date,
      expiryDate: d.expiryDate,
      customerId: d.customerId,
      customerNameAr: d.customerNameAr,
      customerTaxExempt: d.customerTaxExempt,
      branchId: d.branchId,
      currency: d.currency,
      notes: d.notes ?? null,
      internalNotes: d.internalNotes ?? null,
      discount: discountToDomain(d.discount),
      priceListId: d.priceListId ?? null,
      couponCode: d.couponCode ?? null,
      lines: d.lines.map((l) => ({
        lineId: l.lineId,
        itemId: l.itemId,
        itemNameAr: l.itemNameAr,
        qty: Qty.fromMajor(l.qty),
        unitPrice: Money.fromMajor(l.unitPrice),
        discountPercent: l.discountPercent,
        taxRatePercent: l.taxRatePercent,
      })),
    };
    const svc = service(c);
    try {
      const quote = await svc.createDraft(cmd);
      return c.json(serialize(quote, totalsFor(svc, quote)), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/", gate("sales.quote.view"), async (c) => {
    const parsed = salesQuoteListQuerySchema.safeParse({
      status: c.req.query("status"),
      customerId: c.req.query("customerId"),
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
    });
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const svc = service(c);
    const quotes = withinScope(await svc.list(parsed.data), branchScopeOf(c), (q) => q.branchId);
    return c.json(quotes.map((q) => serialize(q, totalsFor(svc, q))));
  });

  app.get("/:id", gate("sales.quote.view"), async (c) => {
    const svc = service(c);
    const quote = await svc.findById(c.req.param("id"));
    if (!quote) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(quote, totalsFor(svc, quote)));
  });

  app.post("/:id/send", gate("sales.quote.send"), async (c) => {
    const svc = service(c);
    try {
      const quote = await svc.send(c.req.param("id"));
      return c.json(serialize(quote, totalsFor(svc, quote)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/accept", gate("sales.quote.edit"), async (c) => {
    const svc = service(c);
    try {
      const quote = await svc.accept(c.req.param("id"));
      return c.json(serialize(quote, totalsFor(svc, quote)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/reject", gate("sales.quote.edit"), async (c) => {
    const svc = service(c);
    try {
      const quote = await svc.reject(c.req.param("id"));
      return c.json(serialize(quote, totalsFor(svc, quote)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/cancel", gate("sales.quote.edit"), async (c) => {
    const svc = service(c);
    try {
      const quote = await svc.cancel(c.req.param("id"));
      return c.json(serialize(quote, totalsFor(svc, quote)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * "إنشاء من عرض سعر" (docs/catalog/01) — only an مقبول (accepted) quote
   * converts; the created invoice is a مسودة (draft), confirmed separately
   * through the normal `/sales-invoices/:id/confirm` flow (stock/GL/credit
   * control all run there, not here — converting never posts anything).
   */
  app.post("/:id/convert-to-invoice", gate("sales.invoice.create"), async (c) => {
    if (!deps.invoice) {
      return c.json(
        { error: "CONVERT_NOT_CONFIGURED", message: "تحويل عروض الأسعار لفواتير غير مُفعّل على هذا الخادم." },
        501,
      );
    }
    const parsed = convertSalesQuoteToInvoiceSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const d = parsed.data;
    const quoteSvc = service(c);
    const quote = await quoteSvc.findById(c.req.param("id"));
    if (!quote) return c.json({ error: "NOT_FOUND" }, 404);
    if (quote.status !== "accepted") {
      return c.json(
        { error: "INVALID_QUOTE_STATUS", message: "لا يمكن تحويل عرض السعر إلا بعد قبوله من العميل." },
        409,
      );
    }
    const byLineId = new Map(d.lines.map((l) => [l.lineId, l]));
    const missing = quote.lines.filter((l) => !byLineId.has(l.lineId));
    if (missing.length > 0) {
      return c.json(
        {
          error: "VALIDATION_ERROR",
          message: `بيانات الحساب المحاسبي مفقودة لبند/بنود: ${missing.map((l) => l.itemNameAr).join("، ")}`,
        },
        400,
      );
    }

    const ctx = getAuthContext(c);
    const invoiceSvc = new SalesInvoiceService({
      repo: deps.invoice.repo,
      numbering: deps.invoice.numbering,
      gl: deps.invoice.gl,
      stock: deps.invoice.stock,
      now: deps.now,
      actor: ctx?.userId ?? "system",
    });
    const cmd: CreateSalesInvoiceCommand = {
      id: d.id ?? idGen(),
      date: d.date ?? quote.date,
      dueDate: d.dueDate,
      customerId: quote.customerId,
      customerNameAr: quote.customerNameAr,
      customerTaxExempt: quote.customerTaxExempt,
      warehouseId: d.warehouseId,
      branchId: quote.branchId,
      currency: quote.currency,
      notes: quote.notes,
      internalNotes: quote.internalNotes,
      discount: quote.discount,
      arAccountId: d.arAccountId,
      taxAccountId: d.taxAccountId,
      lines: quote.lines.map((l) => {
        const acc = byLineId.get(l.lineId);
        if (!acc) throw new Error(`unreachable: line ${l.lineId} validated above`);
        return {
          lineId: l.lineId,
          itemId: l.itemId,
          itemNameAr: l.itemNameAr,
          isStock: acc.isStock,
          qty: l.qty,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          taxRatePercent: l.taxRatePercent,
          revenueAccountId: acc.revenueAccountId,
          cogsAccountId: acc.cogsAccountId ?? null,
          inventoryAccountId: acc.inventoryAccountId ?? null,
        };
      }),
    };

    try {
      const invoice = await invoiceSvc.createDraft(cmd);
      const converted = await quoteSvc.markConverted(quote.id, invoice.id);
      return c.json(
        {
          quote: serialize(converted, totalsFor(quoteSvc, converted)),
          invoiceId: invoice.id,
          invoiceDocNo: invoice.docNo,
        },
        201,
      );
    } catch (err) {
      if (err instanceof InvalidSalesInvoiceError) {
        return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
      }
      if (err instanceof DuplicateSalesInvoiceError) {
        return c.json({ error: err.code, message: err.message }, 409);
      }
      return handleDomainError(c, err);
    }
  });

  return app;
}
