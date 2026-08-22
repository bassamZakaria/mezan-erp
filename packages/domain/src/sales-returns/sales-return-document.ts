/**
 * Sales Return as a document-framework consumer (docs/catalog/01
 * §"مرتجعات المبيعات"): a return processed against a specific confirmed sales
 * invoice — restocks inventory at the invoice line's cost and reduces the
 * customer's receivable; it never auto-refunds cash (a separate treasury
 * disbursement voucher does that, out of this PR's scope — see
 * {@link isAwaitingRefund}).
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

export const DOC_TYPE = "SALES_RETURN";

/** docs/catalog/01 §"سبب الإرجاع *" — the closed reason enum on the return form. */
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
  readonly reason: SalesReturnReason;
  /** Originally invoiced qty still eligible to return (caller-computed: invoice qty − already returned). */
  readonly availableQty: Qty;
  readonly qty: Qty;
  readonly unitPrice: Money;
  readonly unitCost: Money;
  /** Proportional tax on this line's returned qty (0 if the item/customer is tax-exempt). */
  readonly taxAmount: Money;
}

export type SalesReturnDocument = FrameworkDocument<SalesReturnLine>;

/** GL account mapping the return posts against (tenant-level config, docs/catalog/04 GL mapping). */
export interface SalesReturnGlAccounts {
  readonly accountsReceivableId: string;
  readonly salesReturnsAccountId: string;
  readonly outputTaxPayableAccountId: string;
  readonly inventoryAccountId: string;
  readonly cogsAccountId: string;
}

function totals(lines: readonly SalesReturnLine[]) {
  const revenueValue = Money.sum(lines.map((l) => extend(l.qty, l.unitPrice)));
  const costValue = Money.sum(lines.map((l) => extend(l.qty, l.unitCost)));
  const taxValue = Money.sum(lines.map((l) => l.taxAmount));
  return { revenueValue, costValue, taxValue, grandTotal: revenueValue.add(taxValue) };
}

/** A confirmed return is always بانتظار دفع المبلغ (awaiting a manual cash refund) — no auto-refund in this PR. */
export function isAwaitingRefund(doc: SalesReturnDocument): boolean {
  return doc.status === "confirmed";
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
      const lines = [
        { accountId: accounts.salesReturnsAccountId, debit: revenueValue, credit: Money.zero() },
        ...(taxValue.scaled > 0n
          ? [{ accountId: accounts.outputTaxPayableAccountId, debit: taxValue, credit: Money.zero() }]
          : []),
        { accountId: accounts.accountsReceivableId, debit: Money.zero(), credit: grandTotal },
      ];
      const stockLines =
        costValue.scaled > 0n
          ? [
              { accountId: accounts.inventoryAccountId, debit: costValue, credit: Money.zero() },
              { accountId: accounts.cogsAccountId, debit: Money.zero(), credit: costValue },
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
