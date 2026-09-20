import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  Money,
  Qty,
  can,
  type DocumentNumberingHook,
  type DocumentGlHook,
  SalesQuoteService,
  isQuoteExpired,
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
import { refuseUnknownItems, type ItemCatalogCheck } from "./item-check.js";
import { MasterDataKind, refuseUnknownMasterData, type MasterDataChecks } from "./master-data-check.js";
import {
  documentVersionOf,
  documentVersionsOf,
  expectedVersionOf,
  readOptionalBody,
  refuseStaleDocument,
  stampDocumentModifier,
  type DocumentVersionGuard,
} from "./document-version.js";
import {
  createPermissionGate,
  createAnyPermissionGate,
  getAuthContext,
  type AuthContextResolver,
  branchScopeOf,
  withinScope,} from "./permission-gate.js";
import { tenantDay } from "./tenant-day.js";

/**
 * External dependencies the sales-quote routes bind the domain service to.
 * The numbering hook is the SAME `DocumentNumberingHook` port the document
 * framework defines — bind it at the composition root with
 * `{ next: () => numberingService.next("SALES_QUOTE") }`, exactly the way
 * sales-invoices does it for `"SALES_INVOICE"`.
 */
export interface SalesQuoteRoutesDeps {
  readonly repo: SalesQuoteRepository;
  /**
   * N-9 — optimistic concurrency. Omitted, the routes behave exactly as before;
   * supplied, a caller holding a stale `expectedVersion` is refused instead of
   * overwriting the till that got there first.
   */
  readonly versionGuard?: DocumentVersionGuard;
  /** Refuses a line naming an item the catalogue does not hold (D38); omit for no check. */
  readonly itemCheck?: ItemCatalogCheck;
  /** Refuses a quote naming a customer, warehouse or branch no master record holds (D310). */
  readonly masterData?: MasterDataChecks;
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

function withMessageEn(err: { code: string; message: string }) {
  const messageEn = (err as { messageEn?: string }).messageEn;
  return { error: err.code, message: err.message, ...(messageEn ? { messageEn } : {}) };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (err instanceof InvalidSalesQuoteError) {
    return c.json({ ...withMessageEn(err), reasons: err.reasons }, 422);
  }
  if (err instanceof SalesQuoteNotFoundError) {
    return c.json(withMessageEn(err), 404);
  }
  if (err instanceof DuplicateSalesQuoteError || err instanceof InvalidSalesQuoteTransitionError) {
    return c.json(withMessageEn(err), 409);
  }
  throw err;
}

/**
 * Sales-quote routes (docs/archive/catalog/01 §"عروض الأسعار"), mounted under
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
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const gateAny = createAnyPermissionGate(resolveAuthContext);

  /*
   * A quote records no author, so `sales.quote.view_own` cannot be evaluated by
   * who wrote it. The narrowing that IS available is the branch scope the
   * session already carries, so a `view_own` caller sees the quotes inside
   * their own branch scope — and one carrying the all-branch sentinel is shown
   * nothing rather than the whole tenant, because widening a gate without a
   * narrowing key is a leak.
   */
  const ownVisibilityOnly = (c: Context) => {
    const ctx = getAuthContext(c);
    return ctx ? !can(ctx, "sales.quote.view") : false;
  };

  const visibleQuotes = <T extends { readonly branchId: string }>(c: Context, rows: readonly T[]): readonly T[] => {
    const branches = branchScopeOf(c);
    if (ownVisibilityOnly(c) && !branches) return [];
    return withinScope(rows, branches, (r) => r.branchId);
  };
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
    const refusal = await refuseUnknownItems(c, deps.itemCheck, cmd.lines.map((l) => l.itemId));
    if (refusal) return refusal;
    const partyRefusal = await refuseUnknownMasterData(c, deps.masterData, [
      { kind: MasterDataKind.Customer, ids: [cmd.customerId] },
      { kind: MasterDataKind.Branch, ids: [cmd.branchId] },
    ]);
    if (partyRefusal) return partyRefusal;

    const svc = service(c);
    try {
      const quote = await svc.createDraft(cmd);
      return c.json(serialize(quote, totalsFor(svc, quote)), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * The list's status axis carries a derived منتهي bucket the stored status
   * set has no value for, so `status` is read raw here and only a real stored
   * status is forwarded to the repository — sending `expired` would match none.
   */
  const DERIVED_QUOTE_FILTERS = new Set(["all", "expired"]);

  interface QuoteListFilter {
    readonly status?: string;
    readonly customerId?: string;
    readonly fromDate?: string;
    readonly toDate?: string;
    readonly branchId?: string;
    readonly search?: string;
  }

  function parseQuoteListQuery(c: Context): { ok: true; filter: QuoteListFilter } | { ok: false; details: unknown } {
    const status = c.req.query("status");
    const stored = status && !DERIVED_QUOTE_FILTERS.has(status) ? status : undefined;
    const parsed = salesQuoteListQuerySchema.safeParse({
      status: stored,
      customerId: c.req.query("customerId"),
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
    });
    if (!parsed.success) return { ok: false, details: parsed.error.flatten() };
    return {
      ok: true,
      filter: {
        ...parsed.data,
        status: status || undefined,
        branchId: c.req.query("branchId") || undefined,
        search: c.req.query("search") || undefined,
      },
    };
  }

  /** The tenant's calendar day, never the host's UTC one (D288). */
  function today(c: Context): Promise<string> {
    return tenantDay(c, deps.now?.() ?? new Date().toISOString());
  }

  /**
   * The single filter the rows, the chip counts and the KPI strip all go
   * through (R1.1). The screen used to narrow by branch, customer and free
   * text in the browser while the three money tiles were summed over every
   * quote the server had sent, so applying a branch moved the rows and left
   * the header alone.
   *
   * `branchId` and `search` are presentation filters over an already-scoped
   * set — `branchScopeOf` still decides what this user may see at all, and no
   * query parameter widens it.
   */
  async function listFilteredQuotes(svc: SalesQuoteService, c: Context, filter: QuoteListFilter): Promise<readonly SalesQuote[]> {
    const { status, branchId, search, ...dateFilter } = filter;
    const stored = status && !DERIVED_QUOTE_FILTERS.has(status) ? status : undefined;
    let rows = visibleQuotes(
      c,
      await svc.list({ ...dateFilter, ...(stored ? { status: stored } : {}) } as Parameters<SalesQuoteService["list"]>[0]),
    );
    if (branchId) rows = rows.filter((q) => q.branchId === branchId);
    const term = search?.trim().toLowerCase();
    if (term) {
      rows = rows.filter(
        (q) => (q.docNo ?? "").toLowerCase().includes(term) || (q.customerNameAr ?? "").toLowerCase().includes(term),
      );
    }
    if (status === "expired") {
      const asOf = await today(c);
      rows = rows.filter((q) => isQuoteExpired(q, asOf));
    }
    return rows;
  }

  app.get("/", gateAny("sales.quote.view", "sales.quote.view_own"), async (c) => {
    const parsed = parseQuoteListQuery(c);
    if (!parsed.ok) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.details }, 400);
    }
    const svc = service(c);
    const quotes = await listFilteredQuotes(svc, c, parsed.filter);
    // N-9: send/accept/reject/cancel all act from the row's kebab, so the row
    // has to carry the version or `expectedVersion` is never sent.
    const versions = await documentVersionsOf(deps.versionGuard, quotes.map((q) => q.id));
    return c.json(quotes.map((q) => ({ ...serialize(q, totalsFor(svc, q)), version: versions.get(q.id) })));
  });

  /**
   * The status chips. Deliberately ignores the `status` query parameter: a
   * chip has to say how many rows it WOULD show, so counting the already
   * status-filtered set would render every chip but the active one as zero.
   */
  app.get("/counts", gateAny("sales.quote.view", "sales.quote.view_own"), async (c) => {
    const parsed = parseQuoteListQuery(c);
    if (!parsed.ok) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.details }, 400);
    }
    const svc = service(c);
    const { status: _ignored, ...withoutStatus } = parsed.filter;
    const quotes = await listFilteredQuotes(svc, c, withoutStatus);
    const asOf = await today(c);
    const counts: Record<string, number> = {
      all: quotes.length,
      draft: 0,
      sent: 0,
      accepted: 0,
      rejected: 0,
      converted: 0,
      cancelled: 0,
      expired: 0,
    };
    for (const q of quotes) {
      counts[q.status] = (counts[q.status] ?? 0) + 1;
      if (isQuoteExpired(q, asOf)) counts.expired! += 1;
    }
    return c.json(counts);
  });

  /**
   * The KPI strip. A quotations pipeline is judged in money, and the money is
   * summed here in `Money` over the whole filtered set — the screen used to
   * add `Number(grandTotal)` across every quote it held.
   */
  app.get("/stats", gateAny("sales.quote.view", "sales.quote.view_own"), async (c) => {
    const parsed = parseQuoteListQuery(c);
    if (!parsed.ok) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.details }, 400);
    }
    const svc = service(c);
    const quotes = await listFilteredQuotes(svc, c, parsed.filter);
    let total = Money.zero();
    let accepted = Money.zero();
    let converted = Money.zero();
    for (const q of quotes) {
      const amount = totalsFor(svc, q).grandTotal;
      total = total.add(amount);
      if (q.status === "accepted") accepted = accepted.add(amount);
      if (q.status === "converted") converted = converted.add(amount);
    }
    return c.json({
      count: quotes.length,
      total: total.toString(),
      accepted: accepted.toString(),
      converted: converted.toString(),
    });
  });

  app.get("/:id", gateAny("sales.quote.view", "sales.quote.view_own"), async (c) => {
    const svc = service(c);
    const quote = await svc.findById(c.req.param("id"));
    if (!quote) return c.json({ error: "NOT_FOUND" }, 404);
    if (visibleQuotes(c, [quote]).length === 0) return c.json({ error: "NOT_FOUND" }, 404);
    // N-9: the screen keeps this and sends it back on the next act.
    return c.json({ ...serialize(quote, totalsFor(svc, quote)), version: await documentVersionOf(deps.versionGuard, quote.id) });
  });

  app.post("/:id/send", gate("sales.quote.send"), async (c) => {
    const stale = await refuseStaleDocument(c, deps.versionGuard, c.req.param("id"), expectedVersionOf(await readOptionalBody(c)));
    if (stale) return stale;
    const svc = service(c);
    try {
      const quote = await svc.send(c.req.param("id"));
      await stampDocumentModifier(deps.versionGuard, quote.id, getAuthContext(c)?.userId);
      return c.json(serialize(quote, totalsFor(svc, quote)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/accept", gate("sales.quote.edit"), async (c) => {
    const stale = await refuseStaleDocument(c, deps.versionGuard, c.req.param("id"), expectedVersionOf(await readOptionalBody(c)));
    if (stale) return stale;
    const svc = service(c);
    try {
      const quote = await svc.accept(c.req.param("id"));
      await stampDocumentModifier(deps.versionGuard, quote.id, getAuthContext(c)?.userId);
      return c.json(serialize(quote, totalsFor(svc, quote)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/reject", gate("sales.quote.edit"), async (c) => {
    const stale = await refuseStaleDocument(c, deps.versionGuard, c.req.param("id"), expectedVersionOf(await readOptionalBody(c)));
    if (stale) return stale;
    const svc = service(c);
    try {
      const quote = await svc.reject(c.req.param("id"));
      await stampDocumentModifier(deps.versionGuard, quote.id, getAuthContext(c)?.userId);
      return c.json(serialize(quote, totalsFor(svc, quote)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/cancel", gate("sales.quote.edit"), async (c) => {
    const stale = await refuseStaleDocument(c, deps.versionGuard, c.req.param("id"), expectedVersionOf(await readOptionalBody(c)));
    if (stale) return stale;
    const svc = service(c);
    try {
      const quote = await svc.cancel(c.req.param("id"));
      await stampDocumentModifier(deps.versionGuard, quote.id, getAuthContext(c)?.userId);
      return c.json(serialize(quote, totalsFor(svc, quote)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * "إنشاء من عرض سعر" (docs/archive/catalog/01) — only an مقبول (accepted) quote
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
    const convertWarehouseRefusal = await refuseUnknownMasterData(c, deps.masterData, [
      { kind: MasterDataKind.Warehouse, ids: [d.warehouseId] },
    ]);
    if (convertWarehouseRefusal) return convertWarehouseRefusal;
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
        return c.json({ ...withMessageEn(err), reasons: err.reasons }, 422);
      }
      if (err instanceof DuplicateSalesInvoiceError) {
        return c.json(withMessageEn(err), 409);
      }
      return handleDomainError(c, err);
    }
  });

  return app;
}
