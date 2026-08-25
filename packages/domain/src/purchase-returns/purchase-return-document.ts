/**
 * Purchase Return as a document-framework consumer (docs/catalog/02
 * §"مرتجعات المشتريات"): goods returned to a supplier against a confirmed
 * purchase invoice — removes stock at its (immutable) receipt/moving-average
 * cost and reduces the supplier payable.
 *
 * SIMPLIFYING ASSUMPTION (documented, not hidden): a purchase invoice's line
 * price IS the item's landed cost basis at receipt time (no separate
 * price-variance account) — the same `unitCost` field drives both "how much
 * AP shrinks" and "how much inventory value the OUT movement removes" (the
 * stock hook itself always uses the position's live moving average for the
 * actual movement — see `stock-ledger-service.ts`'s OUT branch — so a stale
 * `unitCost` only affects the GL side here, not the physical stock math).
 */

import { Money, Qty } from "../money/index.js";
import { extend } from "../inventory/wac-math.js";
import type { DocumentTypeDefinition, FrameworkDocument } from "../documents/document.js";
import { buildEffects, type DocumentEffects } from "../documents/effects.js";
import type { DocumentGlPosting, DocumentStockPlan } from "../documents/hooks.js";
import { InvalidDocumentError } from "../documents/errors.js";

export const DOC_TYPE = "PURCHASE_RETURN";

/** docs/catalog/02 §"السبب *" on the return form. */
export const PURCHASE_RETURN_REASONS = [
  "DEFECTIVE",
  "WRONG_ITEM",
  "EXCESS_QTY",
  "QUALITY_ISSUE",
  "OTHER",
] as const;
export type PurchaseReturnReason = (typeof PURCHASE_RETURN_REASONS)[number];

export interface PurchaseReturnLine {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly supplierId: string;
  readonly sourceInvoiceId: string;
  readonly sourceInvoiceNumber: string | null;
  readonly reason: PurchaseReturnReason;
  /** Originally invoiced qty still eligible to return (caller-computed: invoice qty − already returned). */
  readonly availableQty: Qty;
  readonly qty: Qty;
  /** The invoice line's unit cost — see the module doc-comment's simplifying assumption. */
  readonly unitCost: Money;
  readonly taxAmount: Money;
}

export type PurchaseReturnDocument = FrameworkDocument<PurchaseReturnLine>;

export interface PurchaseReturnGlAccounts {
  readonly accountsPayableId: string;
  readonly inputTaxPayableId: string;
  readonly inventoryAccountId: string;
  /** Where the difference between the return price and the stock's moving average lands. */
  readonly costVarianceAccountId: string;
}

function totals(lines: readonly PurchaseReturnLine[]) {
  const costValue = Money.sum(lines.map((l) => extend(l.qty, l.unitCost)));
  const taxValue = Money.sum(lines.map((l) => l.taxAmount));
  return { costValue, taxValue, grandTotal: costValue.add(taxValue) };
}

/**
 * What a confirmed return takes OFF the supplier payable — the same figure its
 * GL posting debits to AP. Exported so the AP control-account reconciliation
 * can net returns out of the sub-ledger.
 */
export function purchaseReturnGrandTotal(doc: PurchaseReturnDocument): Money {
  return totals(doc.lines).grandTotal;
}

export function createPurchaseReturnDocumentType(
  accounts: PurchaseReturnGlAccounts,
): DocumentTypeDefinition<PurchaseReturnLine> {
  return {
    code: DOC_TYPE,
    labelAr: "مرتجع مشتريات",
    confirmedStatus: "confirmed",
    numberingSequence: "PURCHASE_RETURN",
    gateActionType: "PURCHASE_RETURN_CONFIRM",

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
        if (line.unitCost.scaled < 0n || line.taxAmount.scaled < 0n) {
          throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند الصنف "${line.itemId}": القيم المالية لا يمكن أن تكون سالبة.`);
        }
      }
    },

    buildStockPlan(doc): DocumentStockPlan {
      const first = doc.lines[0] as PurchaseReturnLine;
      return {
        sourceDocType: DOC_TYPE,
        sourceDocId: doc.id,
        sourceDocNumber: doc.docNo,
        warehouseId: first.warehouseId,
        lines: doc.lines.map((l) => ({ itemId: l.itemId, direction: "OUT" as const, qty: l.qty })),
      };
    },

    buildGlPosting(doc, stock): DocumentGlPosting | null {
      const { costValue, taxValue, grandTotal } = totals(doc.lines);
      if (grandTotal.scaled === 0n) return null;
      // Stock leaves at the MOVING AVERAGE, which is not the price on the
      // return line once the position has been re-costed (a landed cost, a
      // later receipt at another price). Crediting inventory by the document's
      // own figure left the sub-ledger permanently adrift from GL 1200 by the
      // difference; the difference is a real cost variance and gets its own
      // line, so the entry still balances to the supplier's grand total.
      const stockValue = stock ? Money.fromScaled(-stock.netValue.scaled) : costValue;
      const variance = Money.fromScaled(costValue.scaled - stockValue.scaled);
      return {
        sourceDocType: DOC_TYPE,
        sourceDocId: doc.id,
        sourceDocNumber: doc.docNo,
        date: doc.date,
        memo: doc.memo || `مرتجع مشتريات ${doc.docNo ?? doc.id} — فاتورة ${doc.lines[0]?.sourceInvoiceNumber ?? doc.lines[0]?.sourceInvoiceId}`,
        lines: [
          { accountId: accounts.accountsPayableId, debit: grandTotal, credit: Money.zero() },
          ...(taxValue.scaled > 0n
            ? [{ accountId: accounts.inputTaxPayableId, debit: Money.zero(), credit: taxValue }]
            : []),
          { accountId: accounts.inventoryAccountId, debit: Money.zero(), credit: stockValue },
          ...(variance.scaled === 0n
            ? []
            : variance.scaled > 0n
              ? [{ accountId: accounts.costVarianceAccountId, debit: Money.zero(), credit: variance }]
              : [{ accountId: accounts.costVarianceAccountId, debit: Money.fromScaled(-variance.scaled), credit: Money.zero() }]),
        ],
      };
    },

    describeEffects(doc): DocumentEffects {
      const { costValue, taxValue, grandTotal } = totals(doc.lines);
      const itemCount = new Set(doc.lines.map((l) => l.itemId)).size;
      return buildEffects({
        blocked: doc.lines.length === 0,
        blockedReason: doc.lines.length === 0 ? "لا يوجد بنود في المرتجع." : undefined,
        effects: [
          {
            kind: "stock",
            description: `يخصم ${itemCount} صنف من المخزون`,
            detail: `بقيمة ${costValue.toString()}`,
          },
          {
            kind: "balance",
            description: "يخفّض مديونية المنشأة للمورد (حساب الموردين)",
            detail: `بمبلغ ${grandTotal.toString()}${taxValue.scaled > 0n ? ` (شامل ضريبة ${taxValue.toString()})` : ""}`,
          },
          {
            kind: "gl",
            description: "قيد محاسبي عكسي: يخفّض المخزون والمستحق للمورد",
          },
          {
            kind: "info",
            description: "قد ينتج عن المرتجع رصيد مستحق من المورد — بانتظار استلام المبلغ عبر سند قبض خزينة منفصل",
          },
        ],
      });
    },
  };
}
