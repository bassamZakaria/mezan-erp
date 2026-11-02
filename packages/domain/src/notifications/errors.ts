import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";

export class InvalidNotificationRuleError extends Error {
  readonly code = "INVALID_NOTIFICATION_RULE";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "it failed validation");
    super(`قاعدة الإشعار غير صالحة: ${split.ar.join("، ")}`);
    this.reasons = split.ar;
    this.messageEn = `Invalid notification rule: ${split.en}`;
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
