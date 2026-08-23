import type { EventBus } from "../events/event-bus.js";
import type { EventCode } from "../events/catalog.js";
import type {
  DocumentDomainEvent,
  DocumentEventPublisher,
} from "../documents/hooks.js";

/**
 * Bridge: the document framework's own lifecycle events → the versioned
 * notification-trigger catalog.
 *
 * The document layer deliberately publishes a transport-neutral
 * `DocumentDomainEvent` (`DOCUMENT_CONFIRMED` on `SALES_INVOICE`, …) rather than
 * the notification codes — see documents/hooks.ts "decoupled from the
 * notification catalog". This is the one place that translation happens, so the
 * set of catalog codes this build can actually emit is readable in a single
 * table instead of being scattered across services.
 *
 * A document type with no catalog counterpart (journal entries, stock
 * adjustments/transfers, landed costs) maps to null and publishes nothing —
 * inventing a code for it would fabricate a trigger the reference does not have.
 */
const BRIDGE: Readonly<Record<string, Partial<Record<string, EventCode>>>> = {
  SALES_INVOICE: {
    DOCUMENT_CONFIRMED: "SALES_INVOICE_CONFIRMED",
    DOCUMENT_CANCELLED: "SALES_INVOICE_VOIDED",
    DOCUMENT_REVERSED: "SALES_INVOICE_VOIDED",
  },
  SALES_RETURN: {
    DOCUMENT_CONFIRMED: "SALES_RETURN_CONFIRMED",
  },
  PURCHASE_RETURN: {
    DOCUMENT_CONFIRMED: "PURCHASE_RETURN_CONFIRMED",
    DOCUMENT_CANCELLED: "PURCHASE_RETURN_VOIDED",
    DOCUMENT_REVERSED: "PURCHASE_RETURN_VOIDED",
  },
  TREASURY_VOUCHER: {
    DOCUMENT_CONFIRMED: "CASH_VOUCHER_CONFIRMED",
    DOCUMENT_CANCELLED: "CASH_VOUCHER_VOIDED",
    DOCUMENT_REVERSED: "CASH_VOUCHER_VOIDED",
  },
  INSTALLMENT_PLAN: {
    DOCUMENT_CONFIRMED: "INSTALLMENT_PLAN_CREATED",
    DOCUMENT_CANCELLED: "INSTALLMENT_PLAN_CANCELED",
    DOCUMENT_REVERSED: "INSTALLMENT_PLAN_CANCELED",
  },
};

/** The payload every bridged event carries. Conditions and templates read these keys. */
export interface DocumentEventPayload {
  readonly docType: string;
  readonly docId: string;
  readonly docNo: string | null;
  /** The lifecycle step that fired: CONFIRMED / CANCELLED / REVERSED / … */
  readonly transition: string;
}

export function toNotificationEventCode(event: DocumentDomainEvent): EventCode | null {
  return BRIDGE[event.docType]?.[event.type] ?? null;
}

/**
 * A `DocumentEventPublisher` that republishes onto the notification event bus.
 * Wire it as the `events` dependency of every `DocumentService` / service that
 * accepts one at the composition root.
 */
export function createDocumentEventBridge(bus: EventBus): DocumentEventPublisher {
  return {
    publish(event: DocumentDomainEvent): void {
      const code = toNotificationEventCode(event);
      if (!code) return;
      const payload: DocumentEventPayload = {
        docType: event.docType,
        docId: event.docId,
        docNo: event.docNo,
        transition: event.type.replace(/^DOCUMENT_/, ""),
      };
      bus.publish(code, payload, event.occurredAt);
    },
  };
}
