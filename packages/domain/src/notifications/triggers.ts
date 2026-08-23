/**
 * Notification trigger catalog — the events a tenant may bind a rule to
 * (docs/catalog/09 §قواعد الإشعارات, `/notifications/rules`).
 *
 * The trigger list is NOT a second copy of the event taxonomy: it is
 * `DOMAIN_EVENT_CATALOG` (events/catalog.ts) annotated with what this build can
 * actually deliver. `emitted` is the honest bit — it is true only for the codes
 * something in Mezan really publishes onto the `EventBus` today (the document
 * framework's confirm/cancel/reverse lifecycle, bridged in
 * `document-event-bridge.ts`). Every other catalogued code stays selectable in
 * the API surface but is reported as not-yet-emitted, so a tenant is never sold
 * a rule that can never fire.
 */

import {
  DOMAIN_EVENT_CATALOG,
  type EventCategory,
  type EventCode,
} from "../events/catalog.js";

/** A field an event's payload carries, offered as the left-hand side of a rule condition. */
export interface TriggerConditionField {
  readonly key: string;
  readonly labelAr: string;
  readonly kind: "number" | "text";
}

export interface NotificationTrigger {
  readonly code: EventCode;
  readonly category: EventCategory;
  readonly labelAr: string;
  /** True when something in THIS build publishes the code onto the event bus. */
  readonly emitted: boolean;
  /** Payload fields a condition on this trigger can test. Empty when nothing emits it. */
  readonly conditionFields: readonly TriggerConditionField[];
}

/** Fields every document-lifecycle-sourced event carries (see `document-event-bridge.ts`). */
const DOCUMENT_FIELDS: readonly TriggerConditionField[] = [
  { key: "docNo", labelAr: "رقم المستند", kind: "text" },
  { key: "docType", labelAr: "نوع المستند", kind: "text" },
  { key: "transition", labelAr: "التحول في الحالة", kind: "text" },
];

/**
 * Extra fields the sales-invoice enricher adds by loading the confirmed invoice
 * (`createSalesInvoiceEventEnricher` in @mezan/api). Only present when that
 * enricher is wired at the composition root.
 */
const SALES_INVOICE_FIELDS: readonly TriggerConditionField[] = [
  ...DOCUMENT_FIELDS,
  { key: "amount", labelAr: "إجمالي الفاتورة", kind: "number" },
  { key: "customerId", labelAr: "كود العميل", kind: "text" },
  { key: "customerName", labelAr: "اسم العميل", kind: "text" },
  { key: "status", labelAr: "حالة الفاتورة", kind: "text" },
];

const EMITTED: ReadonlyMap<string, readonly TriggerConditionField[]> = new Map([
  ["SALES_INVOICE_CONFIRMED", SALES_INVOICE_FIELDS],
  ["SALES_INVOICE_VOIDED", SALES_INVOICE_FIELDS],
  ["SALES_RETURN_CONFIRMED", DOCUMENT_FIELDS],
  ["PURCHASE_RETURN_CONFIRMED", DOCUMENT_FIELDS],
  ["PURCHASE_RETURN_VOIDED", DOCUMENT_FIELDS],
  ["CASH_VOUCHER_CONFIRMED", DOCUMENT_FIELDS],
  ["CASH_VOUCHER_VOIDED", DOCUMENT_FIELDS],
  ["INSTALLMENT_PLAN_CREATED", DOCUMENT_FIELDS],
  ["INSTALLMENT_PLAN_CANCELED", DOCUMENT_FIELDS],
]);

export const NOTIFICATION_TRIGGERS: readonly NotificationTrigger[] = DOMAIN_EVENT_CATALOG.map(
  (event) => ({
    code: event.code,
    category: event.category,
    labelAr: event.labelAr,
    emitted: EMITTED.has(event.code),
    conditionFields: EMITTED.get(event.code) ?? [],
  }),
);

const TRIGGERS_BY_CODE: ReadonlyMap<string, NotificationTrigger> = new Map(
  NOTIFICATION_TRIGGERS.map((t) => [t.code, t]),
);

export function findNotificationTrigger(code: string): NotificationTrigger | null {
  return TRIGGERS_BY_CODE.get(code) ?? null;
}
