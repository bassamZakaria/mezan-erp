import type { EventCode } from "../events/catalog.js";
import { InvalidNotificationRuleError, NotificationRuleNotFoundError } from "./errors.js";
import { findNotificationTrigger } from "./triggers.js";

/**
 * A notification rule (docs/catalog/09 §قواعد الإشعارات) — the tenant-authored
 * binding of ONE trigger event to an optional condition, a recipient set, a
 * priority and one or more delivery channels.
 *
 * Nothing is seeded: a tenant defines its own rules, so an empty list is a
 * real, correct state (the reference tenant's own rule list is empty too).
 */

/**
 * Delivery channels the reference screen offers. Only `in_app` is IMPLEMENTED
 * in this build — `email` and `whatsapp` are modelled here so a rule can record
 * the tenant's intent, but no adapter exists for them, so the engine skips them
 * and says so (`NotificationDispatchResult.skippedChannels`). Nothing is
 * silently swallowed and nothing is faked.
 */
export const NOTIFICATION_CHANNELS = ["in_app", "email", "whatsapp"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Channels this build can actually deliver on. */
export const IMPLEMENTED_NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ["in_app"];

export const NOTIFICATION_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

/**
 * Who a rule notifies. The reference form's default is "حسب الصلاحية" (anyone
 * holding a permission); `role` and `user` are the two other resolvable modes.
 * A "document owner/approver" mode is deliberately absent: no document entity
 * in this build records an owner or an assigned approver, so such a rule could
 * never resolve to a real user.
 */
export const NOTIFICATION_RECIPIENT_TYPES = ["permission", "role", "user"] as const;
export type NotificationRecipientType = (typeof NOTIFICATION_RECIPIENT_TYPES)[number];

export const NOTIFICATION_CONDITION_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
] as const;
export type NotificationConditionOperator = (typeof NOTIFICATION_CONDITION_OPERATORS)[number];

/** An optional guard layered on the trigger: `field operator value` over the event payload. */
export interface NotificationCondition {
  readonly field: string;
  readonly operator: NotificationConditionOperator;
  readonly value: string;
}

export interface NotificationRule {
  readonly id: string;
  readonly name: string;
  readonly eventCode: EventCode;
  readonly condition: NotificationCondition | null;
  readonly recipientType: NotificationRecipientType;
  /** Permission code / role id / user id, depending on `recipientType`. */
  readonly recipientValue: string;
  readonly priority: NotificationPriority;
  readonly channels: readonly NotificationChannel[];
  /** Optional overrides; `{{docNo}}`-style placeholders are filled from the event payload. */
  readonly titleTemplate: string | null;
  readonly bodyTemplate: string | null;
  readonly enabled: boolean;
  readonly createdAt: string;
}

export interface NotificationRuleRepository {
  list(): Promise<NotificationRule[]>;
  findById(id: string): Promise<NotificationRule | null>;
  save(rule: NotificationRule): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface CreateNotificationRuleCommand {
  readonly id: string;
  readonly name: string;
  readonly eventCode: string;
  readonly condition?: NotificationCondition | null;
  readonly recipientType: NotificationRecipientType;
  readonly recipientValue: string;
  readonly priority?: NotificationPriority;
  readonly channels?: readonly NotificationChannel[];
  readonly titleTemplate?: string | null;
  readonly bodyTemplate?: string | null;
  readonly enabled?: boolean;
  readonly createdAt?: string;
}

export interface UpdateNotificationRuleCommand {
  readonly name?: string;
  readonly eventCode?: string;
  readonly condition?: NotificationCondition | null;
  readonly recipientType?: NotificationRecipientType;
  readonly recipientValue?: string;
  readonly priority?: NotificationPriority;
  readonly channels?: readonly NotificationChannel[];
  readonly titleTemplate?: string | null;
  readonly bodyTemplate?: string | null;
  readonly enabled?: boolean;
}

const NUMERIC_OPERATORS: readonly NotificationConditionOperator[] = ["gt", "gte", "lt", "lte"];

function validate(rule: NotificationRule): string[] {
  const reasons: string[] = [];
  if (rule.id.trim() === "") reasons.push("id is required");
  if (rule.name.trim() === "") reasons.push("name is required");

  const trigger = findNotificationTrigger(rule.eventCode);
  if (!trigger) {
    reasons.push(`"${rule.eventCode}" is not a known trigger event`);
  }
  if (rule.recipientValue.trim() === "") {
    reasons.push("recipientValue is required");
  }
  if (rule.channels.length === 0) {
    reasons.push("at least one delivery channel is required");
  }
  for (const channel of rule.channels) {
    if (!NOTIFICATION_CHANNELS.includes(channel)) reasons.push(`unknown channel "${channel}"`);
  }
  if (rule.condition) {
    const { field, operator, value } = rule.condition;
    if (field.trim() === "") reasons.push("condition.field is required");
    if (!NOTIFICATION_CONDITION_OPERATORS.includes(operator)) {
      reasons.push(`unknown condition operator "${operator}"`);
    }
    if (value.trim() === "") reasons.push("condition.value is required");
    if (NUMERIC_OPERATORS.includes(operator) && Number.isNaN(Number(value))) {
      reasons.push(`condition.value must be numeric for operator "${operator}"`);
    }
    if (trigger && trigger.conditionFields.length > 0) {
      const known = trigger.conditionFields.some((f) => f.key === field);
      if (!known) {
        reasons.push(`"${field}" is not a payload field of event "${rule.eventCode}"`);
      }
    }
  }
  return reasons;
}

function normalizeChannels(channels: readonly NotificationChannel[]): readonly NotificationChannel[] {
  return NOTIFICATION_CHANNELS.filter((c) => channels.includes(c));
}

export async function createNotificationRule(
  command: CreateNotificationRuleCommand,
  repo: NotificationRuleRepository,
): Promise<NotificationRule> {
  const rule: NotificationRule = {
    id: command.id,
    name: command.name,
    eventCode: command.eventCode as EventCode,
    condition: command.condition ?? null,
    recipientType: command.recipientType,
    recipientValue: command.recipientValue,
    priority: command.priority ?? "normal",
    channels: normalizeChannels(command.channels ?? ["in_app"]),
    titleTemplate: command.titleTemplate ?? null,
    bodyTemplate: command.bodyTemplate ?? null,
    enabled: command.enabled ?? true,
    createdAt: command.createdAt ?? new Date().toISOString(),
  };
  const reasons = validate(rule);
  if (reasons.length > 0) throw new InvalidNotificationRuleError(reasons);
  await repo.save(rule);
  return rule;
}

/** Applies a patch to an existing rule. `id` and `createdAt` are immutable. */
export async function updateNotificationRule(
  id: string,
  patch: UpdateNotificationRuleCommand,
  repo: NotificationRuleRepository,
): Promise<NotificationRule> {
  const current = await repo.findById(id);
  if (!current) throw new NotificationRuleNotFoundError(id);
  const next: NotificationRule = {
    ...current,
    name: patch.name ?? current.name,
    eventCode: (patch.eventCode ?? current.eventCode) as EventCode,
    condition: patch.condition === undefined ? current.condition : patch.condition,
    recipientType: patch.recipientType ?? current.recipientType,
    recipientValue: patch.recipientValue ?? current.recipientValue,
    priority: patch.priority ?? current.priority,
    channels: patch.channels ? normalizeChannels(patch.channels) : current.channels,
    titleTemplate: patch.titleTemplate === undefined ? current.titleTemplate : patch.titleTemplate,
    bodyTemplate: patch.bodyTemplate === undefined ? current.bodyTemplate : patch.bodyTemplate,
    enabled: patch.enabled ?? current.enabled,
  };
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidNotificationRuleError(reasons);
  await repo.save(next);
  return next;
}

export async function setNotificationRuleEnabled(
  id: string,
  enabled: boolean,
  repo: NotificationRuleRepository,
): Promise<NotificationRule> {
  return updateNotificationRule(id, { enabled }, repo);
}

export async function deleteNotificationRule(
  id: string,
  repo: NotificationRuleRepository,
): Promise<void> {
  const rule = await repo.findById(id);
  if (!rule) throw new NotificationRuleNotFoundError(id);
  await repo.delete(id);
}
