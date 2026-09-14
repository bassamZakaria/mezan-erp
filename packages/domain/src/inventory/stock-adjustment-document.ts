/**
 * Stock Adjustment as a document-framework consumer (docs/archive/catalog/03
 * §"تسويات المخزون" — 8 reasons incl. INITIAL_STOCK opening balances). The
 * second module to prove the framework end to end (`journal-document.ts` was
 * the first).
 *
 * A stock adjustment moves quantity AND — when its reason's direction implies
 * a value change — value: Dr/Cr posting is computed by the stock-ledger engine
 * itself (`StockLedgerService.postAdjustment`'s `gl` option), not by a
 * standalone `buildGlPosting` hook, because an OUT line's value depends on the
 * moving-average cost AT THE TIME OF POSTING — state `describeEffects` (a pure
 * function of the document) cannot read. So this type declares `buildStockPlan`
 * only; the stock-hook adapter (`createInventoryOpsStockHook`, document-hooks.ts)
 * both applies the movements AND posts the balancing GL entry in one call to
 * the engine, reusing it wholesale instead of re-deriving WAC math here.
 *
 * All lines of one adjustment share one warehouse + one reason — carried
 * per-line (rather than adding header fields to the generic
 * `FrameworkDocument`) since the framework's envelope has no type-specific
 * header slot.
 */

import { Money, Qty } from "../money/index.js";
import type { DocumentTypeDefinition, FrameworkDocument } from "../documents/document.js";
import { buildEffects, type DocumentEffect } from "../documents/effects.js";
import { InvalidDocumentError } from "../documents/errors.js";
import { ADJUSTMENT_REASONS, getAdjustmentReasonDefinition, type AdjustmentReason } from "./reasons.js";
import type { StockMovementDirection } from "./movement.js";
import type { CostCategory } from "../contracting/cost-category.js";
import { extend } from "./wac-math.js";

/** One line of a stock-adjustment document. */
export interface StockAdjustmentDocLine {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly reason: AdjustmentReason;
  readonly direction: StockMovementDirection;
  readonly qty: Qty;
  /** Required for an IN line (receipt-time cost); ignored for OUT (moving average used at posting). */
  readonly unitCost?: Money;
  /**
   * بُعد المشروع — the contracting project this adjustment belongs to (D-01).
   * One project per adjustment, carried per-line (like `warehouseId`/`reason`
   * above) and validated uniform across lines — the framework envelope has no
   * type-specific header slot.
   */
  readonly projectId?: string | null;
  /** فئة التكلفة — only meaningful with `projectId`. One category per adjustment. */
  readonly costCategory?: CostCategory | null;
}

export type StockAdjustmentDocument = FrameworkDocument<StockAdjustmentDocLine>;

const DOC_TYPE = "STOCK_ADJUSTMENT";

/** The adjustment's shared header fields, read off line 0 (validated uniform across lines). */
export function adjustmentHeaderOf(doc: StockAdjustmentDocument): {
  warehouseId: string;
  reason: AdjustmentReason;
  projectId: string | null;
  costCategory: CostCategory | null;
} {
  const first = doc.lines[0];
  if (!first) throw new InvalidDocumentError(DOC_TYPE, doc.id, "التسوية تتطلب بنداً واحداً على الأقل.");
  return {
    warehouseId: first.warehouseId,
    reason: first.reason,
    projectId: first.projectId ?? null,
    costCategory: first.costCategory ?? null,
  };
}

/** The stock-adjustment document type definition. Plugs into {@link DocumentService}. */
export const stockAdjustmentDocumentType: DocumentTypeDefinition<StockAdjustmentDocLine> = {
  code: DOC_TYPE,
  labelAr: "تسوية مخزون",
  confirmedStatus: "confirmed",
  numberingSequence: "STOCK_ADJUSTMENT",
  gateActionType: "INVENTORY_ADJUSTMENT_CONFIRM",

  validate(doc) {
    const { lines } = doc;
    if (lines.length === 0) {
      throw new InvalidDocumentError(DOC_TYPE, doc.id, "التسوية تتطلب بنداً واحداً على الأقل.");
    }
    const { warehouseId, reason, projectId, costCategory } = adjustmentHeaderOf(doc);
    if (!ADJUSTMENT_REASONS.includes(reason)) {
      throw new InvalidDocumentError(DOC_TYPE, doc.id, `سبب تسوية غير معروف: "${reason}".`);
    }
    if (costCategory && !projectId) {
      throw new InvalidDocumentError(DOC_TYPE, doc.id, "فئة التكلفة تتطلب اختيار مشروع.");
    }
    const def = getAdjustmentReasonDefinition(reason);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as StockAdjustmentDocLine;
      if (line.warehouseId !== warehouseId) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند ${i}: كل بنود التسوية يجب أن تكون لنفس المستودع.`);
      }
      if (line.reason !== reason) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند ${i}: كل بنود التسوية يجب أن تحمل نفس السبب.`);
      }
      if ((line.projectId ?? null) !== projectId) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند ${i}: كل بنود التسوية يجب أن تحمل نفس المشروع.`);
      }
      if ((line.costCategory ?? null) !== costCategory) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند ${i}: كل بنود التسوية يجب أن تحمل نفس فئة التكلفة.`);
      }
      if (line.qty.isZero() || line.qty.isNegative()) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند ${i}: الكمية يجب أن تكون موجبة.`);
      }
      if (def.direction !== "EITHER" && line.direction !== def.direction) {
        throw new InvalidDocumentError(
          DOC_TYPE,
          doc.id,
          `بند ${i}: السبب "${def.labelAr}" يتطلب اتجاه ${def.direction === "IN" ? "زيادة" : "نقصان"}.`,
        );
      }
      if (line.direction === "IN" && !line.unitCost) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند ${i}: بند الزيادة يتطلب سعر تكلفة.`);
      }
    }
  },

  buildStockPlan(doc) {
    const { warehouseId, reason, projectId, costCategory } = adjustmentHeaderOf(doc);
    return {
      sourceDocType: "ADJUSTMENT",
      sourceDocId: doc.id,
      sourceDocNumber: doc.docNo,
      warehouseId,
      reason,
      projectId,
      costCategory,
      date: doc.date,
      lines: doc.lines.map((l) => ({
        itemId: l.itemId,
        direction: l.direction,
        qty: l.qty,
        unitCost: l.unitCost,
      })),
    };
  },

  describeEffects(doc) {
    if (doc.lines.length === 0) {
      return buildEffects({
        effects: [],
        blocked: true,
        blockedReason: "التسوية تتطلب بنداً واحداً على الأقل.",
      });
    }
    const { warehouseId, reason } = adjustmentHeaderOf(doc);
    const def = getAdjustmentReasonDefinition(reason);
    const inLines = doc.lines.filter((l) => l.direction === "IN");
    const outLines = doc.lines.filter((l) => l.direction === "OUT");
    const knownInValue = Money.sum(inLines.map((l) => (l.unitCost ? extend(l.qty, l.unitCost) : Money.zero())));

    // `key`/`params` are what the UI renders; `description`/`detail` stay as the
    // Arabic fallback for callers with no catalogue. The warehouse travels as an
    // ID and the value as an exact decimal STRING, because neither the tenant's
    // warehouse names nor the reader's number format belong to the domain (D48).
    const effects: DocumentEffect[] = [
      {
        kind: "stock",
        description: `يعدّل رصيد ${doc.lines.length} صنف في المستودع "${warehouseId}" (${def.labelAr})`,
        key: "docEffects.stockAdjustment.stock",
        params: { count: doc.lines.length, warehouseId, reasonAr: def.labelAr, reasonEn: def.labelEn },
        detail:
          inLines.length > 0 && outLines.length > 0
            ? `${inLines.length} بند زيادة، ${outLines.length} بند نقصان`
            : inLines.length > 0
              ? `${inLines.length} بند زيادة`
              : `${outLines.length} بند نقصان`,
        detailKey:
          inLines.length > 0 && outLines.length > 0
            ? "docEffects.stockAdjustment.linesBoth"
            : inLines.length > 0
              ? "docEffects.stockAdjustment.linesIn"
              : "docEffects.stockAdjustment.linesOut",
        detailParams: { inCount: inLines.length, outCount: outLines.length },
      },
      {
        kind: "gl",
        description: "يُنشئ قيداً محاسبياً موازناً لتغير قيمة المخزون (عند وجود فرق قيمة)",
        key: "docEffects.stockAdjustment.gl",
        detail:
          outLines.length > 0
            ? `قيمة بنود الزيادة المعروفة: ${knownInValue.toString()} — قيمة بنود النقصان تُحسب عند الترحيل بمتوسط التكلفة الحالي`
            : `${knownInValue.toString()}`,
        detailKey: outLines.length > 0 ? "docEffects.stockAdjustment.glDetailWithOut" : "docEffects.stockAdjustment.glDetail",
        detailParams: { value: knownInValue.toString() },
      },
    ];

    return buildEffects({ effects, blocked: false });
  },
};
