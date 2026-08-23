export class InvalidNotificationRuleError extends Error {
  readonly code = "INVALID_NOTIFICATION_RULE";
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid notification rule: ${reasons.join("; ")}`);
    this.name = "InvalidNotificationRuleError";
  }
}

export class NotificationRuleNotFoundError extends Error {
  readonly code = "NOTIFICATION_RULE_NOT_FOUND";
  constructor(readonly id: string) {
    super(`Notification rule "${id}" not found.`);
    this.name = "NotificationRuleNotFoundError";
  }
}

export class NotificationNotFoundError extends Error {
  readonly code = "NOTIFICATION_NOT_FOUND";
  constructor(readonly id: string) {
    super(`Notification "${id}" not found.`);
    this.name = "NotificationNotFoundError";
  }
}
