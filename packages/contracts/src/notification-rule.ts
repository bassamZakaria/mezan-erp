import { z } from "zod";
import { clientSuppliedId } from "./client-supplied-id.js";

/**
 * Wire contract for قواعد الإشعارات / notification rules (docs/archive/catalog/09
 * §قواعد الإشعارات). `eventCode` is validated as a non-empty string here —
 * the authoritative closed set of the 39 catalog codes lives in
 * `@mezan/domain`'s `DOMAIN_EVENT_CATALOG`, which both ends import — same
 * "permissive wire schema" rationale as `domainEventSchema` in `events.ts`.
 */

export const notificationPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const notificationChannelSchema = z.enum(["in_app", "email", "push"]);
export const conditionOperatorSchema = z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains"]);
export const notificationRecipientTypeSchema = z.enum(["permission", "role", "user"]);

export const notificationConditionSchema = z.object({
  field: z.string().min(1),
  operator: conditionOperatorSchema,
  value: z.string().min(1),
});

export const notificationRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  eventCode: z.string().min(1),
  condition: notificationConditionSchema.nullable(),
  recipientType: notificationRecipientTypeSchema,
  recipientValue: z.string().min(1),
  priority: notificationPrioritySchema,
  channels: z.array(notificationChannelSchema).min(1),
  titleAr: z.string().nullable(),
  bodyAr: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createNotificationRuleSchema = z.object({
  id: clientSuppliedId.optional(),
  name: z.string().min(1),
  eventCode: z.string().min(1),
  condition: notificationConditionSchema.nullish(),
  recipientType: notificationRecipientTypeSchema,
  recipientValue: z.string().min(1),
  priority: notificationPrioritySchema.default("normal"),
  channels: z.array(notificationChannelSchema).min(1),
  titleAr: z.string().nullish(),
  bodyAr: z.string().nullish(),
  active: z.boolean().default(true),
});

export const updateNotificationRuleSchema = createNotificationRuleSchema.omit({ id: true });

/**
 * The trigger catalog the rule builder reads: every catalogued event code
 * annotated with whether THIS build actually publishes it, plus the channels
 * that actually send. A rule bound to a non-emitted trigger, or a channel that
 * is not implemented, can never deliver — the builder says so up front.
 */
export const notificationTriggerSchema = z.object({
  code: z.string().min(1),
  category: z.string().min(1),
  labelAr: z.string().min(1),
  emitted: z.boolean(),
});

export const notificationTriggerCatalogSchema = z.object({
  triggers: z.array(notificationTriggerSchema),
  implementedChannels: z.array(notificationChannelSchema),
});

export type NotificationPriorityDTO = z.infer<typeof notificationPrioritySchema>;
export type NotificationChannelDTO = z.infer<typeof notificationChannelSchema>;
export type ConditionOperatorDTO = z.infer<typeof conditionOperatorSchema>;
export type NotificationRecipientTypeDTO = z.infer<typeof notificationRecipientTypeSchema>;
export type NotificationConditionDTO = z.infer<typeof notificationConditionSchema>;
export type NotificationRuleDTO = z.infer<typeof notificationRuleSchema>;
export type NotificationTriggerDTO = z.infer<typeof notificationTriggerSchema>;
export type NotificationTriggerCatalogDTO = z.infer<typeof notificationTriggerCatalogSchema>;
export type CreateNotificationRuleDTO = z.infer<typeof createNotificationRuleSchema>;
export type UpdateNotificationRuleDTO = z.infer<typeof updateNotificationRuleSchema>;
