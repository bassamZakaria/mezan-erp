/**
 * The 27 workflow-gateable action types (docs/archive/catalog/09 §workflow), as data.
 *
 * Each is a business action that a tenant MAY put behind a multi-step, sequential,
 * role-based approval chain via `/settings/workflow`. The list is authoritative:
 * the config UI's action-type combobox is exactly these 27 entries.
 */

export interface GateableActionTypeDef {
  /** Stable machine code. */
  readonly code: string;
  /** Arabic label as shown in the config combobox. */
  readonly labelAr: string;
  /** English label — without it the approvals screens leak Arabic into the en UI. */
  readonly labelEn: string;
  /** Grouping used by the config screen. */
  readonly category:
    | "sales"
    | "purchases"
    | "treasury"
    | "inventory"
    | "accounting"
    | "hr_payroll"
    | "hr_leave"
    | "manufacturing";
  /**
   * False while the code path this gates does not consult the workflow engine.
   * The config screen must say so: a tenant who configures an approval chain
   * for an unenforced action believes spend is held when it is not, which is a
   * worse control than none at all.
   */
  readonly enforced?: boolean;
}

export const GATEABLE_ACTION_TYPES = [
  // Sales (4)
  { code: "SALES_INVOICE_CONFIRM", labelAr: "تأكيد فاتورة المبيعات", labelEn: "Confirm sales invoice", category: "sales" },
  { code: "SALES_RETURN_CONFIRM", labelAr: "تأكيد مردودات المبيعات", labelEn: "Confirm sales return", category: "sales" },
  { code: "SALES_QUOTE_SEND", labelAr: "إرسال عرض سعر", labelEn: "Send quotation", category: "sales", enforced: false },
  { code: "SALES_PRICE_FLOOR_OVERRIDE", labelAr: "اعتماد بيع دون الحد الأدنى للسعر", labelEn: "Approve a sale below the price floor", category: "sales" },

  // Purchases (5)
  { code: "PURCHASE_ORDER_CONFIRM", labelAr: "تأكيد أمر الشراء", labelEn: "Confirm purchase order", category: "purchases", enforced: false },
  { code: "PURCHASE_INVOICE_CONFIRM", labelAr: "تأكيد فاتورة المشتريات", labelEn: "Confirm purchase invoice", category: "purchases", enforced: false },
  { code: "PURCHASE_RECEIPT_CONFIRM", labelAr: "تأكيد سند استلام البضاعة", labelEn: "Confirm goods receipt", category: "purchases", enforced: false },
  { code: "PURCHASE_RETURN_CONFIRM", labelAr: "تأكيد مردودات المشتريات", labelEn: "Confirm purchase return", category: "purchases" },
  { code: "PURCHASE_LANDED_COST_CONFIRM", labelAr: "تأكيد سند التكاليف الإضافية", labelEn: "Confirm landed-cost voucher", category: "purchases" },

  // Treasury (3)
  { code: "TREASURY_VOUCHER_CONFIRM", labelAr: "تأكيد سند صرف/قبض", labelEn: "Confirm cash voucher", category: "treasury" },
  { code: "TREASURY_CAPITAL_WITHDRAWAL_CONFIRM", labelAr: "تأكيد سحب من رأس المال", labelEn: "Confirm capital withdrawal", category: "treasury", enforced: false },
  { code: "TREASURY_TAX_PAYMENT_CONFIRM", labelAr: "تأكيد سداد ضريبي", labelEn: "Confirm tax payment", category: "treasury", enforced: false },

  // Inventory (2)
  { code: "INVENTORY_TRANSFER_CONFIRM", labelAr: "تأكيد تحويل مخزون", labelEn: "Confirm stock transfer", category: "inventory" },
  { code: "INVENTORY_ADJUSTMENT_CONFIRM", labelAr: "تأكيد تعديل مخزون", labelEn: "Confirm stock adjustment", category: "inventory" },

  // Accounting (2)
  { code: "ACCOUNTING_JOURNAL_POST", labelAr: "ترحيل قيد يومية", labelEn: "Post journal entry", category: "accounting", enforced: false },
  { code: "ACCOUNTING_JOURNAL_VOID", labelAr: "إلغاء قيد يومية", labelEn: "Void journal entry", category: "accounting", enforced: false },

  // HR / Payroll (1)
  { code: "HR_PAYROLL_APPROVE", labelAr: "اعتماد مسير الرواتب", labelEn: "Approve payroll run", category: "hr_payroll", enforced: false },

  // HR / Leave (9 granular leave-type gates)
  { code: "HR_LEAVE_APPROVE_ALL", labelAr: "الموافقة على طلب الإجازة (كل الأنواع)", labelEn: "Approve leave request (all types)", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_ANNUAL", labelAr: "الموافقة على إجازة سنوية", labelEn: "Approve annual leave", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_SICK", labelAr: "الموافقة على إجازة مرضية", labelEn: "Approve sick leave", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_PERSONAL", labelAr: "الموافقة على إجازة شخصية", labelEn: "Approve personal leave", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_CASUAL", labelAr: "الموافقة على إجازة عارضة", labelEn: "Approve casual leave", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_MATERNITY", labelAr: "الموافقة على إجازة أمومة", labelEn: "Approve maternity leave", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_PATERNITY", labelAr: "الموافقة على إجازة أبوة", labelEn: "Approve paternity leave", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_UNPAID", labelAr: "الموافقة على إجازة بدون أجر", labelEn: "Approve unpaid leave", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_EMERGENCY", labelAr: "الموافقة على إجازة طارئة", labelEn: "Approve emergency leave", category: "hr_leave" },

  // Manufacturing (1)
  { code: "MANUFACTURING_WORK_ORDER_START", labelAr: "بدء أمر التصنيع", labelEn: "Start work order", category: "manufacturing", enforced: false },
] as const satisfies readonly GateableActionTypeDef[];

/** Union of the 27 gateable action-type codes. */
export type GateableActionType = (typeof GATEABLE_ACTION_TYPES)[number]["code"];

const ACTION_CODES: ReadonlySet<string> = new Set(
  GATEABLE_ACTION_TYPES.map((a) => a.code),
);

export function isGateableActionType(code: string): code is GateableActionType {
  return ACTION_CODES.has(code);
}
