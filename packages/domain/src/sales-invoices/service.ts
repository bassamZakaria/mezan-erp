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
import { recordSensitiveEvent, type AuditSink } from "../audit/index.js";
import type {
  DocumentGlHook,
  DocumentNumberingHook,
  DocumentWorkflowGate,
  DocumentEventPublisher,
} from "../documents/hooks.js";
import type { GateableActionType } from "../workflow/index.js";
import { SALES_INVOICE_STATUS_LABELS_AR } from "./sales-invoice.js";
import type {
  SalesInvoice,
  SalesInvoiceDiscount,
  SalesInvoiceLine,
  SalesInvoiceStatus,
} from "./sales-invoice.js";
import { assertTransition } from "./status.js";
import { computeInvoiceTotals, type SalesInvoiceTotals } from "./totals.js";
import { describeSalesInvoiceEffects } from "./effects.js";
import { buildSalesInvoiceGlPosting, type SalesInvoiceCogsLine } from "./gl.js";
import type {
  SalesInvoiceRepository,
  SalesInvoiceListFilter,
  SalesInvoiceStockHook,
} from "./ports.js";
import {
  DuplicateSalesInvoiceError,
  InvalidSalesInvoiceError,
  InvalidSalesInvoicePaymentError,
  SalesInvoiceNotFoundError,
} from "./errors.js";

/** The workflow action gated on confirm (docs/catalog/09). */
const GATE_ACTION: GateableActionType = "SALES_INVOICE_CONFIRM";

export interface SalesInvoiceServiceDeps {
  readonly repo: SalesInvoiceRepository;
  readonly numbering: DocumentNumberingHook;
  readonly gl: DocumentGlHook;
  readonly stock: SalesInvoiceStockHook;
  /** Optional approval gate; when omitted, confirmation is never held. */
  readonly workflow?: DocumentWorkflowGate;
  readonly audit?: AuditSink;
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
}

export class SalesInvoiceService {
  constructor(private readonly deps: SalesInvoiceServiceDeps) {}

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }

  /** Totals for an invoice, honouring the customer's tax-exempt flag. */
  totalsOf(invoice: SalesInvoice): SalesInvoiceTotals {
    return computeInvoiceTotals(invoice.lines, invoice.discount, {
      taxExempt: invoice.customerTaxExempt,
    });
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
        assertTransition(id, existing.status, "pending");
        const held: SalesInvoice = {
          ...existing,
          status: "pending",
          workflowRequestId: decision.requestId,
        };
        await this.deps.repo.update(held);
        this.emit("DOCUMENT_SUBMITTED", held);
        return { invoice: held, held: true };
      }
    }

    assertTransition(id, existing.status, "confirmed");
    const totals = this.totalsOf(existing);

    const confirmed = await this.deps.repo.transaction(async () => {
      const number = await this.deps.numbering.next();
      const docNo = number.formatted;
      const occurredAt = this.now();

      // Issue stock OUT for stock lines; capture the moving-average cost.
      const stockLines = existing.lines.filter((l) => l.isStock);
      let costByLineId = new Map<string, Money>();
      if (stockLines.length > 0) {
        const result = await this.deps.stock.issue({
          issueId: existing.id,
          sourceDocId: existing.id,
          sourceDocNumber: docNo,
          warehouseId: existing.warehouseId,
          occurredAt,
          lines: stockLines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
        });
        costByLineId = new Map(stockLines.map((l, i) => [l.lineId, result.lines[i]?.cost ?? Money.zero()]));
      }

      // Capture unit costs onto lines + build the COGS side of the entry.
      const linesWithCost: SalesInvoiceLine[] = existing.lines.map((l) => {
        if (!l.isStock) return l;
        const cost = costByLineId.get(l.lineId) ?? Money.zero();
        const unitCost = l.qty.scaled === 0n ? Money.zero() : divCost(cost, l.qty);
        return { ...l, unitCost };
      });
      const cogsLines: SalesInvoiceCogsLine[] = existing.lines
        .filter((l) => l.isStock && l.cogsAccountId && l.inventoryAccountId)
        .map((l) => ({
          cogsAccountId: l.cogsAccountId as string,
          inventoryAccountId: l.inventoryAccountId as string,
          cost: costByLineId.get(l.lineId) ?? Money.zero(),
        }));

      const numbered: SalesInvoice = { ...existing, docNo, lines: linesWithCost };
      const posting = buildSalesInvoiceGlPosting(numbered, totals, cogsLines);
      const glResult = await this.deps.gl.post(posting);

      const next: SalesInvoice = {
        ...numbered,
        status: "confirmed",
        confirmedAt: occurredAt,
        journalEntryId: glResult.journalEntryId,
        workflowRequestId: null,
      };
      await this.deps.repo.update(next);
      return next;
    });

    await this.recordAudit("CONFIRM", confirmed, "INFO");
    this.emit("DOCUMENT_CONFIRMED", confirmed);
    return { invoice: confirmed, held: false };
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
      currency: cmd.currency ?? "EGP",
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
