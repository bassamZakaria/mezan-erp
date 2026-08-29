/**
 * Stock Transfer as a document-framework consumer (docs/archive/catalog/03
 * §"تحويلات المخزون" — valuation-neutral, one-way confirm; "لا يمكن إلغاء
 * تحويل مؤكد ... لعكس الحركة أنشئ تحويلاً جديداً بالاتجاه المعاكس").
 *
 * A transfer never posts to the GL (issues from the source at its moving
 * average and receives into the destination at that SAME unit cost, so total
 * system inventory value is unchanged — `StockLedgerService.postTransfer`
 * enforces this). It declares `buildStockPlan` only; no `buildGlPosting`.
 *
 * All lines of one transfer share one source + one destination warehouse —
 * carried per-line (see stock-adjustment-document.ts for why: the generic
 * `FrameworkDocument` envelope has no type-specific header slot).
 */

import type { Qty } from "../money/index.js";
import type { DocumentTypeDefinition, FrameworkDocument } from "../documents/document.js";
import { buildEffects } from "../documents/effects.js";
import { InvalidDocumentError } from "../documents/errors.js";

/** One line of a stock-transfer document. */
export interface StockTransferDocLine {
  readonly itemId: string;
  readonly fromWarehouseId: string;
  readonly toWarehouseId: string;
  readonly qty: Qty;
}

export type StockTransferDocument = FrameworkDocument<StockTransferDocLine>;

const DOC_TYPE = "STOCK_TRANSFER";

/** The transfer's shared header fields, read off line 0 (validated uniform across lines). */
export function transferHeaderOf(doc: StockTransferDocument): {
  fromWarehouseId: string;
  toWarehouseId: string;
} {
  const first = doc.lines[0];
  if (!first) throw new InvalidDocumentError(DOC_TYPE, doc.id, "التحويل يتطلب بنداً واحداً على الأقل.");
  return { fromWarehouseId: first.fromWarehouseId, toWarehouseId: first.toWarehouseId };
}

/** The stock-transfer document type definition. Plugs into {@link DocumentService}. */
export const stockTransferDocumentType: DocumentTypeDefinition<StockTransferDocLine> = {
  code: DOC_TYPE,
  labelAr: "تحويل مخزون",
  confirmedStatus: "confirmed",
  numberingSequence: "STOCK_TRANSFER",
  gateActionType: "INVENTORY_TRANSFER_CONFIRM",

  validate(doc) {
    const { lines } = doc;
    if (lines.length === 0) {
      throw new InvalidDocumentError(DOC_TYPE, doc.id, "التحويل يتطلب بنداً واحداً على الأقل.");
    }
    const { fromWarehouseId, toWarehouseId } = transferHeaderOf(doc);
    if (fromWarehouseId === toWarehouseId) {
      throw new InvalidDocumentError(DOC_TYPE, doc.id, "يجب أن يختلف مستودع المصدر عن مستودع الوجهة.");
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as StockTransferDocLine;
      if (line.fromWarehouseId !== fromWarehouseId || line.toWarehouseId !== toWarehouseId) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند ${i}: كل بنود التحويل يجب أن تكون بين نفس المستودعين.`);
      }
      if (line.qty.isZero() || line.qty.isNegative()) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, `بند ${i}: الكمية يجب أن تكون موجبة.`);
      }
    }
  },

  buildStockPlan(doc) {
    const { fromWarehouseId, toWarehouseId } = transferHeaderOf(doc);
    return {
      sourceDocType: "TRANSFER",
      sourceDocId: doc.id,
      sourceDocNumber: doc.docNo,
      warehouseId: fromWarehouseId,
      toWarehouseId,
      date: doc.date,
      lines: doc.lines.map((l) => ({
        itemId: l.itemId,
        direction: "OUT" as const, // unused by the transfer branch of the stock hook — itemId/qty only
        qty: l.qty,
      })),
    };
  },

  describeEffects(doc) {
    if (doc.lines.length === 0) {
      return buildEffects({
        effects: [],
        blocked: true,
        blockedReason: "التحويل يتطلب بنداً واحداً على الأقل.",
      });
    }
    const { fromWarehouseId, toWarehouseId } = transferHeaderOf(doc);
    return buildEffects({
      effects: [
        {
          kind: "stock",
          description: `ينقل ${doc.lines.length} صنف من المستودع "${fromWarehouseId}" إلى المستودع "${toWarehouseId}"`,
          // The ids travel; the UI resolves them to the tenant's own warehouse
          // names, which the domain has no way to know (D48).
          key: "docEffects.stockTransfer.stock",
          params: { count: doc.lines.length, fromWarehouseId, toWarehouseId },
        },
        {
          kind: "info",
          description: "لا يتغير إجمالي قيمة المخزون",
          key: "docEffects.stockTransfer.value",
          detail: "التحويل ينقل الكمية بين المواقع فقط، بنفس متوسط تكلفة المصدر — لا أثر محاسبي.",
          detailKey: "docEffects.stockTransfer.valueDetail",
        },
      ],
      blocked: false,
    });
  },
};
