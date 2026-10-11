/**
 * SalesInvoiceService — the sales-invoice lifecycle orchestrator.
 *
 * It reuses the document framework's building blocks rather than re-implementing
 * posting: the lifecycle transition guards (status.ts, modelled on documents/
 * status.ts), the "تأثيرات هذه الفاتورة" effects descriptor (effects.ts →
 * buildEffects), the framework's GL / numbering / workflow hook ports, and the
 * journal-entry GL adapter + workflow-gate adapter. On confirm it drives, inside
 * ONE transaction: numbering → stock issue (via the stock-ledger engine) → a
 * single balanced GL entry (revenue + COGS, via the GL engine) → persist, then
 * records audit + emits a document event. The period gate is enforced by the GL
 * engine when the entry posts.
 */

import { Money, Qty } from "../money/index.js";
import { toBaseQty } from "../units/index.js";
import {
  resolveDocumentLineTax,
  classifyStoredTaxRate,
  planTaxClassification,
  TaxClassificationFilingOutcome,
  TaxClassificationNotPostedError,
  TaxClassificationNotASupplyError,
  TaxClassificationAuditAction,
  TaxClassificationAuditEntity,
  TaxClassificationAuditModule,
  TaxClassificationJournalUntaggedError,
  TaxClassificationStaleError,
  JournalLineSide,
  type UntaggedJournalLineSelector,
  type ClassifyPostedLineTaxRequest,
  type JournalTaxTagPort,
  type TaxClassificationPlan,
  ZeroRatingCause,
  type ZeroRating,
  resolveInheritedTaxRate,
  type AppliedTaxRate,
  type TaxRate,
  type TaxRateRepository,
} from "../tax-rates/index.js";
import { occurredAtFromDocumentDate } from "../inventory/movement.js";
import { InvoiceDocumentKind, isRetentionRelease } from "../documents/invoice-document-kind.js";
import type { AllocatableInvoiceRepository } from "../vouchers/allocation.js";
import { AuditSeverityCode, recordSensitiveEvent, type AuditSink } from "../audit/index.js";
import type {
  DocumentGlHook,
  DocumentNumberingHook,
  DocumentWorkflowGate,
  DocumentEventPublisher,
} from "../documents/hooks.js";
import type { GateableActionType } from "../workflow/index.js";
import type { CreditControlMode } from "../settings/settings.js";
import { checkCustomerCredit, CreditLimitExceededError, type CreditCheckResult } from "../credit-control/index.js";
import { SALES_INVOICE_STATUS_LABELS_AR, SALES_INVOICE_ACTIVE_STATUSES } from "./sales-invoice.js";
import type {
  SalesInvoice,
  SalesInvoiceDiscount,
  SalesInvoiceLine,
  SalesInvoiceLineDiscountType,
  SalesInvoiceStatus,
} from "./sales-invoice.js";
import { assertTransition } from "./status.js";
import { salesInvoiceTotals, salesInvoiceBaseGrandTotal, type SalesInvoiceTotals } from "./totals.js";
import { describeSalesInvoiceEffects } from "./effects.js";
import { buildSalesInvoiceGlPosting, type SalesInvoiceCogsLine, type SalesInvoiceFxContext } from "./gl.js";
import type {
  SalesInvoiceRepository,
  SalesInvoiceListFilter,
  SalesInvoiceStockHook,
  SalesInvoiceCustomerExposureHook,
  SalesInvoicePromotionHook,
} from "./ports.js";
import {
  DuplicateSalesInvoiceError,
  InvalidSalesInvoiceError,
  InvalidSalesInvoicePaymentError,
  SalesInvoiceNotFoundError,
} from "./errors.js";

/**
 * Credit-control deps (docs/archive/catalog/01/09 §"الرقابة الائتمانية"), optional so
 * every existing caller/test that doesn't configure it keeps confirming
 * exactly as before. When present, `confirm()` checks the customer's exposure
 * (their current live-invoice balance + this invoice's own total) against
 * `getCreditLimit`, honouring WARNING (never blocks, surfaces `creditWarning`
 * on the result) vs BLOCK (throws {@link CreditLimitExceededError}) mode.
 */
export interface SalesInvoiceCreditControlDeps {
  readonly exposure: SalesInvoiceCustomerExposureHook;
  readonly getCreditLimit: (customerId: string) => Promise<Money>;
  readonly getPolicy: () => Promise<{ readonly enabled: boolean; readonly mode: CreditControlMode }>;
}

/**
 * The customer's own price list, consulted server-side. A customer can be
 * assigned a list quoting 80.00 and an invoice line at 5.00 for the same item
 * was accepted without a word, because the pricing engine was called from no
 * route at all — the whole ordering held only in the browser (D35).
 *
 * This WARNS rather than refuses, the same way credit control's WARNING mode
 * does: a negotiated price below the list is a real thing a salesperson does,
 * and refusing it outright would be a policy this product has not been asked
 * for. What the product owes the tenant is that nobody can do it unknowingly.
 */
export interface SalesInvoicePricingDeps {
  /**
   * The list price for this customer and item at the line's quantity, or null
   * when no list applies. `qty` is what selects the minimum-quantity tier
   * (R3.11): a list quoting 100.00 from 1 and 85.00 from 50 measures a 60-unit
   * line against 85.00, not against 100.00.
   */
  listPriceFor(customerId: string, itemId: string, qty: Qty): Promise<Money | null>;
}

/** One line charged below the customer's list price. */
export interface PricingVariance {
  readonly lineId: string;
  readonly itemId: string;
  readonly listPrice: Money;
  readonly chargedPrice: Money;
}

/** The workflow action gated on confirm (docs/archive/catalog/09). */
const GATE_ACTION: GateableActionType = "SALES_INVOICE_CONFIRM";

/** The tenant's VAT rules as a document sees them (settings §"الضريبة"). */
export interface SalesInvoiceTaxPolicy {
  /** VAT switched off: every line on a new invoice is raised at a zero rate. */
  readonly enabled: boolean;
  /** The rate a line that names none is raised at. */
  readonly defaultRatePercent: number;
  /** Unit prices already contain the tax. */
  readonly inclusive: boolean;
}

export interface SalesInvoiceServiceDeps {
  readonly repo: SalesInvoiceRepository;
  readonly numbering: DocumentNumberingHook;
  readonly gl: DocumentGlHook;
  readonly stock: SalesInvoiceStockHook;
  /** Optional approval gate; when omitted, confirmation is never held. */
  readonly workflow?: DocumentWorkflowGate;
  /** Optional credit-control check on confirm; when omitted, no credit check runs at all. */
  readonly creditControl?: SalesInvoiceCreditControlDeps;
  /** Optional promotion evaluation on confirm; when omitted, no invoice ever records a promotion. */
  readonly promotions?: SalesInvoicePromotionHook;
  /** Customer price lists; when omitted, no invoice is ever checked against one. */
  readonly pricing?: SalesInvoicePricingDeps;
  readonly audit?: AuditSink;
  /**
   * Receivables sub-ledger. Without it a confirmed invoice never becomes an
   * allocatable open invoice, so voucher allocation and every per-customer
   * balance silently see nothing.
   */
  readonly allocatable?: AllocatableInvoiceRepository;
  readonly events?: DocumentEventPublisher;
  /**
   * The tenant's VAT rules (settings §"الضريبة"), read when a draft is raised
   * and stamped onto it. Omit and an invoice behaves as it always did: tax
   * added on top, and a line with no rate carries none.
   */
  readonly taxPolicy?: () => Promise<SalesInvoiceTaxPolicy> | SalesInvoiceTaxPolicy;
  /** Without it no draft line can be given a `taxRateId`, and a line that names one is refused. */
  readonly taxRates?: Pick<TaxRateRepository, "list">;
  /** Names the tax rate on the posted journal lines of a line being classified (D79). */
  readonly taxTags?: JournalTaxTagPort;
  /**
   * Brings the e-document the authority holds, or is about to, in line with a
   * classification. Runs INSIDE the classification's transaction and throws to
   * refuse it — a filed document's classification cannot be contradicted.
   */
  readonly taxFiling?: SalesInvoiceTaxFilingPort;
  /**
   * Exchange rates, so a foreign-currency invoice posts its base-currency
   * value at the rate that applied on its own date and keeps that rate on the
   * receivable line for revaluation (D24). Omit and a non-base currency is
   * REFUSED rather than posted at 1:1 — silently mis-stating a debt is the
   * worse failure.
   */
  readonly exchangeRates?: { findRate(currency: string, asOfDate: string): Promise<{ rate: string } | null> };
  /** The tenant's own currency; anything else on a document needs a rate. */
  readonly baseCurrency?: string;
  /** ISO-8601 UTC "now"; overridable for deterministic tests. */
  readonly now?: () => string;
  readonly actor?: string;
  readonly actorRoles?: readonly string[];
  /**
   * Contracting's billing re-route on confirm. Omit and an invoice posts
   * exactly where its lines say, as it always did.
   */
  readonly contractBilling?: ContractBillingRoutingPort;
}

/**
 * The contracting module, as an ordinary sales invoice sees it.
 *
 * A cost-to-cost works contract RECOGNISES revenue from the monthly EAS 48
 * run, never from a document. An ordinary invoice raised on such a project
 * credited 4100 and the project then carried both that revenue and the run's —
 * the same work counted twice. When the project is on a live cost_to_cost
 * contract every REVENUE line is re-routed to the billings account instead, so
 * the invoice bills and the run alone recognises.
 */
export interface ContractBillingRouting {
  /** حساب فواتير المستخلصات على العقود — 2165 in the standard chart. */
  readonly billingsAccountId: string;
  /** The revenue accounts that must move. Anything else (retention, a contra) is left alone. */
  readonly revenueAccountIds: ReadonlySet<string>;
  /** Appended to the invoice's memo, so the re-routing is visible on the document itself. */
  readonly memoAr: string;
}

export interface ContractBillingRoutingPort {
  /** Null when the project has no LIVE cost_to_cost works contract. */
  resolve(projectId: string): Promise<ContractBillingRouting | null>;
}

/** A draft line, before confirm captures its cost. */
export interface CreateSalesInvoiceLine {
  readonly lineId: string;
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly isStock: boolean;
  readonly qty: Qty;
  /** The unit the quantity is stated in; omit for the item's base unit. */
  readonly unitCode?: string | null;
  /** Base units per one `unitCode`, from the item's unit setup. Defaults to 1. */
  readonly unitFactor?: number | null;
  readonly unitPrice: Money;
  readonly discountType?: SalesInvoiceLineDiscountType;
  readonly discountPercent?: number;
  readonly discountAmount?: Money;
  readonly taxRatePercent?: number;
  readonly taxRateId?: string | null;
  /**
   * SERVER-INTERNAL: the tax another document already resolved for this line
   * (a quote converting into an invoice). Taken as it stands — no active check,
   * no repricing. Never map it from a request body.
   */
  readonly inheritedTax?: AppliedTaxRate;
  /**
   * Names the rate of an inherited line whose source stored NONE. Honoured
   * only for a stored NULL, and only for a rate at the stored percent.
   */
  readonly inheritedTaxRateId?: string | null;
  readonly revenueAccountId: string;
  readonly cogsAccountId?: string | null;
  readonly inventoryAccountId?: string | null;
  /** Cost centre this line is booked to; null leaves it unattributed, as before (D97). */
  readonly costCenterId?: string | null;
}

export interface CreateSalesInvoiceCommand {
  readonly id: string;
  readonly documentKind?: InvoiceDocumentKind;
  readonly date: string;
  readonly dueDate: string;
  readonly customerId: string;
  readonly customerNameAr: string;
  /** SERVER-DERIVED from the customer record; never map it from a request body. */
  readonly customerTaxExempt?: boolean;
  /** SERVER-DERIVED: the 0% rate on the exempt customer's card, when it has one. */
  readonly customerTaxExemptionRateId?: string | null;
  readonly warehouseId: string;
  readonly branchId: string;
  readonly salespersonId?: string | null;
  readonly salespersonNameAr?: string | null;
  readonly projectId?: string | null;
  readonly couponCode?: string | null;
  readonly currency?: string;
  readonly notes?: string | null;
  readonly internalNotes?: string | null;
  readonly discount?: SalesInvoiceDiscount;
  readonly arAccountId: string;
  readonly taxAccountId: string;
  readonly lines: readonly CreateSalesInvoiceLine[];
}

export interface ConfirmSalesInvoiceOptions {
  readonly actor?: string;
  readonly actorRoles?: readonly string[];
  readonly requestId?: string;
}

export interface ConfirmSalesInvoiceResult {
  readonly invoice: SalesInvoice;
  /** True when the gate held the invoice بانتظار الموافقة (pending). */
  readonly held: boolean;
  /** Set when credit control ran and the customer is over their limit in WARNING mode; null otherwise (incl. when credit control isn't configured, or the customer is within limit). */
  readonly creditWarning: CreditCheckResult | null;
  /** Lines charged below the customer's assigned price list; empty when none, or when no list applies. */
  readonly pricingVariances: readonly PricingVariance[];
}

export interface SalesInvoiceTaxFilingPort {
  reconcile(change: { readonly before: SalesInvoice; readonly after: SalesInvoice }): Promise<TaxClassificationFilingOutcome>;
}

export interface ClassifySalesInvoiceLineTaxResult {
  readonly invoice: SalesInvoice;
  readonly plan: TaxClassificationPlan;
  readonly journalLinesNamed: number;
  readonly filing: TaxClassificationFilingOutcome;
}

export class SalesInvoiceService {
  constructor(private readonly deps: SalesInvoiceServiceDeps) {}

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }

  /** Totals for an invoice, honouring the customer's tax-exempt flag and any applied promotion. */
  totalsOf(invoice: SalesInvoice): SalesInvoiceTotals {
    return salesInvoiceTotals(invoice);
  }

  /** The "تأثيرات هذه الفاتورة" descriptor (pure; drives the panel + confirm gate). */
  effectsOf(invoice: SalesInvoice) {
    return describeSalesInvoiceEffects(invoice, this.totalsOf(invoice));
  }

  async findById(id: string): Promise<SalesInvoice | null> {
    return this.deps.repo.findById(id);
  }

  /**
   * The document number, which is what a deep link carries. Falls back to the
   * id so `GET /:id` keeps answering for both.
   */
  async findByIdOrDocNo(idOrDocNo: string): Promise<SalesInvoice | null> {
    return (await this.deps.repo.findById(idOrDocNo)) ?? (await this.deps.repo.findByDocNo(idOrDocNo));
  }

  async list(filter?: SalesInvoiceListFilter): Promise<readonly SalesInvoice[]> {
    return this.deps.repo.list(filter);
  }

  async count(filter?: SalesInvoiceListFilter): Promise<number> {
    return this.deps.repo.count(filter);
  }

  /** Row count per stored status for the same filter — see the port. */
  async countByStatus(filter?: SalesInvoiceListFilter): Promise<ReadonlyMap<SalesInvoice["status"], number>> {
    return this.deps.repo.countByStatus(filter);
  }

  /** Open a new مسودة (draft): validated and persisted, not numbered or posted. */
  async createDraft(cmd: CreateSalesInvoiceCommand): Promise<SalesInvoice> {
    if (await this.deps.repo.findById(cmd.id)) {
      throw new DuplicateSalesInvoiceError(cmd.id);
    }
    const taxRates = this.deps.taxRates ? await this.deps.taxRates.list() : null;
    const invoice = this.buildDraft(cmd, await this.resolveTaxPolicy(), taxRates);
    this.validate(invoice);
    await this.deps.repo.save(invoice);
    this.emit("DOCUMENT_DRAFTED", invoice);
    return invoice;
  }

  /**
   * Confirm an invoice. Applies the workflow gate first (if configured); if
   * approval is required the invoice is held بانتظار الموافقة (pending). Otherwise
   * it runs numbering → stock issue → GL post → persist in one transaction.
   */
  async confirm(id: string, opts: ConfirmSalesInvoiceOptions = {}): Promise<ConfirmSalesInvoiceResult> {
    const existing = await this.require(id);
    this.validate(existing);

    const effects = this.effectsOf(existing);
    if (effects.blocked) {
      throw new InvalidSalesInvoiceError([
        effects.blockedReason ?? "الفاتورة غير قابلة للتأكيد في حالتها الحالية.",
      ]);
    }

    // --- Workflow gate on confirm ---
    if (this.deps.workflow) {
      const decision = await this.deps.workflow.evaluate({
        actionType: GATE_ACTION,
        requestId: opts.requestId ?? `${id}:confirm`,
        submittedBy: opts.actor ?? this.deps.actor ?? "system",
        submitterRoles: opts.actorRoles ?? this.deps.actorRoles,
      });
      if (!decision.granted) {
        // Re-confirming while the request is still in the inbox is a no-op, not
        // an illegal pending → pending transition.
        if (existing.status === "pending") return { invoice: existing, held: true, creditWarning: null, pricingVariances: [] };
        assertTransition(id, existing.status, "pending");
        const held: SalesInvoice = {
          ...existing,
          status: "pending",
          workflowRequestId: decision.requestId,
        };
        await this.deps.repo.update(held);
        this.emit("DOCUMENT_SUBMITTED", held);
        return { invoice: held, held: true, creditWarning: null, pricingVariances: [] };
      }
    }

    assertTransition(id, existing.status, "confirmed");

    // The promotion is evaluated only once the gate has granted, so a snapshot
    // exists only on an invoice that really went live — and every figure below
    // (credit exposure, GL posting, AR) reflects the discount it granted.
    const promoted = await this.applyContractBilling(await this.applyPromotion(existing));
    const totals = this.totalsOf(promoted);

    // A foreign-currency invoice needs the rate BEFORE anything is written:
    // resolved here, a missing rate refuses the confirm outright rather than
    // leaving stock issued against a document that never posted.
    const fx = await this.resolveFxRate(promoted);

    const creditWarning = await this.checkCredit(promoted, salesInvoiceBaseGrandTotal(totals, fx?.rate));
    const pricingVariances = await this.checkPricing(promoted);

    const confirmed = await this.deps.repo.transaction(async () => {
      const number = await this.deps.numbering.next({ branchId: existing.branchId });
      const docNo = number.formatted;
      // The LEDGER timestamp is the invoice's own date, never the wall clock:
      // a document-dated movement and a now()-stamped one cannot be replayed in
      // a single order (D4). `confirmedAt` below stays the real wall clock.
      const occurredAt = occurredAtFromDocumentDate(promoted.date);

      // Issue stock OUT for stock lines; capture the moving-average cost.
      const stockLines = promoted.lines.filter((l) => l.isStock);
      let costByLineId = new Map<string, Money>();
      if (stockLines.length > 0) {
        const result = await this.deps.stock.issue({
          issueId: promoted.id,
          sourceDocId: promoted.id,
          sourceDocNumber: docNo,
          warehouseId: promoted.warehouseId,
          projectId: promoted.projectId,
          occurredAt,
          // BASE units, never the entered ones: a line sold in cartons must
          // take pieces out of the ledger, and the cost that comes back — and
          // therefore the COGS leg — is the cost of those pieces.
          lines: stockLines.map((l) => ({ itemId: l.itemId, qty: l.baseQty })),
        });
        costByLineId = new Map(stockLines.map((l, i) => [l.lineId, result.lines[i]?.cost ?? Money.zero()]));
      }

      // Capture unit costs onto lines + build the COGS side of the entry.
      const linesWithCost: SalesInvoiceLine[] = promoted.lines.map((l) => {
        if (!l.isStock) return l;
        const cost = costByLineId.get(l.lineId) ?? Money.zero();
        const unitCost = l.qty.scaled === 0n ? Money.zero() : divCost(cost, l.qty);
        return { ...l, unitCost };
      });
      const cogsLines: SalesInvoiceCogsLine[] = promoted.lines
        .filter((l) => l.isStock && l.cogsAccountId && l.inventoryAccountId)
        .map((l) => ({
          cogsAccountId: l.cogsAccountId as string,
          inventoryAccountId: l.inventoryAccountId as string,
          cost: costByLineId.get(l.lineId) ?? Money.zero(),
        }));

      const numbered: SalesInvoice = { ...promoted, docNo, lines: linesWithCost, fxRate: fx?.rate ?? null };
      const posting = buildSalesInvoiceGlPosting(numbered, totals, cogsLines, fx);
      const glResult = await this.deps.gl.post(posting);

      const next: SalesInvoice = {
        ...numbered,
        status: "confirmed",
        confirmedAt: this.now(),
        journalEntryId: glResult.journalEntryId,
        workflowRequestId: null,
      };
      await this.deps.repo.update(next);

      // The allocation sub-ledger row and the audit row are part of the confirm,
      // not a follow-up: written after the commit, a failure between them left a
      // confirmed invoice that `/open-invoices` could not see and no record of
      // who confirmed it.
      if (this.deps.allocatable) {
        await this.deps.allocatable.save({
          id: next.id,
          invoiceNo: next.docNo ?? next.id,
          kind: "sales",
          partyId: next.customerId,
          date: next.date,
          // BASE currency: a voucher settles in base, and the control account
          // holds base — comparing a USD figure against either reads adrift by
          // the whole rate (D24).
          total: salesInvoiceBaseGrandTotal(totals, next.fxRate),
          allocated: Money.zero(),
        });
      }
      await this.recordAudit("CONFIRM", next, "INFO");
      return next;
    });

    this.emit("DOCUMENT_CONFIRMED", confirmed);
    return { invoice: confirmed, held: false, creditWarning, pricingVariances };
  }

  /**
   * The rate a foreign-currency invoice confirms at: the latest APPROVED rate
   * effective on/before the invoice's own date. A base-currency invoice needs
   * none; a foreign one with no usable rate is refused, never posted at 1:1.
   */
  private async resolveFxRate(invoice: SalesInvoice): Promise<SalesInvoiceFxContext | undefined> {
    const baseCurrency = this.deps.baseCurrency ?? "EGP";
    if (!invoice.currency || invoice.currency === baseCurrency) return undefined;
    const found = await this.deps.exchangeRates?.findRate(invoice.currency, invoice.date);
    if (!found) {
      throw new InvalidSalesInvoiceError([
        `لا يوجد سعر صرف معتمد للعملة ${invoice.currency} بتاريخ ${invoice.date}؛ لا يمكن ترحيل الفاتورة.`,
      ]);
    }
    return { rate: found.rate };
  }

  /**
   * Evaluates the promotion engine against the invoice as it stands at confirm
   * and stamps the resulting SNAPSHOT onto it (docs/archive/catalog/01 §"العروض").
   * Nothing is re-resolved from the promotion later, so editing or
   * deactivating the promotion cannot rewrite what this invoice granted.
   */
  private async applyPromotion(invoice: SalesInvoice): Promise<SalesInvoice> {
    if (!this.deps.promotions || invoice.appliedPromotion) return invoice;
    const applied = await this.deps.promotions.evaluate({
      lines: invoice.lines,
      date: invoice.date,
      couponCode: invoice.couponCode,
    });
    return applied ? { ...invoice, appliedPromotion: applied } : invoice;
  }

  /**
   * Runs the credit-control check (docs/archive/catalog/01/09 §"الرقابة الائتمانية")
   * when `creditControl` deps are configured; no-op (returns null) otherwise.
   * BLOCK-mode violations throw {@link CreditLimitExceededError} — the caller
   * never sees a "blocked" result, only "warning" or null.
   */
  private async checkCredit(invoice: SalesInvoice, newExposure: Money): Promise<CreditCheckResult | null> {
    const cc = this.deps.creditControl;
    if (!cc) return null;
    const [policy, creditLimit, currentBalance] = await Promise.all([
      cc.getPolicy(),
      cc.getCreditLimit(invoice.customerId),
      cc.exposure.currentBalance(invoice.customerId, invoice.id),
    ]);
    const result = checkCustomerCredit({
      enabled: policy.enabled,
      mode: policy.mode,
      creditLimit,
      currentBalance,
      newExposure,
    });
    if (result.status === "blocked") {
      throw new CreditLimitExceededError(invoice.customerId, result.message ?? "تجاوز الحد الائتماني للعميل.");
    }
    return result.status === "warning" ? result : null;
  }

  /**
   * Return an invoice held بانتظار الموافقة to its submitter as an editable
   * draft — what a rejection or a "طلب تعديل" means for the INVOICE, as opposed
   * to for the approval request.
   */
  async returnToDraft(id: string): Promise<SalesInvoice> {
    const existing = await this.require(id);
    if (existing.status === "draft") return existing;
    assertTransition(id, existing.status, "draft");
    const returned: SalesInvoice = { ...existing, status: "draft", workflowRequestId: null };
    await this.deps.repo.update(returned);
    this.emit("DOCUMENT_DRAFTED", returned);
    return returned;
  }

  /** Cancel a draft/pending invoice (never a live one — those are corrected by a return). */
  async cancel(id: string): Promise<SalesInvoice> {
    const existing = await this.require(id);
    assertTransition(id, existing.status, "cancelled");
    const cancelled: SalesInvoice = { ...existing, status: "cancelled", workflowRequestId: null };
    await this.deps.repo.transaction(async () => {
      await this.deps.repo.update(cancelled);
      await this.recordAudit("CANCEL", cancelled, "WARNING");
    });
    this.emit("DOCUMENT_CANCELLED", cancelled);
    return cancelled;
  }

  /**
   * Validate a collection against a live invoice. It does NOT write: the caller
   * creates and confirms a real collection voucher and allocates it, and the
   * allocation writes `amountPaid` back through `applyAllocatedSettlement`.
   *
   * This used to increment a cumulative `amountPaid` itself and post nothing,
   * which made the invoice a SECOND store of a fact the allocation sub-ledger
   * owns — and one the ledger never heard about, so AR drifted by every
   * collection ever recorded that way (D1).
   */
  async assertCollectable(id: string, amount: Money, returnedCredit: Money = Money.zero()): Promise<SalesInvoice> {
    const existing = await this.require(id);
    if (existing.status !== "confirmed" && existing.status !== "partially_paid") {
      throw new InvalidSalesInvoicePaymentError(
        `لا يمكن تسجيل دفعة على فاتورة في حالة ${SALES_INVOICE_STATUS_LABELS_AR[existing.status]}.`,
      );
    }
    if (amount.scaled <= 0n) {
      throw new InvalidSalesInvoicePaymentError("قيمة الدفعة يجب أن تكون أكبر من صفر.");
    }
    const grandTotal = salesInvoiceBaseGrandTotal(this.totalsOf(existing), existing.fxRate);
    if (existing.amountPaid.scaled + returnedCredit.scaled + amount.scaled > grandTotal.scaled) {
      throw new InvalidSalesInvoicePaymentError("الدفعة تتجاوز الرصيد المتبقي للفاتورة.");
    }
    return existing;
  }

  /**
   * Re-routes an invoice's revenue lines onto contracting's billings account
   * when its project is on a live cost_to_cost works contract, and says so in
   * the memo. Amounts are untouched — only where the credit lands.
   */
  private async applyContractBilling(invoice: SalesInvoice): Promise<SalesInvoice> {
    const port = this.deps.contractBilling;
    if (!port || !invoice.projectId) return invoice;
    const routing = await port.resolve(invoice.projectId);
    if (!routing) return invoice;
    let moved = false;
    const lines = invoice.lines.map((line) => {
      if (!routing.revenueAccountIds.has(line.revenueAccountId)) return line;
      if (line.revenueAccountId === routing.billingsAccountId) return line;
      moved = true;
      return { ...line, revenueAccountId: routing.billingsAccountId };
    });
    if (!moved) return invoice;
    const notes = invoice.notes && invoice.notes.trim() !== "" ? `${invoice.notes} — ${routing.memoAr}` : routing.memoAr;
    return { ...invoice, lines, notes };
  }

  /** Lines charged below the customer's own list price (D35). */
  private async checkPricing(invoice: SalesInvoice): Promise<readonly PricingVariance[]> {
    const pricing = this.deps.pricing;
    if (!pricing) return [];
    const out: PricingVariance[] = [];
    for (const line of invoice.lines) {
      const listPrice = await pricing.listPriceFor(invoice.customerId, line.itemId, line.baseQty);
      if (!listPrice) continue;
      if (line.unitPrice.scaled < listPrice.scaled) {
        out.push({ lineId: line.lineId, itemId: line.itemId, listPrice, chargedPrice: line.unitPrice });
      }
    }
    return out;
  }

  // --- internals ---

  private async resolveTaxPolicy(): Promise<SalesInvoiceTaxPolicy> {
    if (!this.deps.taxPolicy) return { enabled: true, defaultRatePercent: 0, inclusive: false };
    return this.deps.taxPolicy();
  }

  private buildDraft(
    cmd: CreateSalesInvoiceCommand,
    taxPolicy: SalesInvoiceTaxPolicy,
    taxRates: readonly TaxRate[] | null,
  ): SalesInvoice {
    const zeroRating: ZeroRating | null = !taxPolicy.enabled
      ? { cause: ZeroRatingCause.VatOff }
      : cmd.customerTaxExempt === true
        ? { cause: ZeroRatingCause.ExemptCustomer, exemptionTaxRateId: cmd.customerTaxExemptionRateId ?? null }
        : null;
    const appliedTax = (l: CreateSalesInvoiceLine): AppliedTaxRate => {
      if (!l.inheritedTax) return resolveDocumentLineTax(taxRates, l, { defaultPercent: taxPolicy.defaultRatePercent, zeroRating });
      const inherited = resolveInheritedTaxRate(taxRates, l.inheritedTax);
      if (typeof l.inheritedTaxRateId === "string") return classifyStoredTaxRate(taxRates, inherited, l.inheritedTaxRateId);
      const raisedBySystem = zeroRating !== null && inherited.taxRateId === null && inherited.taxRatePercent === 0;
      return raisedBySystem ? resolveDocumentLineTax(taxRates, {}, { defaultPercent: 0, zeroRating }) : inherited;
    };
    const lines: SalesInvoiceLine[] = cmd.lines.map((l) => {
      const unitFactor = l.unitFactor ?? 1;
      const tax = appliedTax(l);
      return {
      lineId: l.lineId,
      itemId: l.itemId,
      itemNameAr: l.itemNameAr,
      isStock: l.isStock,
      qty: l.qty,
      unitCode: (l.unitCode ?? "").trim(),
      unitFactor,
      // Computed once, at draft time, from the factor the item master held
      // then: re-deriving it later would restate a document already in the
      // books if someone edits the item's unit setup.
      baseQty: Number.isFinite(unitFactor) && unitFactor > 0 ? toBaseQty(l.qty, unitFactor) : l.qty,
      unitPrice: l.unitPrice,
      discountType: l.discountType ?? "percent",
      discountPercent: l.discountPercent ?? 0,
      discountAmount: l.discountAmount ?? Money.zero(),
      taxRatePercent: tax.taxRatePercent,
      taxRateId: tax.taxRateId,
      revenueAccountId: l.revenueAccountId,
      cogsAccountId: l.cogsAccountId ?? null,
      inventoryAccountId: l.inventoryAccountId ?? null,
      costCenterId: l.costCenterId ?? null,
      unitCost: null,
      };
    });
    return {
      id: cmd.id,
      docType: "SALES_INVOICE",
      documentKind: cmd.documentKind ?? InvoiceDocumentKind.Standard,
      docNo: null,
      status: "draft",
      date: cmd.date,
      dueDate: cmd.dueDate,
      customerId: cmd.customerId,
      customerNameAr: cmd.customerNameAr,
      customerTaxExempt: cmd.customerTaxExempt ?? false,
      taxInclusive: taxPolicy.inclusive,
      warehouseId: cmd.warehouseId,
      branchId: cmd.branchId,
      salespersonId: cmd.salespersonId ?? null,
      salespersonNameAr: cmd.salespersonNameAr ?? null,
      projectId: cmd.projectId ?? null,
      currency: cmd.currency ?? "EGP",
      couponCode: cmd.couponCode ?? null,
      appliedPromotion: null,
      notes: cmd.notes ?? null,
      internalNotes: cmd.internalNotes ?? null,
      discount: cmd.discount ?? { type: "amount", amount: Money.zero() },
      arAccountId: cmd.arAccountId,
      taxAccountId: cmd.taxAccountId,
      lines,
      amountPaid: Money.zero(),
      createdAt: this.now(),
      confirmedAt: null,
      journalEntryId: null,
      workflowRequestId: null,
      reversesInvoiceId: null,
      reversedByInvoiceId: null,
    };
  }

  private validate(invoice: SalesInvoice): void {
    const reasons: string[] = [];
    if (invoice.customerId.trim() === "") reasons.push("العميل مطلوب.");
    if (invoice.warehouseId.trim() === "") reasons.push("المستودع مطلوب.");
    if (invoice.arAccountId.trim() === "") reasons.push("حساب المدينون مطلوب.");
    if (invoice.lines.length === 0) reasons.push("الفاتورة تتطلب بنداً واحداً على الأقل.");
    for (const line of invoice.lines) {
      if (line.itemId.trim() === "") reasons.push("كل بند يجب أن يستهدف صنفاً.");
      if (line.qty.isNegative() || line.qty.isZero()) {
        reasons.push(`الصنف "${line.itemNameAr}": الكمية يجب أن تكون أكبر من صفر.`);
      }
      if (line.unitPrice.scaled < 0n) {
        reasons.push(`الصنف "${line.itemNameAr}": السعر لا يقبل قيمة سالبة.`);
      }
      if (!Number.isFinite(line.unitFactor) || line.unitFactor <= 0) {
        reasons.push(`الصنف "${line.itemNameAr}": معامل تحويل الوحدة يجب أن يكون أكبر من صفر.`);
      }
      if (line.baseQty.isNegative() || line.baseQty.isZero()) {
        reasons.push(`الصنف "${line.itemNameAr}": الكمية بالوحدة الأساسية يجب أن تكون أكبر من صفر.`);
      }
      if (line.discountType === "amount") {
        if (line.discountAmount.scaled < 0n) {
          reasons.push(`الصنف "${line.itemNameAr}": قيمة الخصم لا تقبل قيمة سالبة.`);
        }
      } else if (line.discountPercent < 0 || line.discountPercent > 100) {
        reasons.push(`الصنف "${line.itemNameAr}": نسبة الخصم يجب أن تكون بين 0 و 100.`);
      }
      if (line.isStock && (!line.cogsAccountId || !line.inventoryAccountId)) {
        reasons.push(`الصنف "${line.itemNameAr}": بند مخزون يتطلب حسابي التكلفة والمخزون.`);
      }
    }
    // The invoice-level discount was unchecked while every line-level one was.
    // A negative amount is applied as a literal subtraction, so it INFLATES the
    // total rather than reducing it — 950 became 1,140 in the scenario suite.
    if (invoice.discount.type === "amount" && invoice.discount.amount.scaled < 0n) {
      reasons.push("خصم الفاتورة لا يقبل قيمة سالبة.");
    }
    if (invoice.discount.type === "percent" && (invoice.discount.percent < 0 || invoice.discount.percent > 100)) {
      reasons.push("نسبة خصم الفاتورة يجب أن تكون بين 0 و 100.");
    }
    if (reasons.length > 0) throw new InvalidSalesInvoiceError(reasons);
  }

  /**
   * تصنيف ضريبة البند — names the tax rate of a POSTED line that stored none.
   *
   * INVARIANT: the only change is NULL → a rate at the line's own stored
   * percent, on the invoice line and on its journal lines, in one transaction.
   * No amount, account, date or status moves, and a line that names a rate is
   * never re-pointed — that correction is a return or a credit note.
   */
  async classifyLineTax(id: string, request: ClassifyPostedLineTaxRequest): Promise<ClassifySalesInvoiceLineTaxResult> {
    // INVARIANT: the read, the plan and both writes share ONE transaction, and
    // the invoice is written by `nameLineTaxRate` alone — never `update`. A
    // copy read before the transaction would race a void, a collection or a
    // second classification and write their work away.
    return this.deps.repo.transaction(async () => {
      const existing = await this.require(id);
      if (!SALES_INVOICE_ACTIVE_STATUSES.has(existing.status)) {
        throw new TaxClassificationNotPostedError(SALES_INVOICE_STATUS_LABELS_AR[existing.status]);
      }
      const documentNumber = existing.docNo ?? existing.id;
      if (isRetentionRelease(existing)) throw new TaxClassificationNotASupplyError(documentNumber);
      const taxRates = this.deps.taxRates ? await this.deps.taxRates.list() : null;
      const plan = planTaxClassification(
        taxRates,
        existing.lines.map((l) => ({ lineRef: l.lineId, label: l.itemNameAr, stored: { taxRateId: l.taxRateId ?? null, taxRatePercent: l.taxRatePercent } })),
        request,
      );
      // ORDER MATTERS: the journal goes first — it is what refuses a filed
      // VAT period, and it must refuse before the invoice line is written.
      let journalLinesNamed = 0;
      if (existing.journalEntryId && this.deps.taxTags) {
        journalLinesNamed = await this.deps.taxTags.retagUnnamedTaxRate(
          existing.journalEntryId,
          plan.before.taxRatePercent,
          request.taxRateId,
          untaggedSalesJournalLines(existing, plan),
        );
        if (journalLinesNamed === 0) throw new TaxClassificationJournalUntaggedError(documentNumber);
      }
      const linesNamed = await this.deps.repo.nameLineTaxRate(existing.id, plan.lineRefs, plan.before.taxRatePercent, request.taxRateId);
      if (linesNamed !== plan.lineRefs.length) throw new TaxClassificationStaleError(documentNumber);
      const invoice = await this.require(id);
      const filing = (await this.deps.taxFiling?.reconcile({ before: existing, after: invoice })) ?? TaxClassificationFilingOutcome.NotQueued;
      if (this.deps.audit) {
        await recordSensitiveEvent(this.deps.audit, {
          module: TaxClassificationAuditModule.Sales,
          entityType: TaxClassificationAuditEntity.SalesInvoice,
          entityId: invoice.id,
          action: TaxClassificationAuditAction.ClassifyLineTax,
          actor: this.deps.actor ?? "system",
          branchId: invoice.branchId ?? null,
          severity: AuditSeverityCode.Warning,
          details: {
            invoiceId: invoice.id,
            docNo: invoice.docNo,
            lineIds: plan.lineRefs,
            before: plan.before,
            after: plan.after,
            taxRateName: plan.taxRateName,
            journalEntryId: existing.journalEntryId,
            journalLinesNamed,
            filing,
          },
        });
      }
      return { invoice, plan, journalLinesNamed, filing };
    });
  }

  private async require(id: string): Promise<SalesInvoice> {
    const invoice = await this.deps.repo.findById(id);
    if (!invoice) throw new SalesInvoiceNotFoundError(id);
    return invoice;
  }

  private emit(
    type: "DOCUMENT_DRAFTED" | "DOCUMENT_SUBMITTED" | "DOCUMENT_CONFIRMED" | "DOCUMENT_CANCELLED",
    invoice: SalesInvoice,
  ): void {
    this.deps.events?.publish({
      type,
      docType: invoice.docType,
      docId: invoice.id,
      docNo: invoice.docNo,
      occurredAt: this.now(),
      reversedByDocId: null,
    });
  }

  private async recordAudit(
    action: "CONFIRM" | "CANCEL",
    invoice: SalesInvoice,
    severity: "INFO" | "WARNING",
  ): Promise<void> {
    if (!this.deps.audit) return;
    await recordSensitiveEvent(this.deps.audit, {
      module: "sales",
      entityType: "SALES_INVOICE",
      entityId: invoice.id,
      action,
      actor: this.deps.actor ?? "system",
      // The DOCUMENT's branch, not the caller's scope: the default scope is
      // all-branches, which would leave every row unfindable by branch (D30).
      branchId: invoice.branchId ?? null,
      severity,
      details: {
        invoiceId: invoice.id,
        docNo: invoice.docNo,
        status: invoice.status,
        customerId: invoice.customerId,
      },
    });
  }
}

/** unitCost = cost / qty, at Money scale (used only for display capture). */
function divCost(cost: Money, qty: Qty): Money {
  // cost.scaled / (qty.scaled/1e6) = cost.scaled * 1e6 / qty.scaled
  const numerator = cost.scaled * 1_000_000n;
  const q = numerator / qty.scaled;
  const r = numerator % qty.scaled;
  const rounded = r * 2n >= qty.scaled ? q + 1n : q;
  return Money.fromScaled(rounded);
}

/**
 * Project the allocation sub-ledger back onto the invoice document: `settled`
 * is the sum of ACTIVE allocations against this invoice, so it falls as well as
 * rises when one is reversed. This is the only writer that keeps `amountPaid`
 * truthful for voucher-driven collection — before it, a confirmed collection
 * credited AR in the GL and left the invoice reporting amountPaid 0 forever
 * (D1). A free function rather than a service method so the wiring layer can
 * call it with the repository alone.
 */
export async function applyAllocatedSettlement(
  repo: SalesInvoiceRepository,
  id: string,
  settled: Money,
): Promise<SalesInvoice | null> {
  const existing = await repo.findById(id);
  if (!existing) return null;
  if (!SALES_INVOICE_ACTIVE_STATUSES.has(existing.status)) return existing;

  const grandTotal = salesInvoiceBaseGrandTotal(salesInvoiceTotals(existing), existing.fxRate);
  const capped = settled.scaled > grandTotal.scaled ? grandTotal : settled;
  const nextStatus: SalesInvoiceStatus =
    capped.scaled <= 0n ? "confirmed" : capped.scaled >= grandTotal.scaled ? "paid" : "partially_paid";
  if (capped.scaled === existing.amountPaid.scaled && nextStatus === existing.status) return existing;

  if (nextStatus !== existing.status) assertTransition(id, existing.status, nextStatus);
  const updated: SalesInvoice = { ...existing, amountPaid: capped, status: nextStatus };
  await repo.update(updated);
  return updated;
}

function untaggedSalesJournalLines(invoice: SalesInvoice, plan: TaxClassificationPlan): UntaggedJournalLineSelector | undefined {
  if (plan.lineRefs.length !== invoice.lines.length) return undefined;
  const accountIds = new Set(invoice.lines.map((line) => line.revenueAccountId));
  if (plan.before.taxRatePercent > 0) accountIds.add(invoice.taxAccountId);
  return { accountIds: [...accountIds], side: JournalLineSide.Credit };
}
