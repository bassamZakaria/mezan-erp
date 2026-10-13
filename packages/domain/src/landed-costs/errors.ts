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

export enum StockRevaluationSource {
  LandedCost = "LANDED_COST",
  PurchasePriceVariance = "PURCHASE_INVOICE",
}

const REVALUATION_SOURCE_LABEL: Record<StockRevaluationSource, { readonly ar: string; readonly en: string; readonly code: string }> = {
  [StockRevaluationSource.LandedCost]: { ar: "التكلفة الإضافية", en: "landed cost", code: "STOCK_MOVEMENT_BEFORE_LANDED_COST" },
  [StockRevaluationSource.PurchasePriceVariance]: { ar: "فرق سعر فاتورة المشتريات", en: "purchase invoice price difference", code: "STOCK_MOVEMENT_BEFORE_COST_REVALUATION" },
};

export interface StandingStockRevaluation {
  readonly day: string;
  readonly source: StockRevaluationSource;
  readonly documentNo: string;
}

export class StockMovementBeforeRevaluationError extends Error {
  readonly code: string;
  readonly messageEn: string;
  readonly earliestAllowedDate: string;
  constructor(
    readonly date: string,
    readonly itemId: string,
    readonly revaluation: StandingStockRevaluation,
  ) {
    const label = REVALUATION_SOURCE_LABEL[revaluation.source];
    super(
      `حركة المخزون بتاريخ ${date} على الصنف "${itemId}" تسبق ${label.ar} ${revaluation.documentNo} التي عدّلت تكلفة الرصيد نفسه بتاريخ ${revaluation.day}. أقرب تاريخ مسموح به هو ${revaluation.day}؛ أو اعكس المستند ${revaluation.documentNo} أولاً.`,
    );
    this.messageEn = `The stock movement dated ${date} on item "${itemId}" is before the ${label.en} ${revaluation.documentNo}, which changed the cost of the same position on ${revaluation.day}. The earliest date allowed is ${revaluation.day}; or reverse document ${revaluation.documentNo} first.`;
    this.code = label.code;
    this.earliestAllowedDate = revaluation.day;
    this.name = "StockMovementBeforeRevaluationError";
  }
}

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
