import type { DomainEvent } from "../events/event-bus.js";
import type { EventCode } from "../events/catalog.js";
import { matchesCondition, readPayloadField } from "./condition.js";
import { findNotificationTrigger } from "./triggers.js";
import type {
  NotificationChannel,
  NotificationPriority,
  NotificationRecipientType,
  NotificationRule,
} from "./rule.js";

/**
 * Rule evaluation — a PURE function of (rule, event, context). It decides
 * whether a rule fires and what the resulting notification says; it resolves no
 * users, reads no repository and sends nothing. Recipient resolution and
 * delivery live behind ports the engine drives (`engine.ts`).
 */

export interface NotificationEvaluationContext {
  /** Timestamp stamped on the produced notification. */
  readonly now: string;
  /**
   * Extra payload fields resolved by an enricher (e.g. a confirmed invoice's
   * total and customer). Merged OVER the event's own payload, so an enricher
   * can fill in what the raw event could not carry.
   */
  readonly enrichment?: Readonly<Record<string, unknown>>;
}

/** What a fired rule asks for, before any user has been resolved. */
export interface NotificationDraft {
  readonly ruleId: string;
  readonly eventCode: EventCode;
  readonly recipientType: NotificationRecipientType;
  readonly recipientValue: string;
  readonly priority: NotificationPriority;
  readonly channels: readonly NotificationChannel[];
  readonly title: string;
  readonly body: string;
  readonly reference: string | null;
  readonly createdAt: string;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Fills `{{field}}` placeholders from the payload; an unknown field renders empty. */
export function renderTemplate(
  template: string,
  payload: Readonly<Record<string, unknown>>,
): string {
  return template.replace(PLACEHOLDER, (_match, field: string) => {
    const value = readPayloadField(payload, field);
    return value === undefined || value === null ? "" : String(value);
  });
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function defaultBody(payload: Readonly<Record<string, unknown>>): string {
  const docNo = readPayloadField(payload, "docNo");
  return docNo === undefined || docNo === null || String(docNo) === "" ? "" : String(docNo);
}

function referenceOf(payload: Readonly<Record<string, unknown>>): string | null {
  const docType = readPayloadField(payload, "docType");
  const docId = readPayloadField(payload, "docId");
  if (docType === undefined || docType === null || docId === undefined || docId === null) {
    return null;
  }
  return `${String(docType)}:${String(docId)}`;
}

/**
 * Evaluates ONE rule against ONE event. Returns null when the rule is disabled,
 * listens for a different event, or its condition does not hold.
 */
export function evaluateRule(
  rule: NotificationRule,
  event: DomainEvent,
  context: NotificationEvaluationContext,
): NotificationDraft | null {
  if (!rule.enabled) return null;
  if (rule.eventCode !== event.code) return null;

  const payload: Readonly<Record<string, unknown>> = {
    ...asRecord(event.payload),
    ...(context.enrichment ?? {}),
  };
  if (!matchesCondition(rule.condition, payload)) return null;

  const trigger = findNotificationTrigger(rule.eventCode);
  const title = rule.titleTemplate
    ? renderTemplate(rule.titleTemplate, payload)
    : (trigger?.labelAr ?? rule.eventCode);
  const body = rule.bodyTemplate ? renderTemplate(rule.bodyTemplate, payload) : defaultBody(payload);

  return {
    ruleId: rule.id,
    eventCode: rule.eventCode,
    recipientType: rule.recipientType,
    recipientValue: rule.recipientValue,
    priority: rule.priority,
    channels: rule.channels,
    title,
    body,
    reference: referenceOf(payload),
    createdAt: context.now,
  };
}

/** Evaluates a whole rule set against one event, preserving rule order. */
export function evaluateRules(
  rules: readonly NotificationRule[],
  event: DomainEvent,
  context: NotificationEvaluationContext,
): NotificationDraft[] {
  const drafts: NotificationDraft[] = [];
  for (const rule of rules) {
    const draft = evaluateRule(rule, event, context);
    if (draft) drafts.push(draft);
  }
  return drafts;
}
