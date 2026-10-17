/**
 * SalesQuoteService — the sales-quote lifecycle orchestrator.
 *
 * Much simpler than {@link import("../sales-invoices/service.js").SalesInvoiceService}:
 * no GL hook, no stock hook, no workflow gate (quotes don't require approval
 * in the catalog). It reuses only the document framework's numbering hook
 * port (documents/hooks.ts) — the number is allocated the first time a quote
 * leaves مسودة (draft), i.e. inside `send`, mirroring the "number allocated on
 * the transition out of draft" pattern sales invoices use on confirm.
 */

import { Money, Qty } from "../money/index.js";
import type { DocumentNumberingHook } from "../documents/hooks.js";
import { resolveDocumentLineTax, ZeroRatingCause, type TaxRate, type TaxRateRepository, type ZeroRating } from "../tax-rates/index.js";
import type { SalesQuote, SalesQuoteDiscount, SalesQuoteLine } from "./sales-quote.js";
import { assertTransition } from "./status.js";
import { computeQuoteTotals, type SalesQuoteTotals } from "./totals.js";
import { describeQuoteEffects } from "./effects.js";
import type { SalesQuoteListFilter, SalesQuoteRepository } from "./ports.js";
import type { SalesTaxPolicySource } from "../sales-invoices/tax-policy.js";
import {
  InvalidSalesQuoteError,
  SalesQuoteNotFoundError,
} from "./errors.js";

export interface SalesQuoteServiceDeps {
  readonly repo: SalesQuoteRepository;
  readonly numbering: DocumentNumberingHook;
  readonly taxRates?: Pick<TaxRateRepository, "list">;
  readonly taxPolicy?: SalesTaxPolicySource;
  /** ISO-8601 UTC "now"; overridable for deterministic tests. */
  readonly now?: () => string;
  readonly actor?: string;
}

/** A draft line, before send. */
export interface CreateSalesQuoteLine {
  readonly lineId: string;
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly qty: Qty;
  readonly unitPrice: Money;
  readonly discountPercent?: number;
  readonly taxRatePercent?: number;
  readonly taxRateId?: string | null;
}

export interface CreateSalesQuoteCommand {
  readonly id: string;
  readonly date: string;
  readonly expiryDate: string;
  readonly customerId: string;
  readonly customerNameAr: string;
  /** SECURITY: server-derived from the customer record; never map it from a request body. */
  readonly customerTaxExempt?: boolean;
  /** SECURITY: server-derived — the 0% rate on the exempt customer's card; never map it from a request body. */
  readonly customerTaxExemptionRateId?: string | null;
  readonly branchId: string;
  readonly opportunityId?: string | null;
  readonly currency?: string;
  readonly notes?: string | null;
  readonly internalNotes?: string | null;
  readonly discount?: SalesQuoteDiscount;
  readonly priceListId?: string | null;
  readonly couponCode?: string | null;
  readonly lines: readonly CreateSalesQuoteLine[];
}

export class SalesQuoteService {
  constructor(private readonly deps: SalesQuoteServiceDeps) {}

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }

  /** Totals for a quote, honouring the customer's tax-exempt flag. */
  totalsOf(quote: SalesQuote): SalesQuoteTotals {
    return computeQuoteTotals(quote.lines, quote.discount, {
      taxExempt: quote.customerTaxExempt,
    });
  }

  /** The "تأثيرات هذا العرض" descriptor (pure; drives the panel + send gate). */
  effectsOf(quote: SalesQuote) {
    return describeQuoteEffects(quote, this.totalsOf(quote));
  }

  async findById(id: string): Promise<SalesQuote | null> {
    return this.deps.repo.findById(id);
  }

  async list(filter?: SalesQuoteListFilter): Promise<readonly SalesQuote[]> {
    return this.deps.repo.list(filter);
  }

  /** Open a new مسودة (draft): validated and persisted, not numbered. */
  async createDraft(cmd: CreateSalesQuoteCommand): Promise<SalesQuote> {
    const vatOff = this.deps.taxPolicy ? !(await this.deps.taxPolicy()).enabled : false;
    const quote = this.buildDraft(cmd, this.deps.taxRates ? await this.deps.taxRates.list() : null, vatOff);
    this.validate(quote);
    await this.deps.repo.save(quote);
    return quote;
  }

  /** Send a draft quote to the customer: allocates its doc number and marks مرسل. */
  async send(id: string): Promise<SalesQuote> {
    return this.change(id, async (existing) => {
      this.validate(existing);

      const effects = this.effectsOf(existing);
      if (effects.blocked) {
        throw new InvalidSalesQuoteError([
          effects.blockedReason ?? "العرض غير قابل للإرسال في حالته الحالية.",
        ]);
      }

      assertTransition(id, existing.status, "sent");
      const number = await this.deps.numbering.next();
      return { ...existing, docNo: number.formatted, status: "sent", sentAt: this.now() };
    });
  }

  /** Record the customer's acceptance مقبول. */
  async accept(id: string): Promise<SalesQuote> {
    return this.change(id, async (existing) => {
      assertTransition(id, existing.status, "accepted");
      return { ...existing, status: "accepted", respondedAt: this.now() };
    });
  }

  /** Record the customer's rejection مرفوض. */
  async reject(id: string): Promise<SalesQuote> {
    return this.change(id, async (existing) => {
      assertTransition(id, existing.status, "rejected");
      return { ...existing, status: "rejected", respondedAt: this.now() };
    });
  }

  /** Cancel a draft/sent/accepted quote. */
  async cancel(id: string): Promise<SalesQuote> {
    return this.change(id, async (existing) => {
      assertTransition(id, existing.status, "cancelled");
      return { ...existing, status: "cancelled" };
    });
  }

  // INVARIANT: a quote's status is read and written inside ONE transaction,
  // so of two transitions racing each other the second judges what the first
  // left — an accepted quote is never also cancelled, nor numbered twice.
  private async change(id: string, next: (existing: SalesQuote) => Promise<SalesQuote>): Promise<SalesQuote> {
    return this.deps.repo.transaction(async () => {
      const changed = await next(await this.require(id));
      await this.deps.repo.update(changed);
      return changed;
    });
  }

  /**
   * Record that this quote was converted to a sales invoice. Called BY the
   * (separately implemented) convert-to-invoice flow that bridges the sales
   * quote and sales invoice modules — not exposed as its own HTTP route here.
   */
  async markConverted(id: string, invoiceId: string): Promise<SalesQuote> {
    // INVARIANT: the status is read and written inside ONE transaction, so of
    // two conversions of the same quote the second reads `converted` and is
    // refused — a quote never stands behind two invoices.
    return this.deps.repo.transaction(async () => {
      const existing = await this.require(id);
      assertTransition(id, existing.status, "converted");
      const converted: SalesQuote = {
        ...existing,
        status: "converted",
        convertedAt: this.now(),
        convertedInvoiceId: invoiceId,
      };
      await this.deps.repo.update(converted);
      return converted;
    });
  }

  /**
   * INVARIANT: a quote is `converted` only while the draft it became still
   * exists. Cancelling that draft hands the quote back as accepted, so the
   * customer's agreed quote can be raised again instead of being stranded.
   */
  async reopenConvertedBy(invoiceId: string, otherLiveInvoicesOf?: (quoteId: string) => Promise<readonly string[]>): Promise<SalesQuote | null> {
    return this.deps.repo.transaction(async () => {
      const quote = (await this.deps.repo.list({ status: "converted" })).find((candidate) => candidate.convertedInvoiceId === invoiceId);
      if (!quote) return null;
      if (((await otherLiveInvoicesOf?.(quote.id)) ?? []).some((id) => id !== invoiceId)) return null;
      const reopened: SalesQuote = { ...quote, status: "accepted", convertedAt: null, convertedInvoiceId: null };
      await this.deps.repo.update(reopened);
      return reopened;
    });
  }

  // --- internals ---

  private buildDraft(cmd: CreateSalesQuoteCommand, taxRates: readonly TaxRate[] | null, vatOff: boolean): SalesQuote {
    const zeroRating: ZeroRating | null = vatOff
      ? { cause: ZeroRatingCause.VatOff }
      : cmd.customerTaxExempt === true
        ? { cause: ZeroRatingCause.ExemptCustomer, exemptionTaxRateId: cmd.customerTaxExemptionRateId ?? null }
        : null;
    const lines: SalesQuoteLine[] = cmd.lines.map((l) => {
      const tax = resolveDocumentLineTax(taxRates, l, { defaultPercent: 0, zeroRating });
      return {
        lineId: l.lineId,
        itemId: l.itemId,
        itemNameAr: l.itemNameAr,
        qty: l.qty,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent ?? 0,
        taxRatePercent: tax.taxRatePercent,
        taxRateId: tax.taxRateId,
      };
    });
    return {
      id: cmd.id,
      docType: "SALES_QUOTE",
      docNo: null,
      status: "draft",
      date: cmd.date,
      expiryDate: cmd.expiryDate,
      customerId: cmd.customerId,
      customerNameAr: cmd.customerNameAr,
      customerTaxExempt: cmd.customerTaxExempt ?? false,
      branchId: cmd.branchId,
      opportunityId: cmd.opportunityId ?? null,
      currency: cmd.currency ?? "EGP",
      notes: cmd.notes ?? null,
      internalNotes: cmd.internalNotes ?? null,
      discount: cmd.discount ?? { type: "amount", amount: Money.zero() },
      priceListId: cmd.priceListId ?? null,
      couponCode: cmd.couponCode ?? null,
      lines,
      createdAt: this.now(),
      sentAt: null,
      respondedAt: null,
      convertedAt: null,
      convertedInvoiceId: null,
    };
  }

  private validate(quote: SalesQuote): void {
    const reasons: string[] = [];
    if (quote.customerId.trim() === "") reasons.push("العميل مطلوب.");
    if (quote.branchId.trim() === "") reasons.push("الفرع مطلوب.");
    if (quote.lines.length === 0) reasons.push("العرض يتطلب بنداً واحداً على الأقل.");
    for (const line of quote.lines) {
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
    }
    if (reasons.length > 0) throw new InvalidSalesQuoteError(reasons);
  }

  private async require(id: string): Promise<SalesQuote> {
    const quote = await this.deps.repo.findById(id);
    if (!quote) throw new SalesQuoteNotFoundError(id);
    return quote;
  }
}
