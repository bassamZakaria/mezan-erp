/** Raised when an operation references a notification-rule id that does not exist. */
export class NotificationRuleNotFoundError extends Error {
  readonly code = "NOTIFICATION_RULE_NOT_FOUND";
  constructor(readonly ruleId: string) {
    super(`Notification rule "${ruleId}" was not found.`);
    this.name = "NotificationRuleNotFoundError";
  }
}

/**
 * Aggregated field-validation failure for a notification rule. `reasons` lists
 * every violation found, not just the first, so the rule form can surface them
 * all at once.
 */
export class InvalidNotificationRuleError extends Error {
  readonly code = "INVALID_NOTIFICATION_RULE";
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid notification rule: ${reasons.join("; ")}`);
    this.name = "InvalidNotificationRuleError";
  }
}

/** Raised when marking a notification read that does not belong to the caller. */
export class NotificationNotFoundError extends Error {
  readonly code = "NOTIFICATION_NOT_FOUND";
  constructor(readonly notificationId: string) {
    super(`Notification "${notificationId}" was not found.`);
    this.name = "NotificationNotFoundError";
  }
}
