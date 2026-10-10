/**
 * Landed Cost as a document-framework consumer (docs/archive/catalog/02
 * §"التكاليف الإضافية"): distributes freight/customs/insurance/etc across one
 * confirmed purchase invoice's item costs, raising their landed unit cost.
 *
 * Unlike sales/purchase returns this type declares NO `buildStockPlan` — a
 * landed-cost revaluation moves zero quantity (it raises the cost BASIS of
 * stock already received), which doesn't fit the framework's IN/OUT stock
 * hook. `LandedCostService` (service.ts) drives it instead: confirm via the
 * generic `DocumentService` (numbering + GL posting), then apply the
 * per-line revaluation via `StockLedgerService.applyLandedCostRevaluation`
 * (the one sanctioned exception to a cost layer's immutable unit cost).
 */

import { Money } from "../money/index.js";
import type { CostCategory } from "../contracting/cost-category.js";
import type { DocumentTypeDefinition, FrameworkDocument } from "../documents/document.js";
import { buildEffects, type DocumentEffects } from "../documents/effects.js";
import type { DocumentGlPosting } from "../documents/hooks.js";
import { InvalidDocumentError } from "../documents/errors.js";
import type { AllocatedLandedCostLine, LandedCostDistributionMethod, LandedCostItemEntry } from "./distribution.js";

export const DOC_TYPE = "LANDED_COST";

/** One allocated target line, denormalized with the (document-wide) cost breakdown + method it was allocated under. */
export interface LandedCostLine extends AllocatedLandedCostLine {
  readonly costItems: readonly LandedCostItemEntry[];
  readonly distributionMethod: LandedCostDistributionMethod;
}

export type LandedCostDocument = FrameworkDocument<LandedCostLine>;

export interface LandedCostGlAccounts {
  readonly inventoryAccountId: string;
  /**
   * Accrual account for the freight/customs vendor(s), settled by a separate
   * treasury voucher.
   *
   * It must NOT be the AP control account. It was 2100 — ذمم موردين تجاريين —
   * and a landed cost therefore credited the control account with no supplier
   * document behind it, so the AP sub-ledger and GL 2100 diverged by every
   * landed cost ever posted. That is one of the four zero-invariants the
   * product is sold on (D75).
   */
  readonly accruedLandedCostPayableId: string;
}

export function landedCostWarehouseId(lines: readonly LandedCostLine[]): string | null {
  const first = lines[0]?.warehouseId ?? null;
  return first !== null && lines.every((line) => line.warehouseId === first) ? first : null;
}

function totalAllocated(lines: readonly LandedCostLine[]): Money {
  return Money.sum(lines.map((l) => l.allocatedAmount));
}

export function createLandedCostDocumentType(
  accounts: LandedCostGlAccounts,
): DocumentTypeDefinition<LandedCostLine> {
  return {
    code: DOC_TYPE,
    labelAr: "تكلفة إضافية",
    confirmedStatus: "confirmed",
    numberingSequence: "LANDED_COST",
    gateActionType: "PURCHASE_LANDED_COST_CONFIRM",
    // No buildStockPlan — see module doc-comment; LandedCostService applies the
    // per-line revaluation itself after DocumentService.confirm() succeeds.

    validate(doc) {
      if (doc.lines.length === 0) {
        throw new InvalidDocumentError(DOC_TYPE, doc.id, "مستند التكلفة الإضافية يتطلب بنداً واحداً على الأقل.");
      }
      for (const line of doc.lines) {
        if (line.allocatedAmount.scaled <= 0n) {
          throw new InvalidDocumentError(
            DOC_TYPE,
            doc.id,
            `بند الصنف "${line.itemId}": المبلغ الموزّع يجب أن يكون أكبر من صفر.`,
          );
        }
        if ((line.projectId ?? null) !== (doc.lines[0]?.projectId ?? null)) {
          throw new InvalidDocumentError(DOC_TYPE, doc.id, "كل بنود مستند التكلفة الإضافية يجب أن تنتمي لنفس المشروع.");
        }
        if (line.costCategory && !line.projectId) {
          throw new InvalidDocumentError(
            DOC_TYPE,
            doc.id,
            `بند الصنف "${line.itemId}": فئة التكلفة تتطلب مشروعاً (projectId) على المستند.`,
          );
        }
      }
    },

    buildGlPosting(doc): DocumentGlPosting | null {
      const total = totalAllocated(doc.lines);
      if (total.scaled === 0n) return null;
      const projectId = doc.lines[0]?.projectId ?? null;
      // Landed cost absorbed into inventory carries the header projectId and
      // defaults to "materials" on the inventory debit — the document has no
      // per-category split (it is one aggregate absorption), so the debit
      // takes the first line's explicit category or "materials" (D-01).
      const costCategory: CostCategory = doc.lines.find((l) => l.costCategory)?.costCategory ?? "materials";
      return {
        sourceDocType: DOC_TYPE,
        sourceDocId: doc.id,
        sourceDocNumber: doc.docNo,
        date: doc.date,
        memo: doc.memo || `تكلفة إضافية ${doc.docNo ?? doc.id}`,
        warehouseId: landedCostWarehouseId(doc.lines),
        lines: [
          {
            accountId: accounts.inventoryAccountId,
            debit: total,
            credit: Money.zero(),
            projectId,
            ...(projectId ? { costCategory } : {}),
          },
          { accountId: accounts.accruedLandedCostPayableId, debit: Money.zero(), credit: total, projectId },
        ],
      };
    },

    describeEffects(doc): DocumentEffects {
      const total = totalAllocated(doc.lines);
      const itemCount = new Set(doc.lines.map((l) => l.itemId)).size;
      const method = doc.lines[0]?.distributionMethod;
      const methodAr = method === "BY_QUANTITY" ? "حسب الكمية" : "حسب القيمة";
      return buildEffects({
        blocked: doc.lines.length === 0,
        blockedReason: doc.lines.length === 0 ? "لا يوجد بنود لتوزيع التكلفة عليها." : undefined,
        effects: [
          {
            kind: "stock",
            description: `يرفع التكلفة الفعلية (landed cost) لـ ${itemCount} صنف`,
            detail: `توزيع ${methodAr} بإجمالي ${total.toString()}`,
          },
          {
            kind: "gl",
            description: "يزيد قيمة المخزون مقابل مستحق لجهة الشحن/الجمارك",
            detail: `مدين المخزون ${total.toString()}`,
          },
          {
            kind: "info",
            description: "سداد المبلغ لجهة الشحن/الجمارك يتم عبر سند صرف خزينة منفصل بعد التأكيد",
          },
        ],
      });
    },
  };
}
