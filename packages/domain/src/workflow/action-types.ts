/**
 * The 26 workflow-gateable action types (docs/catalog/09 §workflow), as data.
 *
 * Each is a business action that a tenant MAY put behind a multi-step, sequential,
 * role-based approval chain via `/settings/workflow`. The list is authoritative:
 * the config UI's action-type combobox is exactly these 26 entries.
 */

export interface GateableActionTypeDef {
  /** Stable machine code. */
  readonly code: string;
  /** Arabic label as shown in the config combobox. */
  readonly labelAr: string;
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
}

export const GATEABLE_ACTION_TYPES = [
  // Sales (3)
  { code: "SALES_INVOICE_CONFIRM", labelAr: "تأكيد فاتورة المبيعات", category: "sales" },
  { code: "SALES_RETURN_CONFIRM", labelAr: "تأكيد مردودات المبيعات", category: "sales" },
  { code: "SALES_QUOTE_SEND", labelAr: "إرسال عرض سعر", category: "sales" },

  // Purchases (5)
  { code: "PURCHASE_ORDER_CONFIRM", labelAr: "تأكيد أمر الشراء", category: "purchases" },
  { code: "PURCHASE_INVOICE_CONFIRM", labelAr: "تأكيد فاتورة المشتريات", category: "purchases" },
  { code: "PURCHASE_RECEIPT_CONFIRM", labelAr: "تأكيد سند استلام البضاعة", category: "purchases" },
  { code: "PURCHASE_RETURN_CONFIRM", labelAr: "تأكيد مردودات المشتريات", category: "purchases" },
  { code: "PURCHASE_LANDED_COST_CONFIRM", labelAr: "تأكيد سند التكاليف الإضافية", category: "purchases" },

  // Treasury (3)
  { code: "TREASURY_VOUCHER_CONFIRM", labelAr: "تأكيد سند صرف/قبض", category: "treasury" },
  { code: "TREASURY_CAPITAL_WITHDRAWAL_CONFIRM", labelAr: "تأكيد سحب من رأس المال", category: "treasury" },
  { code: "TREASURY_TAX_PAYMENT_CONFIRM", labelAr: "تأكيد سداد ضريبي", category: "treasury" },

  // Inventory (2)
  { code: "INVENTORY_TRANSFER_CONFIRM", labelAr: "تأكيد تحويل مخزون", category: "inventory" },
  { code: "INVENTORY_ADJUSTMENT_CONFIRM", labelAr: "تأكيد تعديل مخزون", category: "inventory" },

  // Accounting (2)
  { code: "ACCOUNTING_JOURNAL_POST", labelAr: "ترحيل قيد يومية", category: "accounting" },
  { code: "ACCOUNTING_JOURNAL_VOID", labelAr: "إلغاء قيد يومية", category: "accounting" },

  // HR / Payroll (1)
  { code: "HR_PAYROLL_APPROVE", labelAr: "اعتماد مسير الرواتب", category: "hr_payroll" },

  // HR / Leave (9 granular leave-type gates)
  { code: "HR_LEAVE_APPROVE_ALL", labelAr: "الموافقة على طلب الإجازة (كل الأنواع)", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_ANNUAL", labelAr: "الموافقة على إجازة سنوية", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_SICK", labelAr: "الموافقة على إجازة مرضية", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_PERSONAL", labelAr: "الموافقة على إجازة شخصية", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_CASUAL", labelAr: "الموافقة على إجازة عارضة", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_MATERNITY", labelAr: "الموافقة على إجازة أمومة", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_PATERNITY", labelAr: "الموافقة على إجازة أبوة", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_UNPAID", labelAr: "الموافقة على إجازة بدون أجر", category: "hr_leave" },
  { code: "HR_LEAVE_APPROVE_EMERGENCY", labelAr: "الموافقة على إجازة طارئة", category: "hr_leave" },

  // Manufacturing (1)
  { code: "MANUFACTURING_WORK_ORDER_START", labelAr: "بدء أمر التصنيع", category: "manufacturing" },
] as const satisfies readonly GateableActionTypeDef[];

/** Union of the 26 gateable action-type codes. */
export type GateableActionType = (typeof GATEABLE_ACTION_TYPES)[number]["code"];

const ACTION_CODES: ReadonlySet<string> = new Set(
  GATEABLE_ACTION_TYPES.map((a) => a.code),
);

export function isGateableActionType(code: string): code is GateableActionType {
  return ACTION_CODES.has(code);
}
