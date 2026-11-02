/**
 * Purchase Return as a document-framework consumer (docs/archive/catalog/02
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

import { Money, Qty, allocate } from "../money/index.js";
import { extend } from "../inventory/wac-math.js";
import type { CostCategory } from "../contracting/cost-category.js";
import type { DocumentTypeDefinition, FrameworkDocument } from "../documents/document.js";
import { buildEffects, type DocumentEffects } from "../documents/effects.js";
import type { DocumentGlPosting, DocumentStockPlan } from "../documents/hooks.js";
import { InvalidDocumentError } from "../documents/errors.js";
import { assertReturnTotalsWithinAvailable, isStandingReturn } from "../documents/return-availability.js";
import { convertToBase } from "../exchange-rates/convert.js";

export const DOC_TYPE = "PURCHASE_RETURN";

/** docs/archive/catalog/02 §"السبب *" on the return form. */
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
  readonly sourceLineId?: string | null;
  readonly reason: PurchaseReturnReason;
  /** Originally invoiced qty still eligible to return (caller-computed: invoice qty − already returned). */
  readonly availableQty: Qty;
  readonly qty: Qty;
  /** The invoice line's unit cost — see the module doc-comment's simplifying assumption. */
  readonly unitCost: Money;
  readonly taxAmount: Money;
  /**
   * The VAT rate the source invoice line was charged at, carried onto the
   * return so the posting can tag the input-tax credit and its base with it.
   * Without it a mixed-rate return collapsed into one untagged credit and the
   * VAT return could only divide tax by base (D28, D76). Optional: a return
   * carrying none posts exactly the entry it always did.
   */
  readonly taxRatePercent?: number | null;
  readonly taxRateId?: string | null;
  /**
   * بُعد المشروع — every line of a confirmed return carries the same
   * document-wide value (D-01), the same convention as `sourceInvoiceId`.
   */
  readonly projectId?: string | null;
  /** فئة التكلفة — only meaningful with `projectId`. */
  readonly costCategory?: CostCategory | null;
  /** بُعد الفرع (DEC-20) — the source invoice's branch, stamped by the server from that invoice and never from the caller. */
  readonly branchId?: string | null;
  /**
   * The source invoice's currency and the rate it confirmed at, stamped by the
   * server from that invoice — never from the caller. `unitCost` and
   * `taxAmount` are in this currency; the return reverses them at this rate
   * (D203). Absent for a base-currency invoice.
   */
  readonly currency?: string | null;
  readonly fxRate?: string | null;
}

export type PurchaseReturnDocument = FrameworkDocument<PurchaseReturnLine>;

export interface PurchaseReturnGlAccounts {
  readonly accountsPayableId: string;
  readonly inputTaxPayableId: string;
  readonly inventoryAccountId: string;
  /**
   * Absorbs the difference between what the supplier credits (the invoice
   * price) and what the goods were actually carrying when they left stock
   * (the position's moving average).
   */
  readonly priceVarianceAccountId: string;
}

/**
 * One line's supplier credit and tax in BASE currency, converted per line at
 * the source invoice's rate — the one computation the posting and every
 * credit helper share, so the AP sub-ledger ties to 2100 to the last unit.
 */
export function purchaseReturnLineBase(line: PurchaseReturnLine): { readonly cost: Money; readonly tax: Money } {
  const cost = extend(line.qty, line.unitCost);
  if (!line.fxRate) return { cost, tax: line.taxAmount };
  return { cost: convertToBase(cost, line.fxRate), tax: convertToBase(line.taxAmount, line.fxRate) };
}

/** What ONE return line takes off its source invoice's payable, in base currency. */
export function purchaseReturnLineCredit(line: PurchaseReturnLine): Money {
  const { cost, tax } = purchaseReturnLineBase(line);
  return cost.add(tax);
}

function totals(lines: readonly PurchaseReturnLine[]) {
  const parts = lines.map(purchaseReturnLineBase);
  const costValue = Money.sum(parts.map((p) => p.cost));
  const taxValue = Money.sum(parts.map((p) => p.tax));
  return { costValue, taxValue, grandTotal: costValue.add(taxValue) };
}

/**
 * Confirmed purchase-return debit per SOURCE invoice, line by line, in base —
 * what 2100 was debited with against each invoice (D216). A reversal's
 * mirror undoes a return, so it is never counted as one.
 */
export function purchaseReturnCreditByInvoice(
  docs: readonly { readonly status: string; readonly reversesDocId?: string | null; readonly lines: readonly PurchaseReturnLine[] }[],
): ReadonlyMap<string, Money> {
  const byInvoice = new Map<string, Money>();
  for (const doc of docs) {
    if (!isStandingReturn(doc)) continue;
    for (const line of doc.lines) {
      if (!line.sourceInvoiceId) continue;
      byInvoice.set(line.sourceInvoiceId, (byInvoice.get(line.sourceInvoiceId) ?? Money.zero()).add(purchaseReturnLineCredit(line)));
    }
  }
  return byInvoice;
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
        throw new InvalidDocumentError(DOC_TYPE, doc.id, "المرتجع يتطلب بنداً واحداً على الأقل.", "A return needs at least one line.");
      }
      const invoiceId = doc.lines[0]?.sourceInvoiceId;
      for (const line of doc.lines) {
        if (line.sourceInvoiceId !== invoiceId) {
          throw new InvalidDocumentError(DOC_TYPE, doc.id, "كل بنود المرتجع يجب أن تنتمي لنفس الفاتورة.", "All return lines must belong to the same invoice.");
        }
        if ((line.fxRate ?? null) !== (doc.lines[0]?.fxRate ?? null)) {
          throw new InvalidDocumentError(DOC_TYPE, doc.id, "كل بنود المرتجع يجب أن تحمل سعر صرف الفاتورة نفسه.", "All return lines must carry the invoice's exchange rate.");
        }
        if (line.qty.isNegative() || line.qty.isZero()) {
          throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند الصنف "${line.itemId}": كمية الإرجاع يجب أن تكون أكبر من صفر.`, `Item "${line.itemId}": the return quantity must be greater than zero.`);
        }
        if (line.qty.compare(line.availableQty) > 0) {
          throw new InvalidDocumentError(
            DOC_TYPE,
            doc.id,
            `بند الصنف "${line.itemId}": كمية الإرجاع (${line.qty.toString()}) تتجاوز المتاح للإرجاع (${line.availableQty.toString()}).`, `Item "${line.itemId}": the return quantity (${line.qty.toString()}) exceeds the quantity available to return (${line.availableQty.toString()}).`,
          );
        }
        if (line.unitCost.scaled < 0n || line.taxAmount.scaled < 0n) {
          throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند الصنف "${line.itemId}": القيم المالية لا يمكن أن تكون سالبة.`, `Item "${line.itemId}": monetary values cannot be negative.`);
        }
        if ((line.projectId ?? null) !== (doc.lines[0]?.projectId ?? null)) {
          throw new InvalidDocumentError(DOC_TYPE, doc.id, "كل بنود المرتجع يجب أن تنتمي لنفس المشروع.", "All return lines must belong to the same project.");
        }
        if (line.costCategory && !line.projectId) {
          throw new InvalidDocumentError(
            DOC_TYPE,
            doc.id,
            `بند الصنف "${line.itemId}": فئة التكلفة تتطلب مشروعاً (projectId) على المرتجع.`, `Item "${line.itemId}": a cost category requires a project (projectId) on the return.`,
          );
        }
      }
      assertReturnTotalsWithinAvailable(DOC_TYPE, doc.id, doc.lines);
    },

    buildStockPlan(doc): DocumentStockPlan {
      const first = doc.lines[0] as PurchaseReturnLine;
      return {
        sourceDocType: DOC_TYPE,
        sourceDocId: doc.id,
        sourceDocNumber: doc.docNo,
        warehouseId: first.warehouseId,
        date: doc.date,
        lines: doc.lines.map((l) => ({ itemId: l.itemId, direction: "OUT" as const, qty: l.qty })),
      };
    },

    buildGlPosting(doc, stock): DocumentGlPosting | null {
      const { costValue, taxValue, grandTotal } = totals(doc.lines);
      if (grandTotal.scaled === 0n) return null;
      /**
       * Inventory is credited by what the STOCK LEDGER actually removed, not
       * by the invoice price on the line. The two differ whenever receipts
       * since the purchase have moved the item's moving average, and crediting
       * the invoice figure left the sub-ledger and the 1200 control account
       * permanently apart with nothing on screen showing it (D47).
       *
       * `stock.valueMoved` is negative here — the plan takes goods out — so
       * its magnitude is the credit. Falling back to `costValue` keeps the
       * entry balanced for callers that post no stock plan at all.
       */
      const removed = stock ? stock.valueMoved.negate() : costValue;
      const inventoryCredit = removed.scaled > 0n ? removed : costValue;
      // Supplier credit minus what actually left stock. Positive = the goods
      // were carrying less than the supplier refunds, so the difference is a
      // gain and the variance account is credited.
      const variance = Money.fromScaled(costValue.scaled - inventoryCredit.scaled);
      // Both the inventory relief and the variance are split across the rates
      // the source invoice lines carried, so `inventory + variance` per rate is
      // exactly the supplier credit at that rate — the input base the VAT
      // return needs. One untagged pair when no line carries a rate, which is
      // the entry this type always posted (D28, D76).
      type RateGroup = { readonly rate: number | null; readonly taxRateId: string | null; readonly base: Money; readonly tax: Money };
      const taxKeyOf = (l: PurchaseReturnLine): string => `${l.sourceInvoiceId}|${l.taxRatePercent ?? null}|${l.taxRateId ?? ""}`;
      const byRate = new Map<string, RateGroup>();
      for (const l of doc.lines) {
        const key = taxKeyOf(l);
        const slot = byRate.get(key) ?? { rate: l.taxRatePercent ?? null, taxRateId: l.taxRateId ?? null, base: Money.zero(), tax: Money.zero() };
        const part = purchaseReturnLineBase(l);
        byRate.set(key, { ...slot, base: slot.base.add(part.cost), tax: slot.tax.add(part.tax) });
      }
      const rates = [...byRate.values()];
      const weights = rates.map((r) => r.base.scaled);
      const splitByRate = (amount: Money): Money[] =>
        weights.some((w) => w > 0n) ? allocate(amount, weights) : rates.map(() => amount);
      // The variance (price-difference) account is never a cost-side line, so
      // it stays split by rate only, exactly as before.
      const varianceShares = splitByRate(variance);

      // The inventory credit IS a cost-side line, so it is ALSO tagged with
      // cost category (never the AP/VAT/variance lines): split a second time,
      // by (rate, costCategory), same largest-remainder rounding, so a
      // mixed-category return still reconciles exactly (D-01).
      const projectId = doc.lines[0]?.projectId ?? null;
      const first = doc.lines[0];
      const fxTag = first?.fxRate ? { currency: first.currency ?? null, fxRate: first.fxRate } : {};
      type RateCatGroup = { readonly rate: number | null; readonly taxRateId: string | null; readonly costCategory: CostCategory | null; readonly base: Money };
      const byRateAndCategory = new Map<string, RateCatGroup>();
      for (const l of doc.lines) {
        const rate = l.taxRatePercent ?? null;
        const costCategory = l.costCategory ?? null;
        const taxRateId = l.taxRateId ?? null;
        const key = `${taxKeyOf(l)}|${costCategory}`;
        const existing = byRateAndCategory.get(key);
        const base = purchaseReturnLineBase(l).cost;
        byRateAndCategory.set(key, { rate, taxRateId, costCategory, base: existing ? existing.base.add(base) : base });
      }
      const rcGroups = [...byRateAndCategory.values()];
      const rcWeights = rcGroups.map((g) => g.base.scaled);
      const inventoryRcShares = rcWeights.some((w) => w > 0n)
        ? allocate(inventoryCredit, rcWeights)
        : rcGroups.map(() => inventoryCredit);

      return {
        sourceDocType: DOC_TYPE,
        sourceDocId: doc.id,
        sourceDocNumber: doc.docNo,
        date: doc.date,
        memo: doc.memo || `مرتجع مشتريات ${doc.docNo ?? doc.id} — فاتورة ${doc.lines[0]?.sourceInvoiceNumber ?? doc.lines[0]?.sourceInvoiceId}`,
        lines: [
          { accountId: accounts.accountsPayableId, debit: grandTotal, credit: Money.zero(), ...fxTag },
          ...rates.flatMap(({ rate, taxRateId, tax }) =>
            tax.scaled > 0n
              ? [{ accountId: accounts.inputTaxPayableId, debit: Money.zero(), credit: tax, taxRatePercent: rate, taxRateId }]
              : [],
          ),
          ...rcGroups.flatMap((g, i) => {
            const share = inventoryRcShares[i] as Money;
            return share.scaled === 0n
              ? []
              : [{
                  accountId: accounts.inventoryAccountId,
                  debit: Money.zero(),
                  credit: share,
                  taxRatePercent: g.rate,
                  taxRateId: g.taxRateId,
                  ...(g.costCategory ? { costCategory: g.costCategory } : {}),
                }];
          }),
          ...rates.flatMap(({ rate, taxRateId }, i) => {
            const share = varianceShares[i] as Money;
            if (share.scaled === 0n) return [];
            return share.scaled > 0n
              ? [{ accountId: accounts.priceVarianceAccountId, debit: Money.zero(), credit: share, taxRatePercent: rate, taxRateId }]
              : [{ accountId: accounts.priceVarianceAccountId, debit: share.negate(), credit: Money.zero(), taxRatePercent: rate, taxRateId }];
          }),
        ].map((l) => ({ ...l, projectId, branchId: doc.lines[0]?.branchId ?? null })),
      };
    },

    describeEffects(doc): DocumentEffects {
      const { costValue, taxValue, grandTotal } = totals(doc.lines);
      const itemCount = new Set(doc.lines.map((l) => l.itemId)).size;
      return buildEffects({
        blocked: doc.lines.length === 0,
        blockedReason: doc.lines.length === 0 ? "لا يوجد بنود في المرتجع." : undefined,
        blockedReasonEn: doc.lines.length === 0 ? "The return has no lines." : undefined,
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
