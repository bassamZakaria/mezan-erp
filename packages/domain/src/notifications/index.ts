export {
  NOTIFICATION_CHANNELS,
  IMPLEMENTED_NOTIFICATION_CHANNELS,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_RECIPIENT_TYPES,
  NOTIFICATION_CONDITION_OPERATORS,
  createNotificationRule,
  updateNotificationRule,
  setNotificationRuleEnabled,
  deleteNotificationRule,
} from "./rule.js";
export type {
  NotificationChannel,
  NotificationPriority,
  NotificationRecipientType,
  NotificationConditionOperator,
  NotificationCondition,
  NotificationRule,
  NotificationRuleRepository,
  CreateNotificationRuleCommand,
  UpdateNotificationRuleCommand,
} from "./rule.js";

export { NOTIFICATION_TRIGGERS, findNotificationTrigger } from "./triggers.js";
export type { NotificationTrigger, TriggerConditionField } from "./triggers.js";

export { matchesCondition, readPayloadField } from "./condition.js";

export { evaluateRule, evaluateRules, renderTemplate } from "./evaluate.js";
export type { NotificationDraft, NotificationEvaluationContext } from "./evaluate.js";

export { createInAppDelivery } from "./notification.js";
export type {
  Notification,
  NotificationListFilter,
  NotificationRepository,
  NotificationDeliveryPort,
} from "./notification.js";

export { createNotificationDirectory, resolveRecipients } from "./recipients.js";
export type { NotificationDirectory } from "./recipients.js";

export {
  NotificationEngine,
  subscribeNotificationEngine,
  implementedChannels,
} from "./engine.js";
export type {
  NotificationEngineDeps,
  NotificationDispatchResult,
  NotificationPayloadEnricher,
} from "./engine.js";

export { createDocumentEventBridge, toNotificationEventCode } from "./document-event-bridge.js";
export type { DocumentEventPayload } from "./document-event-bridge.js";

export {
  NotificationRuleNotFoundError,
  InvalidNotificationRuleError,
  NotificationNotFoundError,
} from "./errors.js";
