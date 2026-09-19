export class InvalidNotificationRuleError extends Error {
  readonly code = "INVALID_NOTIFICATION_RULE";
  readonly messageEn: string;
  constructor(readonly reasons: readonly string[]) {
    super(`قاعدة الإشعار غير صالحة: ${reasons.join("، ")}`);
    this.messageEn = `Invalid notification rule: ${reasons.join("; ")}`;
    this.name = "InvalidNotificationRuleError";
  }
}

export class NotificationRuleNotFoundError extends Error {
  readonly code = "NOTIFICATION_RULE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`قاعدة الإشعار "${id}" غير موجودة.`);
    this.messageEn = `Notification rule "${id}" not found.`;
    this.name = "NotificationRuleNotFoundError";
  }
}

export class NotificationNotFoundError extends Error {
  readonly code = "NOTIFICATION_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`الإشعار "${id}" غير موجود.`);
    this.messageEn = `Notification "${id}" not found.`;
    this.name = "NotificationNotFoundError";
  }
}
