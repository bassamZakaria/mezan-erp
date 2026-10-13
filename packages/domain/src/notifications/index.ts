export {
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_CHANNELS,
  CONDITION_OPERATORS,
  NOTIFICATION_RECIPIENT_TYPES,
  NotificationChannelState,
  NotificationChannelCode,
  NotificationPriorityCode,
  NotificationReadStatusCode,
  type NotificationPriority,
  type NotificationChannel,
  type ConditionOperator,
  type NotificationRecipientType,
  type NotificationCondition,
  type NotificationRule,
  type NotificationRuleListFilter,
  type NotificationRuleRepository,
  type NotificationReadStatus,
  type NotificationChannelStatus,
  type Notification,
  type NotificationListFilter,
  type NotificationRepository,
} from "./types.js";

export { evaluateCondition } from "./condition.js";
export { renderTemplate, defaultNotificationTitle, defaultNotificationBody } from "./template.js";

export {
  InvalidNotificationRuleError,
  NotificationRuleNotFoundError,
  NotificationNotFoundError,
} from "./errors.js";

export {
  saveNotificationRule,
  updateNotificationRule,
  deleteNotificationRule,
  setNotificationRuleActive,
  type SaveNotificationRuleCommand,
  type UpdateNotificationRuleCommand,
} from "./save-rule.js";

export { markNotificationRead, markAllNotificationsRead } from "./actions.js";

export { NotificationRulesEngine, type NotificationRulesEngineDeps } from "./engine.js";

export {
  IMPLEMENTED_NOTIFICATION_CHANNELS,
  buildNotificationTriggerCatalog,
  type NotificationTrigger,
} from "./triggers.js";
export {
  NotificationDispatcher,
  DEFAULT_DISPATCH_POLICY,
  type NotificationDispatcherDeps,
  SETTLED_AS,
  type NotificationTransport,
  type DispatchOutcome,
  type DispatchPolicy,
  type DrainResult,
} from "./dispatcher.js";
