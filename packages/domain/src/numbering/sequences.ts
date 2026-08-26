/**
 * Document-numbering sequence definitions.
 *
 * The document-type sequences — the 25 from docs/catalog/09 (تسلسلات
 * الترقيم, `/settings/sequences`) plus SALES_RETURN and SALES_QUOTE (phase5/6)
 * and WORK_ORDER (manufacturing) — encoded as data: one source of truth for the
 * numbering engine, the settings UI and the docs. Each definition carries the
 * prefix, an optional suffix, the zero-pad length of the numeric part, and
 * whether the counter resets at the start of each calendar year.
 *
 * In the captured tenant all documented sequences have annual reset OFF and no suffix,
 * but both are first-class knobs the edit dialog exposes, so the engine models
 * them fully. Sequences are tenant-global (no per-branch scoping observed —
 * flagged as an open question in the catalog).
 */

export interface SequenceDefinition {
  /** Stable system code, e.g. "SALES_INVOICE". */
  readonly code: string;
  /** Arabic display label. */
  readonly labelAr: string;
  /** Leading prefix, e.g. "INV-". */
  readonly prefix: string;
  /** Optional trailing suffix (e.g. a year suffix like "-2026"). */
  readonly suffix?: string;
  /** Zero-pad width of the numeric part. */
  readonly padLength: number;
  /** Whether the counter resets to 1 at the start of each calendar year. */
  readonly annualReset: boolean;
  /**
   * Whether each branch keeps its OWN counter, and carries its code in the
   * number. Off, the counter is tenant-global: two branches selling on the same
   * day take consecutive numbers off one sequence, so neither branch's numbers
   * run 1, 2, 3 and an auditor cannot read a branch's books in isolation (D33).
   */
  readonly branchScoped?: boolean;
}

export const SEQUENCE_DEFINITIONS = [
  { code: "ASSET", labelAr: "أصل ثابت", prefix: "AST-", padLength: 6, annualReset: false },
  { code: "BOM", labelAr: "قائمة مكونات", prefix: "BOM-", padLength: 4, annualReset: false },
  { code: "CASH_VOUCHER", labelAr: "سند نقدي", prefix: "CV-", padLength: 6, annualReset: false },
  { code: "CHEQUE", labelAr: "شيك", prefix: "CHQ-", padLength: 6, annualReset: false },
  { code: "CONFIG_INSTANCE", labelAr: "منتج قابل للتهيئة", prefix: "CM-", padLength: 6, annualReset: false },
  { code: "CONTRACT", labelAr: "عقد", prefix: "CTR-", padLength: 4, annualReset: false },
  { code: "CUSTOMER_REFUND", labelAr: "استرداد عميل", prefix: "CRF-", padLength: 6, annualReset: false },
  { code: "DELIVERY_ORDER", labelAr: "أمر توصيل", prefix: "DLV-", padLength: 6, annualReset: false },
  { code: "EMPLOYEE", labelAr: "موظف", prefix: "EMP-", padLength: 4, annualReset: false },
  { code: "EMPLOYEE_ADVANCE", labelAr: "سلفة موظف", prefix: "ADV-", padLength: 6, annualReset: false },
  { code: "GOODS_RECEIPT", labelAr: "استلام بضاعة", prefix: "GR-", padLength: 6, annualReset: false },
  { code: "INSTALLMENT_PLAN", labelAr: "خطة أقساط", prefix: "IP-", padLength: 6, annualReset: false },
  { code: "JOURNAL_ENTRY", labelAr: "قيد محاسبي", prefix: "JE-", padLength: 6, annualReset: false },
  { code: "LANDED_COST", labelAr: "تكلفة إضافية", prefix: "LC-", padLength: 6, annualReset: false },
  { code: "LEAVE_ACCRUAL_BATCH", labelAr: "دورة استحقاق إجازات", prefix: "LAB-", padLength: 6, annualReset: false },
  { code: "LEAVE_REQUEST", labelAr: "طلب إجازة", prefix: "LR-", padLength: 6, annualReset: false },
  { code: "PAYMENT_DISBURSEMENT", labelAr: "سند صرف", prefix: "PAY-", padLength: 6, annualReset: false },
  { code: "PAYMENT_RECEIPT", labelAr: "سند تحصيل", prefix: "REC-", padLength: 6, annualReset: false },
  { code: "PAYROLL_RUN", labelAr: "دورة رواتب", prefix: "PR-", padLength: 6, annualReset: false },
  { code: "PAYSLIP", labelAr: "قسيمة راتب", prefix: "PS-", padLength: 6, annualReset: false },
  { code: "PHYSICAL_COUNT", labelAr: "جرد فعلي", prefix: "CNT-", padLength: 6, annualReset: false },
  { code: "POS_SALE", labelAr: "مبيعة نقطة بيع", prefix: "POS-", padLength: 8, annualReset: false },
  { code: "PURCHASE_INVOICE", labelAr: "فاتورة مشتريات", prefix: "PI-", padLength: 6, annualReset: false },
  { code: "PURCHASE_ORDER", labelAr: "أمر شراء", prefix: "PO-", padLength: 6, annualReset: false },
  { code: "PURCHASE_RETURN", labelAr: "مرتجع مشتريات", prefix: "PRT-", padLength: 6, annualReset: false },
  { code: "PURCHASE_RFQ", labelAr: "طلب عرض سعر", prefix: "RFQ-", padLength: 6, annualReset: false },
  { code: "SALES_INVOICE", labelAr: "فاتورة مبيعات", prefix: "INV-", padLength: 6, annualReset: false },
  { code: "SALES_ORDER", labelAr: "أمر مبيعات", prefix: "SO-", padLength: 6, annualReset: false },
  // Added by phase5/6 (مرتجعات المبيعات) — an oversight in the original 25:
  // PURCHASE_RETURN/LANDED_COST/INSTALLMENT_PLAN were captured but its sales
  // counterpart was not.
  { code: "SALES_RETURN", labelAr: "مرتجع مبيعات", prefix: "SRT-", padLength: 6, annualReset: false },
  { code: "SALES_QUOTE", labelAr: "عرض سعر", prefix: "QT-", padLength: 6, annualReset: false },
  // Added by phase11/manufacturing:
  { code: "WORK_ORDER", labelAr: "أمر تصنيع", prefix: "WO-", padLength: 4, annualReset: false },
  { code: "STOCK_ADJUSTMENT", labelAr: "تسوية مخزون", prefix: "ADJ-", padLength: 6, annualReset: false },
  { code: "STOCK_TRANSFER", labelAr: "تحويل مخزون", prefix: "TRF-", padLength: 6, annualReset: false },
] as const satisfies readonly SequenceDefinition[];

export type SequenceCode = (typeof SEQUENCE_DEFINITIONS)[number]["code"];

/**
 * Admin-editable subset of a {@link SequenceDefinition} — prefix, pad length
 * and the fiscal-year-reset flag (`/settings/sequences`). The counter value
 * itself is deliberately not part of this shape: it is read-only surface,
 * guarded separately (see `NextNumberService`'s doc comment).
 */
export type SequenceOverride = Partial<
  Pick<SequenceDefinition, "prefix" | "padLength" | "annualReset" | "branchScoped">
>;

/** Merge an admin override onto a base definition — override fields win. */
export function applySequenceOverride(
  base: SequenceDefinition,
  override: SequenceOverride | null | undefined,
): SequenceDefinition {
  if (!override) return base;
  return {
    ...base,
    ...(override.prefix !== undefined ? { prefix: override.prefix } : {}),
    ...(override.padLength !== undefined ? { padLength: override.padLength } : {}),
    ...(override.annualReset !== undefined ? { annualReset: override.annualReset } : {}),
    ...(override.branchScoped !== undefined ? { branchScoped: override.branchScoped } : {}),
  };
}

const BY_CODE: ReadonlyMap<string, SequenceDefinition> = new Map(
  SEQUENCE_DEFINITIONS.map((d) => [d.code, d]),
);

export function getSequenceDefinition(code: string): SequenceDefinition {
  const def = BY_CODE.get(code);
  if (!def) {
    throw new RangeError(`Unknown sequence code: "${code}"`);
  }
  return def;
}

/**
 * Format a counter value into its document number, e.g. (SALES_INVOICE, 15) ->
 * "INV-000015". The catalog shows next-number previews computed this way.
 */
export function formatSequenceNumber(
  def: SequenceDefinition,
  value: number,
  branchCode?: string | null,
): string {
  // A branch-scoped number carries its branch, or two branches' number 1 would
  // be indistinguishable on the page (D33).
  const branch = def.branchScoped && branchCode ? `${branchCode}-` : "";
  return `${def.prefix}${branch}${String(value).padStart(def.padLength, "0")}${def.suffix ?? ""}`;
}
