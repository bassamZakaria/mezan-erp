import type { EventCode } from "../events/catalog.js";

/**
 * Notification rules engine — types (docs/archive/catalog/09 §قواعد الإشعارات,
 * docs/archive/plan.md §5.6). A rule maps ONE catalog event code to an optional
 * condition, a recipient (by permission / role / specific user), a priority,
 * a set of delivery channels, and optional Arabic title/body templates.
 *
 * `docs/archive/plan.md` §5.6 asymmetry to preserve: unlike the workflow gate's
 * unconditional action types, a notification rule's condition is OPTIONAL —
 * `null` means "fires on every occurrence of the event."
 */

export type NotificationPriority = "low" | "normal" | "high" | "urgent";
export const NOTIFICATION_PRIORITIES: readonly NotificationPriority[] = [
  "low",
  "normal",
  "high",
  "urgent",
];

/**
 * Delivery channels (docs/archive/catalog/09: داخل التطبيق / بريد إلكتروني / إشعار
 * فوري). In-app is generated and persisted for real; email/push are recorded
 * as "queued" only — this repo has no outbound mail/push transport yet
 * (docs/archive/plan.md line 535: "the rules engine must degrade per channel, not
 * per rule").
 */
export type NotificationChannel = "in_app" | "email" | "push";
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  "in_app",
  "email",
  "push",
];

export type ConditionOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains";
export const CONDITION_OPERATORS: readonly ConditionOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
];

/** Who receives a rule's notifications. */
export type NotificationRecipientType = "permission" | "role" | "user";
export const NOTIFICATION_RECIPIENT_TYPES: readonly NotificationRecipientType[] = [
  "permission",
  "role",
  "user",
];

export interface NotificationCondition {
  /** A key inside the triggering event's payload, e.g. "amount". */
  readonly field: string;
  readonly operator: ConditionOperator;
  /** Always a string on the wire; numeric comparisons parse it with `Number()`. */
  readonly value: string;
}

export interface NotificationRule {
  readonly id: string;
  readonly name: string;
  readonly eventCode: EventCode;
  /** `null` = unconditional (fires on every occurrence of `eventCode`). */
  readonly condition: NotificationCondition | null;
  readonly recipientType: NotificationRecipientType;
  /**
   * Depends on `recipientType`: a permission code (`notifications.rule.view`
   * style), a role id, or a user id.
   */
  readonly recipientValue: string;
  readonly priority: NotificationPriority;
  /** At least one channel; order is not significant. */
  readonly channels: readonly NotificationChannel[];
  /** Optional Arabic title override. `{{customerName}}`/`{{amount}}`/`{{documentNumber}}` tokens. */
  readonly titleAr: string | null;
  /** Optional Arabic body override, same token set. */
  readonly bodyAr: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Persistence port for notification rules. The domain depends on this interface only. */
export interface NotificationRuleListFilter {
  readonly active?: boolean;
  readonly eventCode?: string;
}

export interface NotificationRuleRepository {
  save(rule: NotificationRule): Promise<void>;
  update(rule: NotificationRule): Promise<void>;
  findById(id: string): Promise<NotificationRule | null>;
  list(filter?: NotificationRuleListFilter): Promise<readonly NotificationRule[]>;
  /** Only the ACTIVE rules targeting this event code — what the engine dispatches against. */
  listActiveByEventCode(eventCode: string): Promise<readonly NotificationRule[]>;
  delete(id: string): Promise<void>;
}

export type NotificationReadStatus = "unread" | "read";

/**
 * Per-channel delivery status. `delivered` is in-app (a row the user can
 * read). `queued` is waiting for the dispatcher; `sending` is claimed by one
 * drain and with the transport right now; `sent` was accepted by the
 * transport; `failed` is terminal — rejected by the server, or abandoned as
 * stale. Being offline is none of these: it puts the status back on `queued`
 * (see `dispatcher.ts`).
 */
export enum NotificationChannelState {
  Delivered = "delivered",
  Queued = "queued",
  Sending = "sending",
  Sent = "sent",
  Failed = "failed",
}

export type NotificationChannelStatus = `${NotificationChannelState}`;

/** A generated notification instance — one rule match × one recipient. */
export interface Notification {
  readonly id: string;
  /** Null if the originating rule was later deleted. */
  readonly ruleId: string | null;
  readonly recipientUserId: string;
  readonly eventCode: string;
  readonly title: string;
  readonly body: string;
  readonly priority: NotificationPriority;
  readonly channels: readonly NotificationChannel[];
  /** e.g. `{ in_app: "delivered", email: "queued" }` — one entry per requested channel. */
  readonly channelStatus: Readonly<Record<string, NotificationChannelStatus>>;
  readonly status: NotificationReadStatus;
  /** The triggering event's payload, kept for the panel's detail line. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface NotificationListFilter {
  readonly status?: NotificationReadStatus;
  readonly limit?: number;
}

export interface NotificationRepository {
  save(notification: Notification): Promise<void>;
  findById(id: string): Promise<Notification | null>;
  listForUser(userId: string, filter?: NotificationListFilter): Promise<readonly Notification[]>;
  countUnread(userId: string): Promise<number>;
  /** No-ops (does not throw) if the notification doesn't belong to `userId` or is already read. */
  markRead(id: string, userId: string, readAt: string): Promise<void>;
  markAllRead(userId: string, readAt: string): Promise<void>;
}
