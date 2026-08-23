import type { EventCode } from "../events/catalog.js";
import type { NotificationChannel, NotificationPriority } from "./rule.js";

/**
 * A generated notification, addressed to ONE user (docs/catalog/09 §قواعد
 * الإشعارات + the shell's notifications bell). Read/unread is per-row state, so
 * two recipients of the same rule read it independently.
 */
export interface Notification {
  readonly id: string;
  readonly userId: string;
  /** The rule that produced it; null for a notification raised outside the rules engine. */
  readonly ruleId: string | null;
  readonly eventCode: EventCode;
  readonly channel: NotificationChannel;
  readonly priority: NotificationPriority;
  readonly title: string;
  readonly body: string;
  /** Optional document reference: `{ docType, docId }` joined as `DOC_TYPE:id`, or null. */
  readonly reference: string | null;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface NotificationListFilter {
  readonly unreadOnly?: boolean;
  readonly limit?: number;
}

export interface NotificationRepository {
  listForUser(userId: string, filter?: NotificationListFilter): Promise<Notification[]>;
  countUnread(userId: string): Promise<number>;
  save(notification: Notification): Promise<void>;
  /** Marks one of the user's own notifications read; returns null when it isn't theirs. */
  markRead(userId: string, notificationId: string, readAt: string): Promise<Notification | null>;
  /** Marks every unread notification of the user read; returns how many changed. */
  markAllRead(userId: string, readAt: string): Promise<number>;
}

/**
 * Delivery port — one adapter per channel. The engine only ever calls the
 * adapters it was given, so an unimplemented channel (email, WhatsApp) is
 * reported as skipped rather than pretended.
 */
export interface NotificationDeliveryPort {
  deliver(notification: Notification): Promise<void>;
}

/** In-app delivery: persist the notification so the bell and `/notifications/me` can read it. */
export function createInAppDelivery(repo: NotificationRepository): NotificationDeliveryPort {
  return {
    async deliver(notification) {
      await repo.save(notification);
    },
  };
}
