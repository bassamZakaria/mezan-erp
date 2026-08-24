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
import { occurredAtFromDocumentDate } from "../inventory/movement.js";
import type { AllocatableInvoiceRepository } from "../vouchers/allocation.js";
import { recordSensitiveEvent, type AuditSink } from "../audit/index.js";
import type {
  DocumentGlHook,
  DocumentNumberingHook,
  DocumentWorkflowGate,
  DocumentEventPublisher,
} from "../documents/hooks.js";
import type { GateableActionType } from "../workflow/index.js";
import type { CreditControlMode } from "../settings/settings.js";
import { checkCustomerCredit, CreditLimitExceededError, type CreditCheckResult } from "../credit-control/index.js";
import { SALES_INVOICE_STATUS_LABELS_AR } from "./sales-invoice.js";
import type {
  SalesInvoice,
  SalesInvoiceDiscount,
  SalesInvoiceLine,
  SalesInvoiceStatus,
} from "./sales-invoice.js";
import { assertTransition } from "./status.js";
import { salesInvoiceTotals, type SalesInvoiceTotals } from "./totals.js";
import { describeSalesInvoiceEffects } from "./effects.js";
import { buildSalesInvoiceGlPosting, type SalesInvoiceCogsLine } from "./gl.js";
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
 * Credit-control deps (docs/catalog/01/09 §"الرقابة الائتمانية"), optional so
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

/** The workflow action gated on confirm (docs/catalog/09). */
const GATE_ACTION: GateableActionType = "SALES_INVOICE_CONFIRM";

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
  readonly audit?: AuditSink;
  /**
   * Receivables sub-ledger. Without it a confirmed invoice never becomes an
   * allocatable open invoice, so voucher allocation and every per-customer
   * balance silently see nothing.
   */
  readonly allocatable?: AllocatableInvoiceRepository;
  readonly events?: DocumentEventPublisher;
  /** ISO-8601 UTC "now"; overridable for deterministic tests. */
  readonly now?: () => string;
  readonly actor?: string;
  readonly actorRoles?: readonly string[];
}

/** A draft line, before confirm captures its cost. */
export interface CreateSalesInvoiceLine {
  readonly lineId: string;
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly isStock: boolean;
  readonly qty: Qty;
  readonly unitPrice: Money;
  readonly discountPercent?: number;
  readonly taxRatePercent?: number;
  readonly revenueAccountId: string;
  readonly cogsAccountId?: string | null;
  readonly inventoryAccountId?: string | null;
}

export interface CreateSalesInvoiceCommand {
  readonly id: string;
  readonly date: string;
  readonly dueDate: string;
  readonly customerId: string;
  readonly customerNameAr: string;
  readonly customerTaxExempt?: boolean;
  readonly warehouseId: string;
  readonly branchId: string;
  readonly salespersonId?: string | null;
  readonly salespersonNameAr?: string | null;
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

  async list(filter?: SalesInvoiceListFilter): Promise<readonly SalesInvoice[]> {
    return this.deps.repo.list(filter);
  }

  /** Open a new مسودة (draft): validated and persisted, not numbered or posted. */
  async createDraft(cmd: CreateSalesInvoiceCommand): Promise<SalesInvoice> {
    if (await this.deps.repo.findById(cmd.id)) {
      throw new DuplicateSalesInvoiceError(cmd.id);
    }
    const invoice = this.buildDraft(cmd);
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
        if (existing.status === "pending") return { invoice: existing, held: true, creditWarning: null };
        assertTransition(id, existing.status, "pending");
        const held: SalesInvoice = {
          ...existing,
          status: "pending",
          workflowRequestId: decision.requestId,
        };
        await this.deps.repo.update(held);
        this.emit("DOCUMENT_SUBMITTED", held);
        return { invoice: held, held: true, creditWarning: null };
      }
    }

    assertTransition(id, existing.status, "confirmed");

    // The promotion is evaluated only once the gate has granted, so a snapshot
    // exists only on an invoice that really went live — and every figure below
    // (credit exposure, GL posting, AR) reflects the discount it granted.
    const promoted = await this.applyPromotion(existing);
    const totals = this.totalsOf(promoted);

    const creditWarning = await this.checkCredit(promoted, totals.grandTotal);

    const confirmed = await this.deps.repo.transaction(async () => {
      const number = await this.deps.numbering.next();
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
          occurredAt,
          lines: stockLines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
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

      const numbered: SalesInvoice = { ...promoted, docNo, lines: linesWithCost };
      const posting = buildSalesInvoiceGlPosting(numbered, totals, cogsLines);
      const glResult = await this.deps.gl.post(posting);

      const next: SalesInvoice = {
        ...numbered,
        status: "confirmed",
        confirmedAt: this.now(),
        journalEntryId: glResult.journalEntryId,
        workflowRequestId: null,
      };
      await this.deps.repo.update(next);
      return next;
    });

    if (this.deps.allocatable) {
      await this.deps.allocatable.save({
        id: confirmed.id,
        invoiceNo: confirmed.docNo ?? confirmed.id,
        kind: "sales",
        partyId: confirmed.customerId,
        date: confirmed.date,
        total: totals.grandTotal,
        allocated: Money.zero(),
      });
    }

    await this.recordAudit("CONFIRM", confirmed, "INFO");
    this.emit("DOCUMENT_CONFIRMED", confirmed);
    return { invoice: confirmed, held: false, creditWarning };
  }

  /**
   * Evaluates the promotion engine against the invoice as it stands at confirm
   * and stamps the resulting SNAPSHOT onto it (docs/catalog/01 §"العروض").
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
   * Runs the credit-control check (docs/catalog/01/09 §"الرقابة الائتمانية")
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
    await this.deps.repo.update(cancelled);
    await this.recordAudit("CANCEL", cancelled, "WARNING");
    this.emit("DOCUMENT_CANCELLED", cancelled);
    return cancelled;
  }

  /**
   * Record a collection against a live invoice, advancing confirmed →
   * partially_paid → paid. Does NOT post to the GL — collection is a separate
   * treasury voucher (docs/catalog/01: "لا يتم التحصيل تلقائياً").
   */
  async recordPayment(id: string, amount: Money): Promise<SalesInvoice> {
    const existing = await this.require(id);
    if (existing.status !== "confirmed" && existing.status !== "partially_paid") {
      throw new InvalidSalesInvoicePaymentError(
        `لا يمكن تسجيل دفعة على فاتورة في حالة ${SALES_INVOICE_STATUS_LABELS_AR[existing.status]}.`,
      );
    }
    if (amount.scaled <= 0n) {
      throw new InvalidSalesInvoicePaymentError("قيمة الدفعة يجب أن تكون أكبر من صفر.");
    }
    const grandTotal = this.totalsOf(existing).grandTotal;
    const newPaid = existing.amountPaid.add(amount);
    if (newPaid.scaled > grandTotal.scaled) {
      throw new InvalidSalesInvoicePaymentError("الدفعة تتجاوز الرصيد المتبقي للفاتورة.");
    }
    const nextStatus: SalesInvoiceStatus = newPaid.scaled >= grandTotal.scaled ? "paid" : "partially_paid";
    assertTransition(id, existing.status, nextStatus);
    const updated: SalesInvoice = { ...existing, amountPaid: newPaid, status: nextStatus };
    await this.deps.repo.update(updated);
    return updated;
  }

  // --- internals ---

  private buildDraft(cmd: CreateSalesInvoiceCommand): SalesInvoice {
    const lines: SalesInvoiceLine[] = cmd.lines.map((l) => ({
      lineId: l.lineId,
      itemId: l.itemId,
      itemNameAr: l.itemNameAr,
      isStock: l.isStock,
      qty: l.qty,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent ?? 0,
      taxRatePercent: cmd.customerTaxExempt ? 0 : (l.taxRatePercent ?? 0),
      revenueAccountId: l.revenueAccountId,
      cogsAccountId: l.cogsAccountId ?? null,
      inventoryAccountId: l.inventoryAccountId ?? null,
      unitCost: null,
    }));
    return {
      id: cmd.id,
      docType: "SALES_INVOICE",
      docNo: null,
      status: "draft",
      date: cmd.date,
      dueDate: cmd.dueDate,
      customerId: cmd.customerId,
      customerNameAr: cmd.customerNameAr,
      customerTaxExempt: cmd.customerTaxExempt ?? false,
      warehouseId: cmd.warehouseId,
      branchId: cmd.branchId,
      salespersonId: cmd.salespersonId ?? null,
      salespersonNameAr: cmd.salespersonNameAr ?? null,
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
      if (line.discountPercent < 0 || line.discountPercent > 100) {
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
      action,
      actor: this.deps.actor ?? "system",
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
