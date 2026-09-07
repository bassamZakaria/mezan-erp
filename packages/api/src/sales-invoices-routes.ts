import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  type AllocatableInvoiceRepository,
  ApprovalRequestRejectedError,
  Money,
  salesReturnCreditByInvoice,
  type SalesReturnDocument,
  Qty,
  SalesInvoiceService,
  computeInvoiceTotals,
  InvalidSalesInvoiceError,
  SalesInvoiceNotFoundError,
  DuplicateSalesInvoiceError,
  InvalidSalesInvoiceTransitionError,
  InvalidSalesInvoicePaymentError,
  UnbalancedEntryError,
  InvalidJournalEntryError,
  AccountNotFoundError,
  HeaderAccountNotPostableError,
  InactiveAccountError,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  DuplicateJournalEntryError,
  ExpiredStockError,
  NegativeStockError,
  UncostedDeficitIssueError,
  CreditLimitExceededError,
  type AppliedSalesInvoicePromotion,
  type SalesInvoice,
  type SalesInvoiceDiscount,
  type SalesInvoiceTotals,
  type SalesInvoiceRepository,
  type SalesInvoiceStockHook,
  type SalesInvoiceServiceDeps,
  type SalesInvoiceCreditControlDeps,
  type SalesInvoicePromotionHook,
  type CreateSalesInvoiceCommand,
  type DocumentNumberingHook,
  type DocumentGlHook,
  type DocumentWorkflowGate,
  type DocumentEventPublisher,
  type AuditSink,
  type CreditCheckResult,
  can,
  type SalesInvoicePricingDeps,
  type SalesInvoiceTaxPolicy,
} from "@mezan/domain";
import {
  createSalesInvoiceSchema,
  confirmSalesInvoiceSchema,
  salesInvoicePaymentSchema,
  salesInvoiceListQuerySchema,
  type SalesInvoiceListQueryDTO,
  type SalesInvoiceDiscountDTO,
} from "@mezan/contracts";
import type { CurrencyCheck } from "./currency-policy.js";
import { refuseUnknownItems, type ItemCatalogCheck } from "./item-check.js";
import { type AuthContextResolver, branchScopeOf, callerRoleCodes, createAnyPermissionGate, createPermissionGate, getAuthContext, warehouseScopeOf } from "./permission-gate.js";

/**
 * External dependencies the sales-invoice routes bind the domain service to.
 * The GL / stock / numbering / workflow hooks are the SAME ports the document
 * framework defines; assemble them at the composition root with
 * `createSalesInvoiceGlHook` / `createSalesInvoiceStockHook`.
 */
export interface SalesInvoiceRoutesDeps {
  readonly repo: SalesInvoiceRepository;
  readonly numbering: DocumentNumberingHook;
  readonly gl: DocumentGlHook;
  readonly stock: SalesInvoiceStockHook;
  readonly workflow?: DocumentWorkflowGate;
  /** Credit control on confirm (docs/archive/catalog/01/09 §"الرقابة الائتمانية"); omit for no check at all. */
  readonly creditControl?: SalesInvoiceCreditControlDeps;
  /** Evaluates promotions on confirm (docs/archive/catalog/01 §"العروض"); omit and no invoice records one. */
  readonly promotions?: SalesInvoicePromotionHook;
  /** The customer's own price list, so a line under it is surfaced rather than silently accepted (D35). */
  readonly pricing?: SalesInvoicePricingDeps;
  /** Refuses a line naming an item the catalogue does not hold (D38); omit for no check. */
  readonly itemCheck?: ItemCatalogCheck;
  /** The tenant's VAT rules (settings §"الضريبة"), stamped onto a draft when it is raised. */
  readonly taxPolicy?: () => Promise<SalesInvoiceTaxPolicy> | SalesInvoiceTaxPolicy;
  /**
   * The tenant's discount ceiling (settings §"الرقابة الائتمانية"). Optional
   * for the same reason every cross-aggregate check here is: a caller that does
   * not wire it gets the giveaway guard only, never a route that cannot mount.
   */
  readonly discountPolicy?: () => Promise<{ readonly maxLineDiscountPercent: number }>;
  /** Refuses a document currency the tenant has not enabled (settings §"عام"). */
  readonly currencyCheck?: CurrencyCheck;
  /**
   * Exchange rates, so a foreign-currency invoice posts its base value at the
   * approved rate of its own date and tags the receivable line for revaluation
   * (D24). Omit and a non-base currency is refused rather than posted 1:1.
   */
  readonly exchangeRates?: { findRate(currency: string, asOfDate: string): Promise<{ rate: string } | null> };
  /** The tenant's base currency; defaults to EGP. */
  readonly baseCurrency?: string;
  /**
   * Turns a collection recorded on the invoice into a real confirmed collection
   * voucher, allocated to that invoice. Without it the route refuses rather
   * than writing a payment the ledger never hears about (D1).
   */
  readonly collect?: (input: {
    invoiceId: string;
    customerId: string;
    branchId: string;
    amount: Money;
    treasuryAccountId: string;
    paymentMethod: "cash" | "bank" | "cheque" | "card" | "wallet";
    date: string;
    referenceNo?: string | null;
    memo?: string | null;
    actor?: string;
  }) => Promise<{ voucherId: string }>;
  readonly audit?: AuditSink;
  readonly allocatable?: AllocatableInvoiceRepository;
  /**
   * Confirmed sales returns, so an invoice's remaining balance nets off what
   * has been returned against it — the GL credits AR on every confirmed return
   * while the invoice went on reporting its full total as outstanding.
   */
  readonly returns?: { list(): Promise<readonly SalesReturnDocument[]> };
  readonly events?: DocumentEventPublisher;
  readonly now?: () => string;
  /** Generates an invoice id when the request omits one. Defaults to a UUID. */
  readonly idGen?: () => string;
}

function discountToDomain(dto: SalesInvoiceDiscountDTO | undefined): SalesInvoiceDiscount | undefined {
  if (!dto) return undefined;
  return dto.type === "percent"
    ? { type: "percent", percent: dto.percent }
    : { type: "amount", amount: Money.fromMajor(dto.amount) };
}

function serializeDiscount(discount: SalesInvoiceDiscount) {
  return discount.type === "percent"
    ? { type: "percent" as const, percent: discount.percent }
    : { type: "amount" as const, amount: discount.amount.toString() };
}

function serializeCreditWarning(warning: CreditCheckResult | null) {
  if (!warning) return null;
  return {
    status: warning.status,
    projectedBalance: warning.projectedBalance.toString(),
    overBy: warning.overBy.toString(),
    message: warning.message,
  };
}

function serializeAppliedPromotion(promotion: AppliedSalesInvoicePromotion | null) {
  if (!promotion) return null;
  return {
    promotionId: promotion.promotionId,
    code: promotion.code,
    nameAr: promotion.nameAr,
    couponCode: promotion.couponCode,
    discountTotal: promotion.discountTotal.toString(),
    lineDiscounts: promotion.lineDiscounts.map((d) => ({
      lineId: d.lineId,
      itemId: d.itemId,
      amount: d.amount.toString(),
    })),
    appliedAt: promotion.appliedAt,
  };
}

function serializeTotals(totals: SalesInvoiceTotals) {
  return {
    taxInclusive: totals.taxInclusive,
    grossTotal: totals.grossTotal.toString(),
    lineDiscountTotal: totals.lineDiscountTotal.toString(),
    promotionDiscountTotal: totals.promotionDiscountTotal.toString(),
    invoiceDiscountTotal: totals.invoiceDiscountTotal.toString(),
    subtotal: totals.subtotal.toString(),
    taxableTotal: totals.taxableTotal.toString(),
    taxTotal: totals.taxTotal.toString(),
    grandTotal: totals.grandTotal.toString(),
  };
}

/**
 * What the invoice still owes. Shared by `serialize` and the counts/stats
 * endpoints so a row's own "remaining" and the KPI strip's total can never
 * be computed two different ways.
 */
function remainingOf(
  invoice: SalesInvoice,
  totals: SalesInvoiceTotals,
  returnedCredit: Money = Money.zero(),
): Money {
  return totals.grandTotal.add(invoice.amountPaid.negate()).add(returnedCredit.negate());
}

function serialize(
  invoice: SalesInvoice,
  totals: SalesInvoiceTotals,
  returnedCredit: Money = Money.zero(),
  withCost = true,
) {
  /**
   * `amountPaid` is now the single source of what has been collected: there is
   * one writer, `applyAllocatedSettlement`, which an allocation calls to write
   * the figure back (D1). This deliberately does NOT add the allocation on top
   * — that was correct only while the two payment paths were disjoint, and the
   * settlement write-back made them the same path. Adding both counted every
   * collection twice.
   */
  const paid = invoice.amountPaid;
  // A confirmed return credits the customer's receivable in the GL, so it has
  // to come off what the invoice still says is owed — otherwise the invoice
  // screen and the AR sub-ledger disagree with the ledger by the returned
  // amount, and a fully-returned invoice still reads as unpaid in full.
  const remaining = totals.grandTotal.add(paid.negate()).add(returnedCredit.negate());
  return {
    id: invoice.id,
    docType: invoice.docType,
    docNo: invoice.docNo,
    status: invoice.status,
    date: invoice.date,
    dueDate: invoice.dueDate,
    customerId: invoice.customerId,
    customerNameAr: invoice.customerNameAr,
    customerTaxExempt: invoice.customerTaxExempt,
    taxInclusive: invoice.taxInclusive,
    warehouseId: invoice.warehouseId,
    branchId: invoice.branchId,
    salespersonId: invoice.salespersonId,
    salespersonNameAr: invoice.salespersonNameAr,
    currency: invoice.currency,
    fxRate: invoice.fxRate ?? null,
    couponCode: invoice.couponCode,
    appliedPromotion: serializeAppliedPromotion(invoice.appliedPromotion),
    notes: invoice.notes,
    internalNotes: invoice.internalNotes,
    discount: serializeDiscount(invoice.discount),
    arAccountId: invoice.arAccountId,
    taxAccountId: invoice.taxAccountId,
    amountPaid: paid.toString(),
    returnedCredit: returnedCredit.toString(),
    remainingBalance: remaining.toString(),
    journalEntryId: invoice.journalEntryId,
    workflowRequestId: invoice.workflowRequestId,
    createdAt: invoice.createdAt,
    confirmedAt: invoice.confirmedAt,
    lines: invoice.lines.map((l) => ({
      lineId: l.lineId,
      itemId: l.itemId,
      itemNameAr: l.itemNameAr,
      isStock: l.isStock,
      qty: l.qty.toString(),
      unitCode: l.unitCode,
      unitFactor: l.unitFactor,
      baseQty: l.baseQty.toString(),
      unitPrice: l.unitPrice.toString(),
      discountType: l.discountType,
      discountPercent: l.discountPercent,
      discountAmount: l.discountAmount.toString(),
      taxRatePercent: l.taxRatePercent,
      revenueAccountId: l.revenueAccountId,
      cogsAccountId: l.cogsAccountId,
      inventoryAccountId: l.inventoryAccountId,
      // Omitted, not nulled: `sales.invoice.view_cost` is ⚠ sensitive in the
      // catalog, and a null would still tell the caller the field exists (D31).
      ...(withCost ? { unitCost: l.unitCost ? l.unitCost.toString() : null } : {}),
    })),
    totals: serializeTotals(totals),
  };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (err instanceof InvalidSalesInvoiceError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (err instanceof SalesInvoiceNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (
    err instanceof DuplicateSalesInvoiceError ||
    err instanceof InvalidSalesInvoiceTransitionError ||
    err instanceof ApprovalRequestRejectedError ||
    err instanceof DuplicateJournalEntryError
  ) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidSalesInvoicePaymentError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof CreditLimitExceededError) {
    return c.json({ error: err.code, message: err.message, customerId: err.customerId }, 422);
  }
  if (err instanceof UnbalancedEntryError) {
    return c.json(
      { error: err.code, message: err.message, totalDebit: err.totalDebit.toString(), totalCredit: err.totalCredit.toString() },
      422,
    );
  }
  if (
    err instanceof InvalidJournalEntryError ||
    err instanceof AccountNotFoundError ||
    err instanceof HeaderAccountNotPostableError ||
    err instanceof InactiveAccountError ||
    err instanceof NoFiscalPeriodForDateError ||
    err instanceof PeriodNotOpenForPostingError ||
    err instanceof NegativeStockError ||
    err instanceof UncostedDeficitIssueError ||
    err instanceof ExpiredStockError
  ) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

/**
 * Sales-invoice routes (docs/archive/catalog/01 §"فواتير المبيعات"), mounted under
 * `/sales-invoices`:
 *   POST /                     create a draft            (sales.invoice.create)
 *   GET  /                     list (status/customer/date) (sales.invoice.view)
 *   GET  /:id                  get one                   (sales.invoice.view)
 *   POST /:id/confirm          confirm → stock + GL + AR  (sales.invoice.confirm)
 *   POST /:id/cancel           cancel a draft            (sales.invoice.delete_draft)
 *   POST /:id/payments         record a collection       (sales.invoice.edit)
 */
/**
 * A gate step names a ROLE code, never a permission code. The company-admin
 * wildcard still short-circuits, but a role-gated step is otherwise satisfied
 * only by a caller who actually holds that role.
 */
const gateActorRoles = callerRoleCodes;

export function createSalesInvoicesRoutes(
  deps: SalesInvoiceRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const gateAny = createAnyPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? (() => randomUUID());

  const actorOf = (c: Context) => getAuthContext(c)?.userId ?? "system";
  /** True when the caller's only visibility grant is the own-records tier. */
  const ownVisibilityOnly = (c: Context) => {
    const ctx = getAuthContext(c);
    if (!ctx) return false;
    return !can(ctx, "sales.invoice.view") && !can(ctx, "sales.invoice.view_all");
  };
  const maySeeCost = (c: Context) => {
    const ctx = getAuthContext(c);
    return ctx ? can(ctx, "sales.invoice.view_cost") : false;
  };

  /** Confirmed-return credit per invoice; empty when the app mounts no returns module. */
  async function returnCredits(): Promise<ReadonlyMap<string, Money>> {
    if (!deps.returns) return new Map();
    return salesReturnCreditByInvoice(await deps.returns.list());
  }

  async function creditFor(invoiceId: string): Promise<Money> {
    return (await returnCredits()).get(invoiceId) ?? Money.zero();
  }

  /**
   * What treasury vouchers have allocated against each invoice, read from the
   * allocation sub-ledger — the record `allocate()` maintains. Empty when the
   * app mounts no treasury module.
   */
  async function allocatedByInvoice(ids: readonly string[]): Promise<ReadonlyMap<string, Money>> {
    const out = new Map<string, Money>();
    if (!deps.allocatable) return out;
    const rows = await Promise.all(ids.map((id) => deps.allocatable!.findById(id)));
    for (const row of rows) if (row) out.set(row.id, row.allocated);
    return out;
  }

  function service(c: Context): SalesInvoiceService {
    const svcDeps: SalesInvoiceServiceDeps = {
      repo: deps.repo,
      numbering: deps.numbering,
      gl: deps.gl,
      stock: deps.stock,
      workflow: deps.workflow,
      creditControl: deps.creditControl,
      promotions: deps.promotions,
      pricing: deps.pricing,
      taxPolicy: deps.taxPolicy,
      exchangeRates: deps.exchangeRates,
      baseCurrency: deps.baseCurrency,
      audit: deps.audit,
      events: deps.events,
      allocatable: deps.allocatable,
      now: deps.now,
      actor: getAuthContext(c)?.userId ?? "system",
    };
    return new SalesInvoiceService(svcDeps);
  }

  function totalsFor(svc: SalesInvoiceService, invoice: SalesInvoice): SalesInvoiceTotals {
    return svc.totalsOf(invoice);
  }

  app.post("/", gate("sales.invoice.create"), async (c) => {
    const parsed = createSalesInvoiceSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const d = parsed.data;
    const currencyRefusal = await deps.currencyCheck?.(d.currency);
    if (currencyRefusal) return c.json({ error: "CURRENCY_NOT_ALLOWED", message: currencyRefusal }, 422);
    const cmd: CreateSalesInvoiceCommand = {
      id: d.id ?? idGen(),
      date: d.date,
      dueDate: d.dueDate,
      customerId: d.customerId,
      customerNameAr: d.customerNameAr,
      customerTaxExempt: d.customerTaxExempt,
      warehouseId: d.warehouseId,
      branchId: d.branchId,
      salespersonId: d.salespersonId ?? null,
      salespersonNameAr: d.salespersonNameAr ?? null,
      couponCode: d.couponCode ?? null,
      currency: d.currency,
      notes: d.notes ?? null,
      internalNotes: d.internalNotes ?? null,
      discount: discountToDomain(d.discount),
      arAccountId: d.arAccountId,
      taxAccountId: d.taxAccountId,
      lines: d.lines.map((l) => ({
        lineId: l.lineId,
        itemId: l.itemId,
        itemNameAr: l.itemNameAr,
        isStock: l.isStock,
        qty: Qty.fromMajor(l.qty),
        unitCode: l.unitCode ?? null,
        unitFactor: l.unitFactor ?? null,
        unitPrice: Money.fromMajor(l.unitPrice),
        discountType: l.discountType,
        discountPercent: l.discountPercent,
        discountAmount: l.discountAmount === undefined ? undefined : Money.fromMajor(l.discountAmount),
        taxRatePercent: l.taxRatePercent,
        revenueAccountId: l.revenueAccountId,
        cogsAccountId: l.cogsAccountId ?? null,
        inventoryAccountId: l.inventoryAccountId ?? null,
      })),
    };
    const refusal = await refuseUnknownItems(c, deps.itemCheck, cmd.lines.map((l) => l.itemId));
    if (refusal) return refusal;
    const discountRefusal = await refuseUnapprovedDiscount(c, d);
    if (discountRefusal) return discountRefusal;

    const svc = service(c);
    try {
      const invoice = await svc.createDraft(cmd);
      return c.json(serialize(invoice, totalsFor(svc, invoice)), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  interface LineInput {
    readonly qty: string;
    readonly unitPrice: string;
    readonly discountType?: "percent" | "amount";
    readonly discountPercent?: number;
    readonly discountAmount?: string;
  }
  type DiscountInput = { readonly type: "percent"; readonly percent: number } | { readonly type: "amount"; readonly amount: string };

  /**
   * `sales.price.override` and `pos.discount.approve` were catalogue
   * permissions enforced NOWHERE: a user holding plain `sales.invoice.create`
   * could zero a unit price or discount a line to nothing, with no ceiling and
   * no elevated permission. That is the invoice-side twin of the credit limit,
   * and it is the shape a kickback takes.
   *
   * Two separate controls, because they are two separate acts:
   *   - a GIVEAWAY — a zero unit price, or a discount that takes the whole
   *     line — needs `sales.price.override`. It bites regardless of tenant
   *     configuration, because there is no reading under which selling for
   *     nothing is ordinary.
   *   - a discount ABOVE the tenant's ceiling needs `pos.discount.approve`.
   *     The ceiling defaults to 100, so a tenant that has never set one is
   *     refused nothing it used to be allowed.
   *
   * An admin (`"*"`) satisfies both, as it does every other permission.
   */
  async function refuseUnapprovedDiscount(
    c: Context,
    body: { readonly lines: readonly LineInput[]; readonly discount?: DiscountInput },
  ): Promise<Response | null> {
    const ctx = getAuthContext(c);
    const ceiling = (await deps.discountPolicy?.())?.maxLineDiscountPercent ?? 100;

    const giveaway = body.lines.some((line) => {
      if (Money.fromMajor(line.unitPrice).scaled === 0n) return true;
      if (line.discountType === "percent" && (line.discountPercent ?? 0) >= 100) return true;
      if (line.discountType === "amount" && line.discountAmount !== undefined) {
        // qty and price are both at scale 1e-6, so their product is 1e-12 —
        // divide once to compare against a 1e-6 discount. A `>=` guard needs no
        // rounding rule; the exact extension is the totals engine's business.
        const gross = (Qty.fromMajor(line.qty).scaled * Money.fromMajor(line.unitPrice).scaled) / 1_000_000n;
        return gross > 0n && Money.fromMajor(line.discountAmount).scaled >= gross;
      }
      return false;
    });
    if (giveaway && !(ctx && can(ctx, "sales.price.override"))) {
      return c.json(
        {
          error: "PERMISSION_DENIED",
          permission: "sales.price.override",
          message: "سعر صفري أو خصم كامل يحتاج صلاحية تعديل السعر.",
        },
        403,
      );
    }

    const overCeiling =
      body.lines.some((line) => line.discountType === "percent" && (line.discountPercent ?? 0) > ceiling) ||
      (body.discount?.type === "percent" && body.discount.percent > ceiling);
    if (overCeiling && !(ctx && can(ctx, "pos.discount.approve"))) {
      return c.json(
        {
          error: "PERMISSION_DENIED",
          permission: "pos.discount.approve",
          message: `الخصم يتجاوز الحد المسموح (${ceiling}%) ويحتاج اعتماداً.`,
        },
        403,
      );
    }
    return null;
  }

  function parseListQuery(c: Context) {
    return salesInvoiceListQuerySchema.safeParse({
      status: c.req.query("status"),
      customerId: c.req.query("customerId"),
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
      branchId: c.req.query("branchId"),
      warehouseId: c.req.query("warehouseId"),
      search: c.req.query("search"),
      page: c.req.query("page"),
      pageSize: c.req.query("pageSize"),
    });
  }

  /**
   * The single filter the rows, the chip counts and the KPI strip all go
   * through. They used to disagree: the list screen filtered by branch,
   * warehouse and free text in the browser while the totals were computed
   * over everything the server had sent, so applying a branch changed the
   * rows and left the KPIs alone.
   *
   * Every one of them now reaches SQL. The branch SCOPE — what this user may
   * see at all — comes from the resolved session and is a separate field from
   * the branch the user picked in the header, so no query parameter can widen
   * it, and an empty scope narrows to nothing rather than falling through to
   * everything.
   */
  interface FilteredInvoices {
    readonly rows: readonly SalesInvoice[];
    readonly credits: ReadonlyMap<string, Money>;
    readonly allocations: ReadonlyMap<string, Money>;
  }

  const DERIVED_FILTER_KEYS = new Set(["all", "open", "overdue"]);

  /**
   * A `view_own` caller with no resolved user id may see nothing. Filtering on
   * a sentinel is deliberate: dropping the clause would widen the list to the
   * whole tenant, which is the exact failure the tier exists to prevent.
   */
  const NO_SUCH_ACTOR = "\u0000no-actor";

  function isOpen(invoice: SalesInvoice, remaining: Money): boolean {
    return (invoice.status === "confirmed" || invoice.status === "partially_paid") && remaining.scaled > 0n;
  }

  /**
   * Everything the repository can answer in SQL, so a list is a page rather
   * than the whole table read into memory and sliced.
   *
   * BOTH scopes travel, not just the branch (R1.14): an invoice issues stock
   * from a warehouse, so a user scoped to one warehouse was still seeing every
   * other warehouse's invoices. Own-visibility travels too (D31) — a
   * `view_own` salesperson whose rows are narrowed but whose KPI strip totals
   * the whole tenant is being told the figure they may not see.
   */
  function repoFilterFor(c: Context, filter: SalesInvoiceListQueryDTO, page?: { limit: number; offset: number }) {
    const { branchId, warehouseId, search, status, ...dateFilter } = filter;
    return {
      ...dateFilter,
      // `open`/`overdue`/`all` are not stored statuses, so they must not reach
      // the repository — it would match none of them and return nothing.
      ...(status && !DERIVED_FILTER_KEYS.has(status) ? { status } : {}),
      branchScope: branchScopeOf(c),
      warehouseScope: warehouseScopeOf(c),
      branchId,
      warehouseId,
      search,
      ...(ownVisibilityOnly(c) ? { salespersonId: actorOf(c) ?? NO_SUCH_ACTOR } : {}),
      ...(page ? { limit: page.limit, offset: page.offset } : {}),
    } as Parameters<SalesInvoiceService["list"]>[0];
  }

  async function listFiltered(
    svc: SalesInvoiceService,
    c: Context,
    filter: SalesInvoiceListQueryDTO,
    page?: { limit: number; offset: number },
  ): Promise<FilteredInvoices> {
    const { status } = filter;
    // A derived status is a function of the remaining balance, which no column
    // holds — so those two chips still resolve over the filtered set and are
    // paged after the fact. Every other filter is already SQL by this point,
    // so what is loaded is the chip's own set, not the table.
    const derived = status === "open" || status === "overdue";
    let rows = await svc.list(repoFilterFor(c, filter, derived ? undefined : page));

    const credits = await returnCredits();
    const allocations = await allocatedByInvoice(rows.map((inv) => inv.id));

    if (derived) {
      const today = (deps.now?.() ?? new Date().toISOString()).slice(0, 10);
      rows = rows.filter((inv) => {
        const remaining = remainingOf(inv, totalsFor(svc, inv), credits.get(inv.id));
        if (!isOpen(inv, remaining)) return false;
        return status === "open" || (inv.dueDate !== null && inv.dueDate < today);
      });
      if (page) rows = rows.slice(page.offset, page.offset + page.limit);
    }
    return { rows, credits, allocations };
  }

  /**
   * The visibility tiers the catalog defines, enforced (D31):
   *   - `.view` / `.view_all` see every invoice
   *   - `.view_own` (which `.confirm`, `.create`, `.edit` all imply) sees only
   *     the invoices the caller is the salesperson on
   *   - `.view_cost` is what reveals unit cost; without it the field is absent,
   *     because the requirement is that costs are HIDDEN, not that the page errors
   */
  app.get("/", gateAny("sales.invoice.view", "sales.invoice.view_all", "sales.invoice.view_own"), async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const svc = service(c);
    const { page, pageSize } = parsed.data;
    const window =
      pageSize === undefined ? undefined : { limit: pageSize, offset: ((page ?? 1) - 1) * pageSize };
    const { rows: invoices, credits, allocations } = await listFiltered(svc, c, parsed.data, window);
    const costs = maySeeCost(c);
    return c.json(invoices.map((inv) => serialize(inv, totalsFor(svc, inv), credits.get(inv.id), costs)));
  });

  /**
   * The status chips. Deliberately ignores the `status` query parameter: a
   * chip has to say how many rows it WOULD show, so counting the already
   * status-filtered set would render every chip but the active one as zero.
   * Every other filter still applies.
   */
  app.get("/counts", gateAny("sales.invoice.view", "sales.invoice.view_all", "sales.invoice.view_own"), async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const svc = service(c);
    const { status: _ignored, ...withoutStatus } = parsed.data;
    const { rows: invoices, credits, allocations } = await listFiltered(svc, c, withoutStatus);
    const today = (deps.now?.() ?? new Date().toISOString()).slice(0, 10);

    const counts: Record<string, number> = {
      all: invoices.length,
      draft: 0,
      confirmed: 0,
      partially_paid: 0,
      paid: 0,
      cancelled: 0,
      open: 0,
      overdue: 0,
    };
    for (const invoice of invoices) {
      counts[invoice.status] = (counts[invoice.status] ?? 0) + 1;
      const remaining = remainingOf(invoice, totalsFor(svc, invoice), credits.get(invoice.id));
      const unsettled = isOpen(invoice, remaining);
      if (unsettled) counts.open! += 1;
      if (unsettled && invoice.dueDate !== null && invoice.dueDate < today) counts.overdue! += 1;
    }
    return c.json(counts);
  });

  /**
   * The KPI strip. Money is summed here, in `Money`, over the whole filtered
   * set — the screens used to add JS numbers across the rows they happened to
   * hold, which both drifted and ignored the filters the user had applied.
   * Drafts and cancelled invoices are excluded: neither is a receivable.
   */
  app.get("/stats", gateAny("sales.invoice.view", "sales.invoice.view_all", "sales.invoice.view_own"), async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const svc = service(c);
    const { rows: invoices, credits, allocations } = await listFiltered(svc, c, parsed.data);

    let sales = Money.zero();
    let collected = Money.zero();
    let returned = Money.zero();
    let remaining = Money.zero();
    let count = 0;
    for (const invoice of invoices) {
      if (invoice.status === "draft" || invoice.status === "cancelled") continue;
      const totals = totalsFor(svc, invoice);
      const credit = credits.get(invoice.id) ?? Money.zero();
      count += 1;
      sales = sales.add(totals.grandTotal);
      collected = collected.add(invoice.amountPaid);
      returned = returned.add(credit);
      remaining = remaining.add(remainingOf(invoice, totals, credit));
    }
    return c.json({
      count,
      sales: sales.toString(),
      collected: collected.toString(),
      returned: returned.toString(),
      remaining: remaining.toString(),
    });
  });

  app.get("/:id", gateAny("sales.invoice.view", "sales.invoice.view_all", "sales.invoice.view_own"), async (c) => {
    const svc = service(c);
    // By id OR by document number: a deep link carries the number, and now
    // that the list is a page the screen can no longer resolve one from the
    // rows it happens to hold.
    const invoice = await svc.findByIdOrDocNo(c.req.param("id"));
    if (!invoice) return c.json({ error: "NOT_FOUND" }, 404);
    // A `view_own` holder gets 404, not 403: whether an invoice they may not
    // see exists at all is itself information.
    if (ownVisibilityOnly(c) && invoice.salespersonId !== actorOf(c)) {
      return c.json({ error: "NOT_FOUND" }, 404);
    }
    return c.json(serialize(invoice, totalsFor(svc, invoice), await creditFor(invoice.id), maySeeCost(c)));
  });

  app.post("/:id/confirm", gate("sales.invoice.confirm"), async (c) => {
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const parsed = confirmSalesInvoiceSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const svc = service(c);
    const ctx = getAuthContext(c);
    try {
      const result = await svc.confirm(c.req.param("id"), {
        requestId: parsed.data.requestId,
        actor: ctx?.userId,
        actorRoles: gateActorRoles(c),
      });
      return c.json({
        ...serialize(result.invoice, totalsFor(svc, result.invoice), await creditFor(result.invoice.id)),
        held: result.held,
        creditWarning: serializeCreditWarning(result.creditWarning),
        // Lines charged under the customer's own price list (D35). Empty when
        // no list applies, so a tenant that prices freely sees nothing new.
        pricingVariances: result.pricingVariances.map((v) => ({
          lineId: v.lineId,
          itemId: v.itemId,
          listPrice: v.listPrice.toString(),
          chargedPrice: v.chargedPrice.toString(),
        })),
      });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/cancel", gate("sales.invoice.delete_draft"), async (c) => {
    const svc = service(c);
    try {
      const invoice = await svc.cancel(c.req.param("id"));
      return c.json(serialize(invoice, totalsFor(svc, invoice)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * تحصيل من عميل. Collecting against an invoice creates and confirms a REAL
   * collection voucher and allocates it to the invoice — money in, AR credited,
   * `amountPaid` written back by the allocation. It used to increment
   * `amountPaid` and post nothing, so the invoice and the ledger disagreed
   * about the same payment forever (D1).
   */
  app.post("/:id/payments", gate("sales.invoice.edit"), async (c) => {
    const parsed = salesInvoicePaymentSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    if (!deps.collect) {
      return c.json(
        { error: "COLLECTION_UNAVAILABLE", message: "التحصيل يتطلب سند قبض؛ وحدة الخزينة غير مفعّلة." },
        503,
      );
    }
    const svc = service(c);
    const amount = Money.fromMajor(parsed.data.amount);
    try {
      const invoice = await svc.assertCollectable(c.req.param("id"), amount);
      const { voucherId } = await deps.collect({
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        branchId: invoice.branchId,
        amount,
        treasuryAccountId: parsed.data.treasuryAccountId,
        paymentMethod: parsed.data.paymentMethod ?? "cash",
        date: parsed.data.date ?? invoice.date,
        referenceNo: parsed.data.referenceNo ?? null,
        memo: parsed.data.notes ?? `تحصيل على الفاتورة ${invoice.docNo ?? invoice.id}`,
        actor: getAuthContext(c)?.userId,
      });
      // Re-read: the allocation wrote amountPaid back through the settlement port.
      const settled = (await svc.findById(invoice.id)) ?? invoice;
      return c.json({
        ...serialize(settled, totalsFor(svc, settled), await creditFor(settled.id), maySeeCost(c)),
        voucherId,
      });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
