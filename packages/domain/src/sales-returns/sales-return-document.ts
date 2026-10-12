/**
 * Sales Return as a document-framework consumer (docs/archive/catalog/01
 * §"مرتجعات المبيعات"): a return processed against a specific confirmed sales
 * invoice — restocks inventory at the invoice line's cost and reduces the
 * customer's receivable; it never auto-refunds cash. Paying the credit note
 * out is a separate treasury disbursement — see `./refund.ts`.
 *
 * The sales-invoices module (Phase 5/6, landing in a parallel PR) is NOT a
 * hard dependency here: a return's line already carries the invoice-line
 * snapshot it needs (price, cost, tax, already-returned qty) — see
 * `ports.ts` for the seam a real invoice lookup plugs into. This file only
 * builds the `DocumentTypeDefinition`; it never imports a sales-invoice type.
 */

import { Money, Qty } from "../money/index.js";
import { extend } from "../inventory/wac-math.js";
import type { DocumentTypeDefinition, FrameworkDocument } from "../documents/document.js";
import { buildEffects, type DocumentEffects } from "../documents/effects.js";
import type { DocumentGlPosting, DocumentStockPlan } from "../documents/hooks.js";
import { InvalidDocumentError } from "../documents/errors.js";
import { assertReturnTotalsWithinAvailable, isStandingReturn } from "../documents/return-availability.js";
import { convertToBase } from "../exchange-rates/convert.js";

export const DOC_TYPE = "SALES_RETURN";

/** docs/archive/catalog/01 §"سبب الإرجاع *" — the closed reason enum on the return form. */
export const SALES_RETURN_REASONS = [
  "DEFECTIVE",
  "WRONG_ITEM",
  "EXCESS_QTY",
  "CHANGED_MIND",
  "OTHER",
] as const;
export type SalesReturnReason = (typeof SALES_RETURN_REASONS)[number];

/**
 * One return line. Denormalized on purpose: `FrameworkDocument.lines` is the
 * ONLY per-instance data slot the framework gives a concrete type (there is no
 * separate "header" slot), so document-wide fields (warehouse, customer,
 * source invoice) are repeated per line — see `document.ts`'s doc comment.
 * `unitPrice`/`taxAmount` are what reduces the receivable; `unitCost` is what
 * restocks inventory — they intentionally differ (retail margin).
 */
export interface SalesReturnLine {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly customerId: string;
  readonly sourceInvoiceId: string;
  readonly sourceInvoiceNumber: string | null;
  readonly sourceLineId?: string | null;
  readonly reason: SalesReturnReason;
  /** Originally invoiced qty still eligible to return (caller-computed: invoice qty − already returned). */
  readonly availableQty: Qty;
  readonly qty: Qty;
  readonly unitPrice: Money;
  readonly unitCost: Money;
  /** Proportional tax on this line's returned qty (0 if the item/customer is tax-exempt). */
  readonly taxAmount: Money;
  /**
   * The VAT rate the source invoice line charged, carried onto the return so
   * the posting can tag both the credit and its base with it. Without it a
   * mixed-rate return collapsed into one untagged VAT line and the VAT return
   * could only divide tax by base, inventing a rate nobody charged (D28, D76).
   * Optional: a return created before the dimension existed carries none and
   * posts exactly the entry it always did.
   */
  readonly taxRatePercent?: number | null;
  readonly taxRateId?: string | null;
  /**
   * بُعد المشروع, inherited from the source invoice's own `projectId` (a
   * return built via `/from-invoice` copies it straight off the invoice; one
   * built via the raw `POST /` shape may state it directly). Optional: a
   * return against an invoice raised before the dimension existed carries
   * none, same as `taxRatePercent`.
   */
  readonly projectId?: string | null;
  /**
   * The source invoice's currency and the rate it confirmed at, stamped by the
   * server from that invoice — never from the caller. `unitPrice` and
   * `taxAmount` are in this currency; the return reverses them at this rate
   * (D203). `unitCost` is the captured stock cost and is already base. Absent
   * for a base-currency invoice.
   */
  readonly currency?: string | null;
  readonly fxRate?: string | null;
}

export type SalesReturnDocument = FrameworkDocument<SalesReturnLine>;

/** GL account mapping the return posts against (tenant-level config, docs/archive/catalog/04 GL mapping). */
export interface SalesReturnGlAccounts {
  readonly accountsReceivableId: string;
  readonly salesReturnsAccountId: string;
  readonly outputTaxPayableAccountId: string;
  readonly inventoryAccountId: string;
  readonly cogsAccountId: string;
}

/**
 * One line's revenue and tax in BASE currency, converted per line at the
 * source invoice's rate — the one computation the posting and every credit
 * helper share, so the AR sub-ledger ties to 1105 to the last unit.
 */
export function salesReturnLineBase(line: SalesReturnLine): { readonly revenue: Money; readonly tax: Money } {
  const revenue = extend(line.qty, line.unitPrice);
  if (!line.fxRate) return { revenue, tax: line.taxAmount };
  return { revenue: convertToBase(revenue, line.fxRate), tax: convertToBase(line.taxAmount, line.fxRate) };
}

function totals(lines: readonly SalesReturnLine[]) {
  const parts = lines.map(salesReturnLineBase);
  const revenueValue = Money.sum(parts.map((p) => p.revenue));
  const costValue = Money.sum(lines.map((l) => extend(l.qty, l.unitCost)));
  const taxValue = Money.sum(parts.map((p) => p.tax));
  return { revenueValue, costValue, taxValue, grandTotal: revenueValue.add(taxValue) };
}

/**
 * What a confirmed return takes OFF the customer's receivable — the same figure
 * its GL posting credits to AR. Exported so the AR control-account
 * reconciliation can net returns out of the sub-ledger; without it the GL moves
 * and the sub-ledger does not.
 */
export function salesReturnGrandTotal(doc: SalesReturnDocument): Money {
  return totals(doc.lines).grandTotal;
}

/**
 * What ONE return line takes off its own source invoice. A return document may
 * carry lines from several invoices, so the per-invoice credit is a line-level
 * figure, not the document's grand total.
 */
export function salesReturnLineCredit(line: SalesReturnLine): Money {
  const { revenue, tax } = salesReturnLineBase(line);
  return revenue.add(tax);
}

/** Confirmed-return credit per source invoice — what each invoice's remaining balance must net off. */
export function salesReturnCreditByInvoice(
  docs: readonly SalesReturnDocument[],
): ReadonlyMap<string, Money> {
  const byInvoice = new Map<string, Money>();
  for (const doc of docs) {
    if (!isStandingReturn(doc)) continue;
    for (const line of doc.lines) {
      const current = byInvoice.get(line.sourceInvoiceId) ?? Money.zero();
      byInvoice.set(line.sourceInvoiceId, current.add(salesReturnLineCredit(line)));
    }
  }
  return byInvoice;
}


export function createSalesReturnDocumentType(
  accounts: SalesReturnGlAccounts,
): DocumentTypeDefinition<SalesReturnLine> {
  return {
    code: DOC_TYPE,
    labelAr: "مرتجع مبيعات",
    confirmedStatus: "confirmed",
    numberingSequence: "SALES_RETURN",
    gateActionType: "SALES_RETURN_CONFIRM",

    validate(doc) {
      if (doc.lines.length === 0) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, "المرتجع يتطلب بنداً واحداً على الأقل.");
      }
      const invoiceId = doc.lines[0]?.sourceInvoiceId;
      for (const line of doc.lines) {
        if (line.sourceInvoiceId !== invoiceId) {
          throw new InvalidDocumentError(DOC_TYPE, doc.id, "كل بنود المرتجع يجب أن تنتمي لنفس الفاتورة.");
        }
        if ((line.fxRate ?? null) !== (doc.lines[0]?.fxRate ?? null)) {
          throw new InvalidDocumentError(DOC_TYPE, doc.id, "كل بنود المرتجع يجب أن تحمل سعر صرف الفاتورة نفسه.");
        }
        if (line.qty.isNegative() || line.qty.isZero()) {
          throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند الصنف "${line.itemId}": كمية الإرجاع يجب أن تكون أكبر من صفر.`);
        }
        if (line.qty.compare(line.availableQty) > 0) {
          throw new InvalidDocumentError(
            DOC_TYPE,
            doc.id,
            `بند الصنف "${line.itemId}": كمية الإرجاع (${line.qty.toString()}) تتجاوز المتاح للإرجاع (${line.availableQty.toString()}).`,
          );
        }
        if (line.unitPrice.scaled < 0n || line.unitCost.scaled < 0n || line.taxAmount.scaled < 0n) {
          throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند الصنف "${line.itemId}": القيم المالية لا يمكن أن تكون سالبة.`);
        }
      }
      assertReturnTotalsWithinAvailable(DOC_TYPE, doc.id, doc.lines);
    },

    buildStockPlan(doc): DocumentStockPlan {
      const first = doc.lines[0] as SalesReturnLine;
      return {
        sourceDocType: DOC_TYPE,
        sourceDocId: doc.id,
        sourceDocNumber: doc.docNo,
        warehouseId: first.warehouseId,
        lines: doc.lines.map((l) => ({
          itemId: l.itemId,
          direction: "IN" as const,
          qty: l.qty,
          unitCost: l.unitCost,
        })),
      };
    },

    buildGlPosting(doc): DocumentGlPosting | null {
      const { revenueValue, costValue, taxValue, grandTotal } = totals(doc.lines);
      if (grandTotal.scaled === 0n) return null;
      // Every line of the return validates against ONE source invoice
      // (`validate` above), so its projectId — inherited from that invoice —
      // is the same on every line; the first line's is the document's.
      const projectId = doc.lines[0]?.projectId ?? null;
      // Grouped by source invoice and the rate its line charged, so a return
      // posts one base line and one VAT line PER (INVOICE, RATE) — each
      // invoice's lines can then be classified without the other's. The VAT return
      // reports the rates actually charged, and it can only do that if the
      // ledger recorded them (D28, D76). Lines carrying no rate group under
      // `null` and post the single untagged pair they always did.
      const byRate = new Map<string, { rate: number | null; taxRateId: string | null; base: Money; tax: Money }>();
      for (const l of doc.lines) {
        const rate = l.taxRatePercent ?? null;
        const taxRateId = l.taxRateId ?? null;
        const key = `${l.sourceInvoiceId}|${rate}|${taxRateId ?? ""}`;
        const slot = byRate.get(key) ?? { rate, taxRateId, base: Money.zero(), tax: Money.zero() };
        const part = salesReturnLineBase(l);
        byRate.set(key, { ...slot, base: slot.base.add(part.revenue), tax: slot.tax.add(part.tax) });
      }
      const first = doc.lines[0];
      const fxTag = first?.fxRate ? { currency: first.currency ?? null, fxRate: first.fxRate } : {};
      const lines = [
        ...[...byRate.values()]
          .filter((v) => v.base.scaled !== 0n)
          .map((v) => ({
            accountId: accounts.salesReturnsAccountId,
            debit: v.base,
            credit: Money.zero(),
            taxRatePercent: v.rate,
            taxRateId: v.taxRateId,
            projectId,
          })),
        ...[...byRate.values()]
          .filter((v) => v.tax.scaled > 0n)
          .map((v) => ({
            accountId: accounts.outputTaxPayableAccountId,
            debit: v.tax,
            credit: Money.zero(),
            taxRatePercent: v.rate,
            taxRateId: v.taxRateId,
            projectId,
          })),
        { accountId: accounts.accountsReceivableId, debit: Money.zero(), credit: grandTotal, projectId, ...fxTag },
      ];

      const stockLines =
        costValue.scaled > 0n
          ? [
              { accountId: accounts.inventoryAccountId, debit: costValue, credit: Money.zero(), projectId },
              { accountId: accounts.cogsAccountId, debit: Money.zero(), credit: costValue, projectId },
            ]
          : [];
      return {
        sourceDocType: DOC_TYPE,
        sourceDocId: doc.id,
        sourceDocNumber: doc.docNo,
        date: doc.date,
        memo: doc.memo || `مرتجع مبيعات ${doc.docNo ?? doc.id} — فاتورة ${doc.lines[0]?.sourceInvoiceNumber ?? doc.lines[0]?.sourceInvoiceId}`,
        lines: [...lines, ...stockLines],
      };
    },

    describeEffects(doc): DocumentEffects {
      const { revenueValue, costValue, taxValue, grandTotal } = totals(doc.lines);
      const itemCount = new Set(doc.lines.map((l) => l.itemId)).size;
      return buildEffects({
        blocked: doc.lines.length === 0,
        blockedReason: doc.lines.length === 0 ? "لا يوجد بنود في المرتجع." : undefined,
        effects: [
          {
            kind: "stock",
            description: `يعيد ${itemCount} صنف إلى المخزون`,
            detail: `بتكلفة إجمالية ${costValue.toString()}`,
          },
          {
            kind: "balance",
            description: "يخفّض مديونية العميل (حساب العملاء)",
            detail: `بمبلغ ${grandTotal.toString()}${taxValue.scaled > 0n ? ` (شامل ضريبة ${taxValue.toString()})` : ""}`,
          },
          {
            kind: "gl",
            description: "قيد محاسبي عكسي: عكس الإيراد والتكلفة المسجلة على الفاتورة الأصلية",
            detail: `مردودات مبيعات ${revenueValue.toString()} / تكلفة بضاعة مباعة ${costValue.toString()}`,
          },
          {
            kind: "info",
            description: "المرتجع لا يعني استرداد المبلغ تلقائياً — بانتظار دفع المبلغ عبر سند صرف خزينة منفصل",
          },
        ],
      });
    },
  };
}
