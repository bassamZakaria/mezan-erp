import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  type AllocatableInvoiceRepository,
  ApprovalRequestRejectedError,
  QuotaKind,
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
  JournalEntryNotFoundError,
  JournalEntryNotPostedError,
  JournalEntryAlreadyReversedError,
  assertSalesInvoiceTransition,
  isSalesInvoiceTerminal,
  salesInvoiceBaseGrandTotal,
  type DocumentStockHook,
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
  type ContractBillingRoutingPort,
  type SalesInvoiceTaxPolicy,
  type UserRepository,
  EtaReceiptedSaleVoidRefusedError,
  type EtaReceiptPaymentMethod,
} from "@mezan/domain";
import {
  createSalesInvoiceSchema,
  confirmSalesInvoiceSchema,
  salesInvoicePaymentSchema,
  salesInvoiceListQuerySchema,
  salesInvoiceSchema,
  type SalesInvoiceListQueryDTO,
  type SalesInvoiceDiscountDTO,
} from "@mezan/contracts";
import type { CurrencyCheck } from "./currency-policy.js";
import { recordAdminEvent } from "./admin-audit.js";
import { refuseUnknownItems, type ItemCatalogCheck } from "./item-check.js";
import { MasterDataKind, refuseUnknownMasterData, type MasterDataChecks } from "./master-data-check.js";
import { type AuthContextResolver, branchScopeOf, callerRoleCodes, createAnyPermissionGate, createPermissionGate, getAuthContext, moduleRefusalFor, warehouseScopeOf } from "./permission-gate.js";
import { documentBranches, storedBranchesById, warehousesOfBranchScope } from "./stored-branches.js";
import { tenantDay, tenantToday } from "./tenant-day.js";
import { withQuota, quotaRefusalResponse, type QuotaEnforcement } from "./plan-quota.js";
import {
  documentVersionOf,
  documentVersionsOf,
  expectedVersionOf,
  refuseStaleDocument,
  stampDocumentModifier,
  type DocumentVersionGuard,
} from "./document-version.js";
import { duplicateIdRefusal, refuseTakenId } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";

/**
 * External dependencies the sales-invoice routes bind the domain service to.
 * The GL / stock / numbering / workflow hooks are the SAME ports the document
 * framework defines; assemble them at the composition root with
 * `createSalesInvoiceGlHook` / `createSalesInvoiceStockHook`.
 */
export interface SalesInvoiceRoutesDeps {
  readonly repo: SalesInvoiceRepository;
  /**
   * The plan's monthly invoice quota (DEC-31 rule 6). Applies to `POST /` only:
   * a return, a void, a collection, an e-receipt and every read stay open at
   * the limit, because none of them goes through it.
   */
  readonly quota?: QuotaEnforcement;
  /**
   * N-9 — optimistic concurrency. Omit it and the routes behave exactly as
   * before; supply it and a caller holding a stale `expectedVersion` is refused
   * instead of silently overwriting the till that got there first.
   */
  readonly versionGuard?: DocumentVersionGuard;
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
  /** Refuses an invoice naming a customer, warehouse, branch or cost centre no master record holds (D310). */
  readonly masterData?: MasterDataChecks;
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
   * The tenant's real chart of accounts, so an invoice cannot name a GL
   * account the tenant does not have (D108).
   *
   * The browser fills any unmapped item's accounts from constants — 1105 /
   * 2200 / 4100 / 5100 / 1200, the ids the seed template happens to use — and
   * nothing checked them. On a tenant whose chart differs, the invoice posted
   * to whatever those codes meant there, or to an account that did not exist.
   * Omit the port and the check is skipped, the way every other cross-aggregate
   * check here degrades rather than refusing to mount.
   */
  readonly accounts?: { findById(id: string): Promise<{ readonly isHeader: boolean; readonly status: string } | null> };
  /**
   * Exchange rates, so a foreign-currency invoice posts its base value at the
   * approved rate of its own date and tags the receivable line for revaluation
   * (D24). Omit and a non-base currency is refused rather than posted 1:1.
   */
  readonly exchangeRates?: { findRate(currency: string, asOfDate: string): Promise<{ rate: string } | null> };
  /** The tenant's base currency; defaults to EGP. */
  readonly baseCurrency?: string;
  /**
   * Contracting's billing re-route: an ordinary invoice on a project running a
   * live cost_to_cost works contract credits 2165, not revenue, so the monthly
   * EAS 48 run stays the only thing that recognises. Omit and nothing moves.
   */
  readonly contractBilling?: ContractBillingRoutingPort;
  /**
   * الإيصال الإلكتروني — issues a consumer sale's e-receipt as part of the
   * confirm, so the response carries the number, UUID and QR the paper needs
   * (D283). Resolves null for a B2B sale; its refusals (no registered device)
   * never undo a confirm that has already posted.
   */
  readonly issueEtaReceipt?: (
    invoiceId: string,
    options: { readonly paymentMethod?: EtaReceiptPaymentMethod },
  ) => Promise<{ receiptNo: string; uuid: string; qrValue: string } | null>;
  /** Whether the invoice has an e-receipt; a receipted sale is refused a void. */
  readonly hasEtaReceipt?: (invoiceId: string) => Promise<boolean>;
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
  /**
   * What `amount` of base money dated `date` would relieve a foreign invoice
   * of at its booked rate, and the most it can still take at that date's rate
   * (D221). A collection is capped on this rather than on the base remainder:
   * USD 100 booked at 48.00 is settled in full by EGP 5,000 at 50.00.
   */
  readonly settlementPreview?: (invoiceId: string, amount: Money, date: string) => Promise<{ relief: Money; capacity: Money }>;
  /**
   * Puts the issued stock back when a confirmed invoice is voided. Bind it with
   * `createInventoryStockHook(stockLedger)` — the same adapter the returns and
   * transfer documents use. Without it a void that would move stock answers 503
   * rather than reversing the GL and leaving the warehouse permanently short.
   */
  readonly stockRestore?: DocumentStockHook;
  readonly audit?: AuditSink;
  readonly allocatable?: AllocatableInvoiceRepository;
  /**
   * Confirmed sales returns, so an invoice's remaining balance nets off what
   * has been returned against it — the GL credits AR on every confirmed return
   * while the invoice went on reporting its full total as outstanding.
   */
  readonly returns?: {
    list(): Promise<readonly SalesReturnDocument[]>;
    /** The confirmed returns citing these invoices, in one query — see `DocumentRepository.listByLineRef`. */
    listByLineRef?(
      field: "sourceInvoiceId",
      ids: readonly string[],
      filter?: { status?: "confirmed" },
    ): Promise<readonly SalesReturnDocument[]>;
  };
  /**
   * Resolves the caller's linked `Employee.id`. `view_own` narrows on
   * `salespersonId`, which holds an employee id, not a user id — without this
   * port the two id spaces are compared directly and a real rep matches
   * nothing (D147). Omit it and a `view_own` caller is shown no invoices at
   * all rather than the whole tenant.
   */
  readonly users?: Pick<UserRepository, "findById">;
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
 * What the invoice still owes, in BASE currency: the base grand total less the
 * base settlement and the base return credit (D202). Shared by `serialize` and
 * the counts/stats endpoints so a row's own "remaining" and the KPI strip's
 * total can never be computed two different ways.
 *
 * A cancelled or reversed invoice owes NOTHING — a void reverses the AR
 * posting, so an invoice that went on reporting a remaining balance would put
 * the invoice screen at odds with the receivable the ledger actually carries.
 */
function remainingOf(
  invoice: SalesInvoice,
  totals: SalesInvoiceTotals,
  returnedCredit: Money = Money.zero(),
): Money {
  if (isSalesInvoiceTerminal(invoice.status)) return Money.zero();
  return salesInvoiceBaseGrandTotal(totals, invoice.fxRate).add(invoice.amountPaid.negate()).add(returnedCredit.negate());
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
  const remaining = remainingOf(invoice, totals, returnedCredit);
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
    projectId: invoice.projectId,
    currency: invoice.currency,
    fxRate: invoice.fxRate ?? null,
    couponCode: invoice.couponCode,
    appliedPromotion: serializeAppliedPromotion(invoice.appliedPromotion),
    notes: invoice.notes,
    internalNotes: invoice.internalNotes,
    discount: serializeDiscount(invoice.discount),
    arAccountId: invoice.arAccountId,
    taxAccountId: invoice.taxAccountId,
    baseGrandTotal: salesInvoiceBaseGrandTotal(totals, invoice.fxRate).toString(),
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
      costCenterId: l.costCenterId ?? null,
      // Omitted, not nulled: `sales.invoice.view_cost` is ⚠ sensitive in the
      // catalog, and a null would still tell the caller the field exists (D31).
      ...(withCost ? { unitCost: l.unitCost ? l.unitCost.toString() : null } : {}),
    })),
    totals: serializeTotals(totals),
  };
}

function withMessageEn(err: { code: string; message: string }) {
  const messageEn = (err as { messageEn?: string }).messageEn;
  return { error: err.code, message: err.message, ...(messageEn ? { messageEn } : {}) };
}

function handleDomainError(c: Context, err: unknown): Response {
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  if (err instanceof InvalidSalesInvoiceError) {
    return c.json({ ...withMessageEn(err), reasons: err.reasons }, 422);
  }
  if (err instanceof SalesInvoiceNotFoundError || err instanceof JournalEntryNotFoundError) {
    return c.json(withMessageEn(err), 404);
  }
  if (
    err instanceof DuplicateSalesInvoiceError ||
    err instanceof InvalidSalesInvoiceTransitionError ||
    err instanceof ApprovalRequestRejectedError ||
    err instanceof DuplicateJournalEntryError ||
    err instanceof JournalEntryAlreadyReversedError ||
    err instanceof JournalEntryNotPostedError
  ) {
    return c.json(withMessageEn(err), 409);
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
 *   POST /:id/void             void a confirmed invoice  (sales.invoice.void)
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
  const storedBranches = storedBranchesById(
    async (id) => (await deps.repo.findById(id)) ?? (await deps.repo.findByDocNo(id)),
    (invoice, c) => documentBranches(c, [invoice.branchId], [invoice.warehouseId]),
  );
  const gate = createPermissionGate(resolveAuthContext, { storedBranches });
  const gateAny = createAnyPermissionGate(resolveAuthContext, { storedBranches });
  const idGen = deps.idGen ?? (() => randomUUID());

  /**
   * A `view_own` caller whose employee link cannot be resolved sees nothing.
   * Filtering on a sentinel is deliberate: dropping the clause would widen the
   * list to the whole tenant, which is the exact failure the tier exists to
   * prevent.
   */
  const NO_SUCH_ACTOR = "\u0000no-actor";

  const actorOf = (c: Context) => getAuthContext(c)?.userId ?? "system";
  /**
   * The employee id `view_own` narrows on. `actorOf` is a USER id and must
   * never be used here: the salesperson picker stores an `Employee.id`, so
   * comparing the two matches nothing (D147).
   */
  const ownSalespersonIdOf = async (c: Context): Promise<string> => {
    const ctx = getAuthContext(c);
    if (!ctx || !deps.users) return NO_SUCH_ACTOR;
    const user = await deps.users.findById(ctx.userId);
    return user?.employeeId ?? NO_SUCH_ACTOR;
  };
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

  /**
   * Confirmed-return credit for JUST these invoices; empty when the app mounts
   * no returns module. Scoped by id deliberately (Q-5): the whole return
   * history was being read to decorate a page of twenty-five rows, and again
   * on every `GET /:id`.
   */
  async function returnCredits(ids: readonly string[]): Promise<ReadonlyMap<string, Money>> {
    if (!deps.returns || ids.length === 0) return new Map();
    const docs = deps.returns.listByLineRef
      ? await deps.returns.listByLineRef("sourceInvoiceId", ids, { status: "confirmed" })
      : await deps.returns.list();
    // A matched document may still carry a line citing an invoice outside the
    // page, so the map is narrowed either way and the two paths agree exactly.
    const wanted = new Set(ids);
    return new Map([...salesReturnCreditByInvoice(docs)].filter(([id]) => wanted.has(id)));
  }

  async function creditFor(invoiceId: string): Promise<Money> {
    return (await returnCredits([invoiceId])).get(invoiceId) ?? Money.zero();
  }

  /**
   * What treasury vouchers have allocated against each invoice, read from the
   * allocation sub-ledger — the record `allocate()` maintains. Empty when the
   * app mounts no treasury module.
   */
  async function allocatedByInvoice(ids: readonly string[]): Promise<ReadonlyMap<string, Money>> {
    if (!deps.allocatable || ids.length === 0) return new Map<string, Money>();
    // One chunked `IN (...)`, not an awaited findById per row (Q-5).
    return deps.allocatable.allocatedByIds(ids);
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
      contractBilling: deps.contractBilling,
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

  /**
   * Every GL account an invoice names, checked against the tenant's own chart.
   *
   * A header account is refused too: posting to a رئيسي account is what the
   * account tree exists to prevent, and a caller that names one is as wrong as
   * one naming an id that does not exist.
   */
  async function refuseUnknownAccounts(
    c: Context,
    ids: readonly (string | null | undefined)[],
  ): Promise<Response | null> {
    if (!deps.accounts) return null;
    const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))];
    const bad: string[] = [];
    for (const id of unique) {
      const account = await deps.accounts.findById(id);
      if (!account || account.isHeader || account.status !== "active") bad.push(id);
    }
    if (bad.length === 0) return null;
    return c.json(
      {
        error: "GL_ACCOUNT_NOT_POSTABLE",
        accounts: bad,
        message: `حساب دفتري غير صالح للترحيل: ${bad.join("، ")}. راجع دليل الحسابات أو ربط الأصناف بحساباتها.`,
      },
      422,
    );
  }

  app.post("/", gate("sales.invoice.create"), async (c) => {
    const parsed = createSalesInvoiceSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const takenId = await refuseTakenId(c, parsed.data.id, (id) => service(c).findById(id));
    if (takenId) return takenId;
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
      projectId: d.projectId ?? null,
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
        costCenterId: l.costCenterId ?? null,
      })),
    };
    const refusal = await refuseUnknownItems(c, deps.itemCheck, cmd.lines.map((l) => l.itemId));
    if (refusal) return refusal;
    const accountRefusal = await refuseUnknownAccounts(c, [
      cmd.arAccountId,
      cmd.taxAccountId,
      ...cmd.lines.flatMap((l) => [l.revenueAccountId, l.cogsAccountId, l.inventoryAccountId]),
    ]);
    if (accountRefusal) return accountRefusal;
    const partyRefusal = await refuseUnknownMasterData(c, deps.masterData, [
      { kind: MasterDataKind.Customer, ids: [cmd.customerId] },
      { kind: MasterDataKind.Warehouse, ids: [cmd.warehouseId] },
      { kind: MasterDataKind.Branch, ids: [cmd.branchId] },
      { kind: MasterDataKind.CostCenter, ids: cmd.lines.map((l) => l.costCenterId) },
    ]);
    if (partyRefusal) return partyRefusal;
    const discountRefusal = await refuseUnapprovedDiscount(c, d);
    if (discountRefusal) return discountRefusal;

    const svc = service(c);
    try {
      const { refusal, value } = await withQuota(
        c,
        deps.quota,
        QuotaKind.SalesInvoicesPerMonth,
        () => svc.createDraft(cmd),
      );
      if (refusal) return quotaRefusalResponse(c, refusal);
      const invoice = value!;
      return c.json(salesInvoiceSchema.parse(serialize(invoice, totalsFor(svc, invoice))), 201);
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
   * `sales.price.override` and `sales.discount.approve` were catalogue
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
   *   - a discount ABOVE the tenant's ceiling needs `sales.discount.approve`.
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
    if (giveaway) {
      const moduleRefused = moduleRefusalFor(c, "sales.price.override");
      if (moduleRefused) return moduleRefused;
      if (!(ctx && can(ctx, "sales.price.override"))) {
        return c.json(
          {
            error: "PERMISSION_DENIED",
            permission: "sales.price.override",
            message: "سعر صفري أو خصم كامل يحتاج صلاحية تعديل السعر.",
          },
          403,
        );
      }
    }

    /**
     * The ceiling is a PERCENTAGE, so an amount discount is converted to the
     * percentage of the line it actually represents before it is compared —
     * typing the same 96% giveaway as «مبلغ» rather than «نسبة» used to walk
     * past the ceiling and past `sales.discount.approve` entirely (D87).
     *
     * All bigint: `ceiling` becomes a 1e-6 scalar the same way money does, and
     * `discount/gross > ceiling/100` is cross-multiplied rather than divided,
     * so no rounding rule and no float ever enters the comparison.
     */
    const ceilingScaled = Money.fromMajor(String(ceiling)).scaled;
    const aboveCeiling = (grossScaled: bigint, discountScaled: bigint) =>
      grossScaled > 0n && discountScaled * 100n * 1_000_000n > grossScaled * ceilingScaled;
    const lineGross = (line: LineInput) =>
      (Qty.fromMajor(line.qty).scaled * Money.fromMajor(line.unitPrice).scaled) / 1_000_000n;

    const overCeiling =
      // D87: an AMOUNT discount is measured against the line gross. Checking
      // only `percent` let a 90%-of-line amount discount through with no
      // approval at all, which is how a kickback gets priced.
      body.lines.some((line) => {
        if (line.discountType === "percent") return (line.discountPercent ?? 0) > ceiling;
        if (line.discountType === "amount" && line.discountAmount !== undefined) {
          return aboveCeiling(lineGross(line), Money.fromMajor(line.discountAmount).scaled);
        }
        return false;
      }) ||
      (body.discount?.type === "percent"
        ? body.discount.percent > ceiling
        : body.discount?.type === "amount"
          ? aboveCeiling(
              body.lines.reduce((sum, line) => sum + lineGross(line), 0n),
              Money.fromMajor(body.discount.amount).scaled,
            )
          : false);
    if (overCeiling) {
      /*
       * NO module refusal here, deliberately: this guards the discount ceiling
       * on a SALES invoice and must stay reachable on every tenant.
       *
       * The code was `pos.discount.approve` until the rename. It named a till
       * it never guarded, and `pos` is excluded from `MODULE_CATALOG` (no
       * domain, routes or persistence), so `licensedPermissions()` filtered it
       * out of the role editor — an enforced control nobody could be granted.
       * The old code is still honoured so grants written before the rename
       * keep working; it is out of the catalogue, so nothing new is granted
       * under it. The refusal names the NEW code, because that is the one an
       * administrator can actually tick.
       */
      if (!(ctx && (can(ctx, "sales.discount.approve") || can(ctx, "pos.discount.approve")))) {
        return c.json(
          {
            error: "PERMISSION_DENIED",
            permission: "sales.discount.approve",
            message: `الخصم يتجاوز الحد المسموح (${ceiling}%) ويحتاج اعتماداً.`,
          },
          403,
        );
      }
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
      sort: c.req.query("sort"),
      sortDir: c.req.query("sortDir"),
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

  /** The only two stored statuses an unpaid balance can sit under. */
  const UNSETTLED_STATUSES = ["confirmed", "partially_paid"] as const satisfies readonly SalesInvoice["status"][];

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
  async function repoFilterFor(c: Context, filter: SalesInvoiceListQueryDTO, page?: { limit: number; offset: number }) {
    const { branchId, warehouseId, search, status, sort, sortDir, page: _page, pageSize: _pageSize, ...dateFilter } = filter;
    return {
      ...dateFilter,
      ...(sort ? { sort: { key: sort, direction: sortDir ?? "asc" } } : {}),
      // `open`/`overdue`/`all` are not stored statuses, so they must not reach
      // the repository — it would match none of them and return nothing.
      ...(status && !DERIVED_FILTER_KEYS.has(status) ? { status } : {}),
      // …but only a confirmed or partially-paid invoice can BE open or
      // overdue, so those two chips narrow in SQL to the open receivable
      // instead of hydrating every draft, paid and cancelled row to discard it.
      ...(status === "open" || status === "overdue" ? { statusIn: UNSETTLED_STATUSES } : {}),
      branchScope: branchScopeOf(c),
      branchScopeWarehouses: await warehousesOfBranchScope(c),
      warehouseScope: warehouseScopeOf(c),
      branchId,
      warehouseId,
      search,
      ...(ownVisibilityOnly(c) ? { salespersonId: await ownSalespersonIdOf(c) } : {}),
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
    let rows = await svc.list(await repoFilterFor(c, filter, derived ? undefined : page));

    const credits = await returnCredits(rows.map((inv) => inv.id));
    const allocations = await allocatedByInvoice(rows.map((inv) => inv.id));

    if (derived) {
      const today = (await tenantDay(c, deps.now?.() ?? new Date().toISOString()));
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
    // Both carry a contract default, so the unbounded branch is gone:
    // an omitted page can no longer mean the whole table (Q-8).
    const { page, pageSize } = parsed.data;
    const window = { limit: pageSize, offset: (page - 1) * pageSize };
    const { rows: invoices, credits, allocations } = await listFiltered(svc, c, parsed.data, window);
    const costs = maySeeCost(c);
    // N-9: the row's own confirm acts from this payload, so the version has to
    // ride on the row or `expectedVersion` is never sent and the guard no-ops.
    const versions = await documentVersionsOf(deps.versionGuard, invoices.map((inv) => inv.id));
    return c.json(
      invoices.map((inv) => ({
        ...serialize(inv, totalsFor(svc, inv), credits.get(inv.id), costs),
        version: versions.get(inv.id),
      })),
    );
  });

  /**
   * The status chips. Deliberately ignores the `status` query parameter: a
   * chip has to say how many rows it WOULD show, so counting the already
   * status-filtered set would render every chip but the active one as zero.
   * Every other filter still applies.
   *
   * The stored statuses are one `GROUP BY`; only `open`/`overdue` need rows,
   * and only the two statuses an unpaid balance can sit under, because the
   * remaining balance is a function of the lines and no column holds it (Q-5).
   */
  app.get("/counts", gateAny("sales.invoice.view", "sales.invoice.view_all", "sales.invoice.view_own"), async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const svc = service(c);
    const { status: _ignored, ...withoutStatus } = parsed.data;
    const byStatus = await svc.countByStatus(await repoFilterFor(c, withoutStatus));
    const today = (await tenantDay(c, deps.now?.() ?? new Date().toISOString()));

    let all = 0;
    const counts: Record<string, number> = {
      all: 0,
      draft: 0,
      confirmed: 0,
      partially_paid: 0,
      paid: 0,
      cancelled: 0,
      reversed: 0,
      open: 0,
      overdue: 0,
    };
    for (const [status, n] of byStatus) {
      counts[status] = (counts[status] ?? 0) + n;
      all += n;
    }
    counts.all = all;

    const unsettled = await svc.list(await repoFilterFor(c, { ...withoutStatus, status: "open" }));
    const credits = await returnCredits(unsettled.map((inv) => inv.id));
    for (const invoice of unsettled) {
      const remaining = remainingOf(invoice, totalsFor(svc, invoice), credits.get(invoice.id));
      if (!isOpen(invoice, remaining)) continue;
      counts.open! += 1;
      if (invoice.dueDate !== null && invoice.dueDate < today) counts.overdue! += 1;
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
      // A voided invoice is neither a sale nor a receivable any more — its GL
      // entry has been reversed, so counting it here would leave the KPI strip
      // reporting revenue the ledger no longer holds.
      if (invoice.status === "draft" || isSalesInvoiceTerminal(invoice.status)) continue;
      const totals = totalsFor(svc, invoice);
      const credit = credits.get(invoice.id) ?? Money.zero();
      count += 1;
      sales = sales.add(salesInvoiceBaseGrandTotal(totals, invoice.fxRate));
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
    if (ownVisibilityOnly(c) && invoice.salespersonId !== (await ownSalespersonIdOf(c))) {
      return c.json({ error: "NOT_FOUND" }, 404);
    }
    return c.json({
      ...serialize(invoice, totalsFor(svc, invoice), await creditFor(invoice.id), maySeeCost(c)),
      // N-9: the screen keeps this and sends it back, so a second till acting on
      // a document that has already moved is refused rather than winning.
      version: await documentVersionOf(deps.versionGuard, invoice.id),
    });
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
    const stale = await refuseStaleDocument(c, deps.versionGuard, c.req.param("id"), expectedVersionOf(body));
    if (stale) return stale;
    const svc = service(c);
    const ctx = getAuthContext(c);
    try {
      const result = await svc.confirm(c.req.param("id"), {
        actor: ctx?.userId,
        actorRoles: gateActorRoles(c),
      });
      await stampDocumentModifier(deps.versionGuard, result.invoice.id, ctx?.userId);
      let etaReceipt: { receiptNo: string; uuid: string; qrValue: string } | null = null;
      let etaReceiptError: { code: string; message: string } | null = null;
      if (!result.held && deps.issueEtaReceipt) {
        try {
          etaReceipt = await deps.issueEtaReceipt(result.invoice.id, {
            paymentMethod: parsed.data.receiptPaymentMethod,
          });
        } catch (err) {
          const code = (err as { code?: unknown }).code;
          etaReceiptError = {
            code: typeof code === "string" ? code : "ETA_RECEIPT_FAILED",
            message: err instanceof Error ? err.message : String(err),
          };
        }
      }
      return c.json({
        ...serialize(result.invoice, totalsFor(svc, result.invoice), await creditFor(result.invoice.id)),
        etaReceipt,
        ...(etaReceiptError ? { etaReceiptError } : {}),
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
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const stale = await refuseStaleDocument(c, deps.versionGuard, c.req.param("id"), expectedVersionOf(body));
    if (stale) return stale;
    const svc = service(c);
    try {
      const invoice = await svc.cancel(c.req.param("id"));
      await stampDocumentModifier(deps.versionGuard, invoice.id, getAuthContext(c)?.userId);
      return c.json(serialize(invoice, totalsFor(svc, invoice)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  /**
   * إلغاء فاتورة مبيعات مؤكدة (`sales.invoice.void`). Before this the only exit
   * from a wrong invoice was cancelling it while it was still a draft, so a
   * confirmed one had none at all — the permission existed and gated nothing
   * (D116).
   *
   * It follows `cancelPurchaseInvoice` exactly, because a posted entry is
   * immutable: nothing is edited or deleted. The GL engine posts a LINKED
   * mirror entry and marks the original «معكوس» (and refuses outright when the
   * period the reversal falls in is closed or locked), the issued stock goes
   * back at the cost it left at, and the invoice moves to `reversed` so it
   * leaves the receivable. Both halves are restored or neither is attempted.
   */
  app.post("/:id/void", gate("sales.invoice.void"), async (c) => {
    const svc = service(c);
    const invoice = await svc.findByIdOrDocNo(c.req.param("id"));
    if (!invoice) return c.json({ error: "NOT_FOUND" }, 404);

    try {
      assertSalesInvoiceTransition(invoice.id, invoice.status, "reversed");
    } catch (err) {
      return handleDomainError(c, err);
    }
    // A receipted consumer sale is corrected by a return (a refund receipt);
    // the authority has no cancellation for a receipt, so a void would drop
    // the VAT from the books while the authority keeps it.
    if (deps.hasEtaReceipt && (await deps.hasEtaReceipt(invoice.id))) {
      const refusal = new EtaReceiptedSaleVoidRefusedError(invoice.docNo ?? invoice.id);
      return c.json({ error: refusal.code, message: refusal.message }, 409);
    }

    // The purchase side refuses when the received goods have already been
    // consumed; the sales side's equivalents are a collection that has moved
    // real cash and a return that has already given part of the goods back.
    // Either one has to be undone on its own document first, or the void would
    // silently strand a voucher or a credit note against a document that no
    // longer exists.
    if (invoice.amountPaid.scaled !== 0n) {
      return c.json(
        {
          error: "INVOICE_HAS_COLLECTIONS",
          message: "لا يمكن إلغاء فاتورة حُصّلت مبالغ عليها — اعكس التحصيل أولاً.",
        },
        409,
      );
    }
    const returnedCredit = await creditFor(invoice.id);
    if (returnedCredit.scaled !== 0n) {
      return c.json(
        {
          error: "INVOICE_HAS_RETURNS",
          message: "لا يمكن إلغاء فاتورة صدر عليها مرتجع — ألغِ المرتجع أولاً.",
        },
        409,
      );
    }
    if (!invoice.journalEntryId) {
      return c.json(
        { error: "INVOICE_NOT_POSTED", message: "الفاتورة ليس لها قيد يومية لعكسه." },
        409,
      );
    }

    const stockLines = invoice.lines.filter((l) => l.isStock && !l.qty.isZero());
    if (stockLines.length > 0 && !deps.stockRestore) {
      return c.json(
        {
          error: "STOCK_RESTORE_UNAVAILABLE",
          message: "إلغاء الفاتورة يتطلب إرجاع المخزون؛ وحدة المخزون غير مفعّلة.",
        },
        503,
      );
    }
    // Restoring at a cost the document does not carry would put stock back at
    // zero value and leave GL 1200 permanently above the valuation report.
    if (stockLines.some((l) => l.unitCost === null)) {
      return c.json(
        {
          error: "ISSUE_COST_UNKNOWN",
          message: "لا يمكن إرجاع المخزون: تكلفة الصرف غير مسجّلة على الفاتورة.",
        },
        409,
      );
    }

    const date = (await tenantDay(c, deps.now?.() ?? new Date().toISOString()));
    try {
      const reversal = await deps.gl.reverse(invoice.journalEntryId, {
        reversalId: `${invoice.id}:void`,
        date,
        memo: `عكس فاتورة مبيعات ${invoice.docNo ?? invoice.id}`,
      });
      if (stockLines.length > 0) {
        await deps.stockRestore!.apply({
          sourceDocType: "SALES_INVOICE",
          // A separate source id from the issue, whose movement ids are
          // `${invoice.id}:${index}` — reusing it would collide in the ledger.
          sourceDocId: `${invoice.id}:void`,
          sourceDocNumber: invoice.docNo,
          warehouseId: invoice.warehouseId,
          date,
          lines: stockLines.map((l) => ({
            itemId: l.itemId,
            direction: "IN" as const,
            qty: l.qty,
            unitCost: l.unitCost as Money,
          })),
        });
      }
      const voided: SalesInvoice = { ...invoice, status: "reversed" };
      await deps.repo.update(voided);
      await recordAdminEvent(deps.audit, c, {
        module: "sales",
        entityType: "SALES_INVOICE",
        entityId: voided.id,
        action: "VOID",
        details: {
          docNo: voided.docNo,
          customerId: voided.customerId,
          previousStatus: invoice.status,
          grandTotal: totalsFor(svc, voided).grandTotal.toString(),
          reversalJournalEntryId: reversal.journalEntryId,
        },
      });
      return c.json({
        ...serialize(voided, totalsFor(svc, voided), Money.zero(), maySeeCost(c)),
        reversalJournalEntryId: reversal.journalEntryId,
      });
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
      const id = c.req.param("id");
      const existing = await svc.findById(id);
      // A collection happens when it happens. Defaulting to the INVOICE's
      // date backdated every receipt to the day the invoice was raised — it
      // moved cash on a day the treasury did not have it, aged the customer
      // wrong and could post into a closed period. The purchase side already
      // takes today; this is its twin.
      const date = (await tenantDay(c, parsed.data.date)) ?? (await tenantDay(c, deps.now?.() ?? new Date().toISOString()));
      let relief = amount;
      if (existing?.fxRate && deps.settlementPreview && amount.scaled > 0n) {
        const preview = await deps.settlementPreview(id, amount, date);
        if (amount.scaled > preview.capacity.scaled) {
          throw new InvalidSalesInvoicePaymentError("الدفعة تتجاوز الرصيد المتبقي للفاتورة.");
        }
        relief = preview.relief;
      }
      const invoice = await svc.assertCollectable(id, relief, await creditFor(id));
      const { voucherId } = await deps.collect({
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        branchId: invoice.branchId,
        amount,
        treasuryAccountId: parsed.data.treasuryAccountId,
        paymentMethod: parsed.data.paymentMethod ?? "cash",
        date,
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
