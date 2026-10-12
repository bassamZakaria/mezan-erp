/** Errors raised by the landed-cost allocation math (docs/archive/catalog/02 §"التكاليف الإضافية"). */

const LANDED_COST_METHOD_AR: Readonly<Record<string, string>> = {
  BY_VALUE: "حسب القيمة",
  BY_QUANTITY: "حسب الكمية",
  BY_WEIGHT: "حسب الوزن",
};

function landedCostMethodAr(method: string): string {
  return LANDED_COST_METHOD_AR[method] ?? method;
}

export class EmptyLandedCostTargetsError extends Error {
  readonly code = "EMPTY_LANDED_COST_TARGETS";
  readonly messageEn: string;
  constructor() {
    super("مستند التكلفة الإضافية يحتاج بند فاتورة هدف واحداً على الأقل لتوزيع التكلفة عليه.");
    this.messageEn = "A landed-cost document needs at least one target invoice line to distribute cost onto.";
    this.name = "EmptyLandedCostTargetsError";
  }
}

/** Raised when every target's weight is zero (e.g. BY_QUANTITY with all-zero qty) — nothing to allocate onto. */
export class ZeroLandedCostWeightError extends Error {
  readonly code = "ZERO_LANDED_COST_WEIGHT";
  readonly messageEn: string;
  constructor(readonly method: string) {
    super(`تعذّر توزيع التكلفة الإضافية بطريقة "${landedCostMethodAr(method)}": كل بنود الهدف وزنها صفر.`);
    this.messageEn = `Cannot distribute landed cost ${method}: every target line has a zero weight.`;
    this.name = "ZeroLandedCostWeightError";
  }
}

/** Raised when a landed cost is dated before a stock movement already recorded on a position it targets: stock and the ledger must carry it on the same day. */
export class LandedCostDateBeforeStockMovementError extends Error {
  readonly code = "LANDED_COST_DATE_BEFORE_STOCK_MOVEMENT";
  readonly messageEn: string;
  constructor(
    readonly date: string,
    readonly itemId: string,
    readonly earliestAllowedDate: string,
  ) {
    super(
      `تاريخ التكلفة الإضافية ${date} يسبق آخر حركة مخزون على الصنف "${itemId}" بتاريخ ${earliestAllowedDate}. أقرب تاريخ مسموح به هو ${earliestAllowedDate}، ليبقى المخزون والأستاذ العام على التاريخ نفسه.`,
    );
    this.messageEn = `The landed-cost date ${date} is before the latest stock movement on item "${itemId}", dated ${earliestAllowedDate}. The earliest date allowed is ${earliestAllowedDate}, so stock and the general ledger carry it on the same day.`;
    this.name = "LandedCostDateBeforeStockMovementError";
  }
}

/** Raised when a purchase document is cancelled while a confirmed landed cost still stands on it. */
export class LandedCostStandsOnDocumentError extends Error {
  readonly code = "LANDED_COST_STANDS_ON_DOCUMENT";
  readonly messageEn: string;
  constructor(
    readonly documentId: string,
    readonly landedCostNumbers: readonly string[],
  ) {
    super(
      `لا يمكن إلغاء مستند المشتريات "${documentId}" وعليه تكلفة إضافية مؤكدة (${landedCostNumbers.join("، ")}). اعكس مستند التكلفة الإضافية أولاً ثم ألغِ المستند.`,
    );
    this.messageEn = `Purchase document "${documentId}" cannot be cancelled while a confirmed landed cost stands on it (${landedCostNumbers.join(", ")}). Reverse the landed-cost document first, then cancel the document.`;
    this.name = "LandedCostStandsOnDocumentError";
  }
}
