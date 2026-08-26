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
  NegativeStockError,
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
} from "@mezan/domain";
import {
  createSalesInvoiceSchema,
  confirmSalesInvoiceSchema,
  salesInvoicePaymentSchema,
  salesInvoiceListQuerySchema,
  type SalesInvoiceListQueryDTO,
  type SalesInvoiceDiscountDTO,
} from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  headerAuthContextResolver,
  type AuthContextResolver,
  branchScopeOf,
  warehouseScopeOf,
  withinScope,} from "./permission-gate.js";

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
  /** Credit control on confirm (docs/catalog/01/09 §"الرقابة الائتمانية"); omit for no check at all. */
  readonly creditControl?: SalesInvoiceCreditControlDeps;
  /** Evaluates promotions on confirm (docs/catalog/01 §"العروض"); omit and no invoice records one. */
  readonly promotions?: SalesInvoicePromotionHook;
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
  allocated: Money = Money.zero(),
): Money {
  return totals.grandTotal.add(invoice.amountPaid.add(allocated).negate()).add(returnedCredit.negate());
}

function serialize(
  invoice: SalesInvoice,
  totals: SalesInvoiceTotals,
  returnedCredit: Money = Money.zero(),
  allocated: Money = Money.zero(),
) {
  /**
   * Two payment paths exist and neither knew about the other: `POST
   * /:id/payments` moves the invoice's own `amountPaid` counter, while a
   * treasury voucher records an allocation in the sub-ledger and leaves the
   * counter alone (D1). Reading only the counter meant a collected invoice
   * still read as unpaid in full.
   *
   * Adding them is exact today because the two paths are disjoint: the direct
   * route never writes an allocation and the voucher never writes the counter.
   */
  const paid = invoice.amountPaid.add(allocated);
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
    warehouseId: invoice.warehouseId,
    branchId: invoice.branchId,
    salespersonId: invoice.salespersonId,
    salespersonNameAr: invoice.salespersonNameAr,
    currency: invoice.currency,
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
      unitPrice: l.unitPrice.toString(),
      discountPercent: l.discountPercent,
      taxRatePercent: l.taxRatePercent,
      revenueAccountId: l.revenueAccountId,
      cogsAccountId: l.cogsAccountId,
      inventoryAccountId: l.inventoryAccountId,
      unitCost: l.unitCost ? l.unitCost.toString() : null,
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
    err instanceof NegativeStockError
  ) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

/**
 * Sales-invoice routes (docs/catalog/01 §"فواتير المبيعات"), mounted under
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
function gateActorRoles(c: Context): string[] {
  const permissions = (c.req.header("x-permissions") ?? "").split(",").map((s) => s.trim());
  if (permissions.includes("*")) return ["*"];
  return (c.req.header("x-role-codes") ?? c.req.header("x-role-code") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function createSalesInvoicesRoutes(
  deps: SalesInvoiceRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? (() => randomUUID());

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
        unitPrice: Money.fromMajor(l.unitPrice),
        discountPercent: l.discountPercent,
        taxRatePercent: l.taxRatePercent,
        revenueAccountId: l.revenueAccountId,
        cogsAccountId: l.cogsAccountId ?? null,
        inventoryAccountId: l.inventoryAccountId ?? null,
      })),
    };
    const svc = service(c);
    try {
      const invoice = await svc.createDraft(cmd);
      return c.json(serialize(invoice, totalsFor(svc, invoice)), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  function parseListQuery(c: Context) {
    return salesInvoiceListQuerySchema.safeParse({
      status: c.req.query("status"),
      customerId: c.req.query("customerId"),
      fromDate: c.req.query("fromDate"),
      toDate: c.req.query("toDate"),
      branchId: c.req.query("branchId"),
      warehouseId: c.req.query("warehouseId"),
      search: c.req.query("search"),
    });
  }

  /**
   * The single filter the rows, the chip counts and the KPI strip all go
   * through. They used to disagree: the list screen filtered by branch,
   * warehouse and free text in the browser while the totals were computed
   * over everything the server had sent, so applying a branch changed the
   * rows and left the KPIs alone.
   *
   * `branchId`/`warehouseId`/`search` are narrowed here rather than in the
   * repository because they are presentation filters over an already-scoped
   * set — the branch SCOPE (what this user may see at all) is still enforced
   * by `withinScope` below, and no query parameter can widen it.
   */
  interface FilteredInvoices {
    readonly rows: readonly SalesInvoice[];
    readonly credits: ReadonlyMap<string, Money>;
    readonly allocations: ReadonlyMap<string, Money>;
  }

  const DERIVED_FILTER_KEYS = new Set(["all", "open", "overdue"]);

  function isOpen(invoice: SalesInvoice, remaining: Money): boolean {
    return (invoice.status === "confirmed" || invoice.status === "partially_paid") && remaining.scaled > 0n;
  }

  async function listFiltered(
    svc: SalesInvoiceService,
    c: Context,
    filter: SalesInvoiceListQueryDTO,
  ): Promise<FilteredInvoices> {
    const { branchId, warehouseId, search, status, ...dateFilter } = filter;
    // `open`/`overdue`/`all` are not stored statuses, so they must not reach
    // the repository — it would match none of them and return nothing.
    const repoFilter = status && !DERIVED_FILTER_KEYS.has(status) ? { ...dateFilter, status } : dateFilter;
    /**
     * BOTH scopes, not just the branch (R1.14). An invoice issues stock from a
     * warehouse, so a user scoped to one warehouse was still seeing every
     * other warehouse's invoices — the header selector relabelled the chrome
     * and changed nothing on screen.
     */
    let rows = withinScope(
      withinScope(
        await svc.list(repoFilter as Parameters<SalesInvoiceService["list"]>[0]),
        branchScopeOf(c),
        (inv) => inv.branchId,
      ),
      warehouseScopeOf(c),
      (inv) => inv.warehouseId,
    );
    if (branchId) rows = rows.filter((inv) => inv.branchId === branchId);
    if (warehouseId) rows = rows.filter((inv) => inv.warehouseId === warehouseId);
    const term = search?.trim().toLowerCase();
    if (term) {
      rows = rows.filter(
        (inv) =>
          (inv.docNo ?? "").toLowerCase().includes(term) || (inv.customerNameAr ?? "").toLowerCase().includes(term),
      );
    }

    const credits = await returnCredits();
    const allocations = await allocatedByInvoice(rows.map((inv) => inv.id));

    if (status === "open" || status === "overdue") {
      const today = (deps.now?.() ?? new Date().toISOString()).slice(0, 10);
      rows = rows.filter((inv) => {
        const remaining = remainingOf(inv, totalsFor(svc, inv), credits.get(inv.id), allocations.get(inv.id));
        if (!isOpen(inv, remaining)) return false;
        return status === "open" || (inv.dueDate !== null && inv.dueDate < today);
      });
    }
    return { rows, credits, allocations };
  }

  app.get("/", gate("sales.invoice.view"), async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const svc = service(c);
    const { rows: invoices, credits, allocations } = await listFiltered(svc, c, parsed.data);
    return c.json(invoices.map((inv) => serialize(inv, totalsFor(svc, inv), credits.get(inv.id), allocations.get(inv.id))));
  });

  /**
   * The status chips. Deliberately ignores the `status` query parameter: a
   * chip has to say how many rows it WOULD show, so counting the already
   * status-filtered set would render every chip but the active one as zero.
   * Every other filter still applies.
   */
  app.get("/counts", gate("sales.invoice.view"), async (c) => {
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
      const remaining = remainingOf(invoice, totalsFor(svc, invoice), credits.get(invoice.id), allocations.get(invoice.id));
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
  app.get("/stats", gate("sales.invoice.view"), async (c) => {
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
      const allocated = allocations.get(invoice.id) ?? Money.zero();
      count += 1;
      sales = sales.add(totals.grandTotal);
      collected = collected.add(invoice.amountPaid).add(allocated);
      returned = returned.add(credit);
      remaining = remaining.add(remainingOf(invoice, totals, credit, allocated));
    }
    return c.json({
      count,
      sales: sales.toString(),
      collected: collected.toString(),
      returned: returned.toString(),
      remaining: remaining.toString(),
    });
  });

  app.get("/:id", gate("sales.invoice.view"), async (c) => {
    const svc = service(c);
    const invoice = await svc.findById(c.req.param("id"));
    if (!invoice) return c.json({ error: "NOT_FOUND" }, 404);
    const allocated = (await allocatedByInvoice([invoice.id])).get(invoice.id);
    return c.json(serialize(invoice, totalsFor(svc, invoice), await creditFor(invoice.id), allocated));
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

  app.post("/:id/payments", gate("sales.invoice.edit"), async (c) => {
    const parsed = salesInvoicePaymentSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const svc = service(c);
    try {
      const invoice = await svc.recordPayment(c.req.param("id"), Money.fromMajor(parsed.data.amount));
      const allocated = (await allocatedByInvoice([invoice.id])).get(invoice.id);
    return c.json(serialize(invoice, totalsFor(svc, invoice), await creditFor(invoice.id), allocated));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
