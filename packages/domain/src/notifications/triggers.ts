import { DOMAIN_EVENT_CATALOG, type EventCategory, type EventCode } from "../events/catalog.js";
import type { NotificationChannel } from "./types.js";

/**
 * Notification trigger catalog — the events a tenant may bind a rule to
 * (docs/catalog/09 §قواعد الإشعارات), annotated with what this build can
 * actually deliver.
 *
 * The trigger list is NOT a second copy of the event taxonomy: it is
 * `DOMAIN_EVENT_CATALOG` (events/catalog.ts) plus one honest bit per code.
 * `emitted` is true only for the codes something in this build really publishes
 * onto the `EventBus`; the composition root owns that set (it is the only place
 * that knows which document types are bridged) and passes it in, so the two can
 * never drift. Every other catalogued code stays selectable but is reported as
 * not-yet-emitted, so a tenant is never sold a rule that can never fire.
 *
 * `IMPLEMENTED_NOTIFICATION_CHANNELS` is the matching bit for delivery: the
 * rules engine persists a real, readable notification for `in_app` and records
 * every other requested channel as `queued`, because this repo has no outbound
 * mail/push transport.
 */

export interface NotificationTrigger {
  readonly code: EventCode;
  readonly category: EventCategory;
  readonly labelAr: string;
  /** True when something in THIS build publishes the code onto the event bus. */
  readonly emitted: boolean;
}

export const IMPLEMENTED_NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ["in_app"];

export function buildNotificationTriggerCatalog(
  emittedCodes: Iterable<EventCode>,
): readonly NotificationTrigger[] {
  const emitted = new Set<string>(emittedCodes);
  return DOMAIN_EVENT_CATALOG.map((event) => ({
    code: event.code,
    category: event.category,
    labelAr: event.labelAr,
    emitted: emitted.has(event.code),
  }));
}
