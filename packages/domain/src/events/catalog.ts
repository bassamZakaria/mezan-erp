/**
 * Unified domain-event catalog.
 *
 * docs/archive/plan.md §5.6: define ONE versioned event catalog in packages/domain and
 * let all consumers read it — the workflow gate, the notification-rules engine,
 * and the realtime transport. Three separate hardcoded lists is the failure
 * mode to avoid.
 *
 * These are the 39 notification-rule trigger events from docs/archive/catalog/09
 * (قواعد الإشعارات, `/notifications/rules`), plus CASH_FORECAST_LOW, which the
 * cash-runway feature raises, and STOCK_NEAR_EXPIRY / STOCK_EXPIRED, which the
 * expiry scan raises. Bump EVENT_CATALOG_VERSION on any change so
 * consumers can detect drift.
 */

export const EVENT_CATALOG_VERSION = 4;

export const EVENT_CATEGORIES = [
  "workflow",
  "sales",
  "purchases",
  "treasury",
  "installments",
  "cheques",
  "pos",
  "inventory",
  "manufacturing",
  "platform",
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export interface EventDefinition {
  readonly code: string;
  readonly category: EventCategory;
  readonly labelAr: string;
}

export const DOMAIN_EVENT_CATALOG = [
  // Workflow / approvals (4)
  { code: "WORKFLOW_APPROVAL_REQUESTED", category: "workflow", labelAr: "عملية بانتظار الموافقة" },
  { code: "WORKFLOW_APPROVAL_GRANTED", category: "workflow", labelAr: "تم اعتماد العملية" },
  { code: "WORKFLOW_APPROVAL_REJECTED", category: "workflow", labelAr: "تم رفض العملية" },
  { code: "WORKFLOW_MODIFICATION_REQUESTED", category: "workflow", labelAr: "مطلوب تعديل على العملية" },

  // Sales (7)
  { code: "SALES_INVOICE_CONFIRMED", category: "sales", labelAr: "تم تأكيد فاتورة مبيعات" },
  { code: "SALES_INVOICE_VOIDED", category: "sales", labelAr: "تم إلغاء فاتورة مبيعات" },
  { code: "SALES_RETURN_CONFIRMED", category: "sales", labelAr: "تم تأكيد مردود مبيعات" },
  { code: "SALES_QUOTE_CREATED", category: "sales", labelAr: "تم إنشاء عرض سعر" },
  { code: "SALES_QUOTE_SENT", category: "sales", labelAr: "تم إرسال عرض سعر" },
  { code: "SALES_QUOTE_ACCEPTED", category: "sales", labelAr: "تم قبول عرض سعر" },
  { code: "SALES_QUOTE_EXPIRED", category: "sales", labelAr: "انتهت صلاحية عرض السعر" },
  { code: "SALES_QUOTE_CONVERTED", category: "sales", labelAr: "تم تحويل عرض سعر إلى فاتورة" },
  { code: "CRM_ACTIVITY_DUE", category: "sales", labelAr: "حان موعد نشاط متابعة" },

  // Purchases (7)
  { code: "PURCHASE_ORDER_CONFIRMED", category: "purchases", labelAr: "تم إرسال أمر شراء للمورد" },
  { code: "PURCHASE_RECEIPT_CONFIRMED", category: "purchases", labelAr: "تم تأكيد استلام بضاعة" },
  { code: "PURCHASE_RECEIPT_VOIDED", category: "purchases", labelAr: "تم إلغاء استلام بضاعة" },
  { code: "PURCHASE_INVOICE_CONFIRMED", category: "purchases", labelAr: "تم تأكيد فاتورة مشتريات" },
  { code: "PURCHASE_INVOICE_VOIDED", category: "purchases", labelAr: "تم إلغاء فاتورة مشتريات" },
  { code: "PURCHASE_RETURN_CONFIRMED", category: "purchases", labelAr: "تم تأكيد مردود مشتريات" },
  { code: "PURCHASE_RETURN_VOIDED", category: "purchases", labelAr: "تم إلغاء مردود مشتريات" },

  // Treasury / cash (4)
  { code: "CASH_VOUCHER_CONFIRMED", category: "treasury", labelAr: "تم تأكيد سند نقدي" },
  { code: "CASH_VOUCHER_VOIDED", category: "treasury", labelAr: "تم إلغاء سند نقدي" },
  { code: "PAYMENT_RECEIPT_CONFIRMED", category: "treasury", labelAr: "تم تحصيل دفعة" },
  { code: "CASH_FORECAST_LOW", category: "treasury", labelAr: "تنبيه سيولة: الرصيد المتوقع أقل من الحد" },

  // Installments (4)
  { code: "INSTALLMENT_OVERDUE", category: "installments", labelAr: "قسط متأخر عن السداد" },
  { code: "INSTALLMENT_PLAN_CREATED", category: "installments", labelAr: "تم إنشاء خطة أقساط" },
  { code: "INSTALLMENT_COLLECTION_RECEIVED", category: "installments", labelAr: "تم تحصيل قسط" },
  { code: "INSTALLMENT_PLAN_CANCELED", category: "installments", labelAr: "تم إلغاء خطة أقساط" },

  // Cheques (5)
  { code: "CHEQUE_REGISTERED", category: "cheques", labelAr: "تم تسجيل شيك" },
  { code: "CHEQUE_COLLECTED", category: "cheques", labelAr: "تم تحصيل شيك" },
  { code: "CHEQUE_BOUNCED", category: "cheques", labelAr: "شيك مرتجع" },
  { code: "CHEQUE_CLEARED", category: "cheques", labelAr: "تم صرف شيك صادر" },
  { code: "CHEQUE_VOIDED", category: "cheques", labelAr: "تم إلغاء شيك" },

  // POS (5)
  { code: "POS_SALE_CONFIRMED", category: "pos", labelAr: "تم تأكيد مبيعة نقطة بيع" },
  { code: "POS_REFUND_CONFIRMED", category: "pos", labelAr: "تم تأكيد استرداد نقطة بيع" },
  { code: "POS_REFUND_VOIDED", category: "pos", labelAr: "تم إلغاء استرداد نقطة بيع" },
  { code: "POS_SESSION_CLOSED", category: "pos", labelAr: "تم إغلاق وردية نقطة بيع" },
  { code: "POS_DISCOUNT_APPROVAL_REQUESTED", category: "pos", labelAr: "طلب اعتماد خصم نقطة بيع" },

  // Inventory (3)
  { code: "LOW_STOCK_DETECTED", category: "inventory", labelAr: "انخفاض مخزون عن الحد الأدنى" },
  { code: "STOCK_NEAR_EXPIRY", category: "inventory", labelAr: "تشغيلة قاربت على انتهاء الصلاحية" },
  { code: "STOCK_EXPIRED", category: "inventory", labelAr: "تشغيلة انتهت صلاحيتها في المخزون" },

  // Manufacturing (2)
  { code: "WORK_ORDER_STARTED", category: "manufacturing", labelAr: "بدأ أمر التصنيع" },
  { code: "WORK_ORDER_COMPLETED", category: "manufacturing", labelAr: "اكتمل أمر التصنيع" },

  // Platform (1)
  { code: "TENANT_CREATED", category: "platform", labelAr: "ترحيب بمستخدم جديد" },
] as const satisfies readonly EventDefinition[];

export type EventCode = (typeof DOMAIN_EVENT_CATALOG)[number]["code"];

const BY_CODE: ReadonlyMap<string, EventDefinition> = new Map(
  DOMAIN_EVENT_CATALOG.map((e) => [e.code, e]),
);

export function isEventCode(code: string): code is EventCode {
  return BY_CODE.has(code);
}

export function getEventDefinition(code: EventCode): EventDefinition {
  return BY_CODE.get(code) as EventDefinition;
}
