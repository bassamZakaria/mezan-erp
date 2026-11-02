import type { BilingualReason } from "../collections/errors.js";
import { isEventCode, type EventCode } from "../events/catalog.js";
import { InvalidNotificationRuleError, NotificationRuleNotFoundError } from "./errors.js";
import {
  CONDITION_OPERATORS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_RECIPIENT_TYPES,
  type NotificationChannel,
  type NotificationCondition,
  type NotificationPriority,
  type NotificationRecipientType,
  type NotificationRule,
  type NotificationRuleRepository,
} from "./types.js";

export interface SaveNotificationRuleCommand {
  readonly id: string;
  readonly name: string;
  readonly eventCode: string;
  readonly condition: NotificationCondition | null;
  readonly recipientType: NotificationRecipientType;
  readonly recipientValue: string;
  readonly priority: NotificationPriority;
  readonly channels: readonly NotificationChannel[];
  readonly titleAr: string | null;
  readonly bodyAr: string | null;
  readonly active: boolean;
}

function validate(cmd: SaveNotificationRuleCommand): EventCode {
  const reasons: BilingualReason[] = [];

  if (cmd.name.trim() === "") reasons.push({ ar: "اسم القاعدة مطلوب.", en: "The rule name is required." });
  if (!isEventCode(cmd.eventCode)) reasons.push({ ar: `الحدث "${cmd.eventCode}" غير معروف.`, en: `Event "${cmd.eventCode}" is not recognised.` });

  if (!NOTIFICATION_RECIPIENT_TYPES.includes(cmd.recipientType)) {
    reasons.push({ ar: `نوع المستلم "${cmd.recipientType}" غير معروف.`, en: `Recipient type "${cmd.recipientType}" is not recognised.` });
  }
  if (cmd.recipientValue.trim() === "") reasons.push({ ar: "قيمة المستلم مطلوبة.", en: "The recipient value is required." });

  if (!NOTIFICATION_PRIORITIES.includes(cmd.priority)) {
    reasons.push({ ar: `الأولوية "${cmd.priority}" غير معروفة.`, en: `Priority "${cmd.priority}" is not recognised.` });
  }

  if (cmd.channels.length === 0) {
    reasons.push({ ar: "يجب اختيار قناة إرسال واحدة على الأقل.", en: "Choose at least one delivery channel." });
  }
  for (const channel of cmd.channels) {
    if (!NOTIFICATION_CHANNELS.includes(channel)) reasons.push({ ar: `قناة الإرسال "${channel}" غير معروفة.`, en: `Delivery channel "${channel}" is not recognised.` });
  }

  if (cmd.condition) {
    if (cmd.condition.field.trim() === "") reasons.push({ ar: "حقل الشرط مطلوب عند وجود شرط.", en: "The condition field is required when a condition is set." });
    if (!CONDITION_OPERATORS.includes(cmd.condition.operator)) {
      reasons.push({ ar: `عامل الشرط "${cmd.condition.operator}" غير معروف.`, en: `Condition operator "${cmd.condition.operator}" is not recognised.` });
    }
    if (cmd.condition.value.trim() === "") reasons.push({ ar: "قيمة الشرط مطلوبة عند وجود شرط.", en: "The condition value is required when a condition is set." });
  }

  if (reasons.length > 0) throw new InvalidNotificationRuleError(reasons);
  return cmd.eventCode as EventCode;
}

/** Creates a new notification rule (docs/archive/catalog/09 §"إضافة قاعدة" dialog). */
export async function saveNotificationRule(
  cmd: SaveNotificationRuleCommand,
  repo: NotificationRuleRepository,
  now: () => string = () => new Date().toISOString(),
): Promise<NotificationRule> {
  const eventCode = validate(cmd);
  const timestamp = now();
  const rule: NotificationRule = {
    id: cmd.id,
    name: cmd.name.trim(),
    eventCode,
    condition: cmd.condition,
    recipientType: cmd.recipientType,
    recipientValue: cmd.recipientValue.trim(),
    priority: cmd.priority,
    channels: cmd.channels,
    titleAr: cmd.titleAr?.trim() ? cmd.titleAr.trim() : null,
    bodyAr: cmd.bodyAr?.trim() ? cmd.bodyAr.trim() : null,
    active: cmd.active,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await repo.save(rule);
  return rule;
}

export type UpdateNotificationRuleCommand = Omit<SaveNotificationRuleCommand, "id">;

/** Updates an existing notification rule in place, preserving `createdAt`. */
export async function updateNotificationRule(
  id: string,
  cmd: UpdateNotificationRuleCommand,
  repo: NotificationRuleRepository,
  now: () => string = () => new Date().toISOString(),
): Promise<NotificationRule> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotificationRuleNotFoundError(id);

  const eventCode = validate({ ...cmd, id });
  const rule: NotificationRule = {
    id,
    name: cmd.name.trim(),
    eventCode,
    condition: cmd.condition,
    recipientType: cmd.recipientType,
    recipientValue: cmd.recipientValue.trim(),
    priority: cmd.priority,
    channels: cmd.channels,
    titleAr: cmd.titleAr?.trim() ? cmd.titleAr.trim() : null,
    bodyAr: cmd.bodyAr?.trim() ? cmd.bodyAr.trim() : null,
    active: cmd.active,
    createdAt: existing.createdAt,
    updatedAt: now(),
  };
  await repo.update(rule);
  return rule;
}

export async function deleteNotificationRule(id: string, repo: NotificationRuleRepository): Promise<void> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotificationRuleNotFoundError(id);
  await repo.delete(id);
}

/** Toggles `active` without touching any other field — the list screen's quick on/off switch. */
export async function setNotificationRuleActive(
  id: string,
  active: boolean,
  repo: NotificationRuleRepository,
  now: () => string = () => new Date().toISOString(),
): Promise<NotificationRule> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotificationRuleNotFoundError(id);
  const rule: NotificationRule = { ...existing, active, updatedAt: now() };
  await repo.update(rule);
  return rule;
}
