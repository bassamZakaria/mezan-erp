/**
 * Which catalogued events a subscription may actually be bound to.
 *
 * `events/catalog.ts` lists all 39 trigger events docs/catalog/09 captured, but
 * only a handful are really published onto the `EventBus` by this build. The
 * notification-rules screen already tells the truth about that
 * (`notifications/triggers.ts` — `emitted`); a webhook must go further and
 * REFUSE the rest, because an unfirable notification rule is a dead row while
 * an unfirable webhook is a tenant waiting on a callback that never comes.
 *
 * The deliverable set is supplied by the composition root — the only place that
 * knows which document types are bridged — exactly as the trigger catalog's
 * `emittedCodes` is, so the two can never drift.
 */

import { getEventDefinition, isEventCode } from "../events/catalog.js";

export interface WebhookEventPolicy {
  /**
   * Event codes this build publishes. Omitted or empty disables the check —
   * an edition that has not declared its wiring must not have every
   * subscription rejected.
   */
  readonly deliverableCodes?: readonly string[];
}

export function undeliverableEventReasons(
  events: readonly string[],
  policy: WebhookEventPolicy,
): string[] {
  const deliverable = policy.deliverableCodes;
  if (!deliverable || deliverable.length === 0) return [];
  const allowed = new Set(deliverable);
  const reasons: string[] = [];
  for (const code of events) {
    if (!isEventCode(code) || allowed.has(code)) continue;
    const label = getEventDefinition(code).labelAr;
    reasons.push(
      `event "${code}" (${label}) is catalogued but never emitted by this build — a subscription on it can never fire`,
    );
  }
  return reasons;
}
