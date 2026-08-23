import { z } from "zod";

/**
 * Wire contracts for قواعد الإشعارات (docs/catalog/09, `/notifications/rules`)
 * and the per-user notification read model behind the shell's bell.
 *
 * `channel` models all three channels the reference form offers, but only
 * `in_app` has a delivery adapter in this build — `GET /notifications/triggers`
 * reports which channels are actually implemented so the UI never promises a
 * delivery that will not happen.
 */
export const notificationChannelSchema = z.enum(["in_app", "email", "whatsapp"]);
export const notificationPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const notificationRecipientTypeSchema = z.enum(["permission", "role", "user"]);
export const notificationConditionOperatorSchema = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
]);

export const notificationConditionSchema = z.object({
  field: z.string().min(1),
  operator: notificationConditionOperatorSchema,
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
  channels: z.array(notificationChannelSchema),
  titleTemplate: z.string().nullable(),
  bodyTemplate: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
});

export const createNotificationRuleSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  eventCode: z.string().min(1),
  condition: notificationConditionSchema.nullable().optional(),
  recipientType: notificationRecipientTypeSchema,
  recipientValue: z.string().min(1),
  priority: notificationPrioritySchema.optional(),
  channels: z.array(notificationChannelSchema).min(1).optional(),
  titleTemplate: z.string().nullable().optional(),
  bodyTemplate: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export const updateNotificationRuleSchema = z.object({
  name: z.string().min(1).optional(),
  eventCode: z.string().min(1).optional(),
  condition: notificationConditionSchema.nullable().optional(),
  recipientType: notificationRecipientTypeSchema.optional(),
  recipientValue: z.string().min(1).optional(),
  priority: notificationPrioritySchema.optional(),
  channels: z.array(notificationChannelSchema).min(1).optional(),
  titleTemplate: z.string().nullable().optional(),
  bodyTemplate: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export const notificationTriggerFieldSchema = z.object({
  key: z.string().min(1),
  labelAr: z.string().min(1),
  kind: z.enum(["number", "text"]),
});

export const notificationTriggerSchema = z.object({
  code: z.string().min(1),
  category: z.string().min(1),
  labelAr: z.string().min(1),
  /** False when nothing in this build publishes the event yet. */
  emitted: z.boolean(),
  conditionFields: z.array(notificationTriggerFieldSchema),
});

export const notificationTriggerCatalogSchema = z.object({
  triggers: z.array(notificationTriggerSchema),
  implementedChannels: z.array(notificationChannelSchema),
});

export const notificationSchema = z.object({
  id: z.string().min(1),
  ruleId: z.string().nullable(),
  eventCode: z.string().min(1),
  channel: notificationChannelSchema,
  priority: notificationPrioritySchema,
  title: z.string(),
  body: z.string(),
  reference: z.string().nullable(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});

export const notificationInboxSchema = z.object({
  notifications: z.array(notificationSchema),
  unreadCount: z.number().int().nonnegative(),
});

export type NotificationChannelDTO = z.infer<typeof notificationChannelSchema>;
export type NotificationPriorityDTO = z.infer<typeof notificationPrioritySchema>;
export type NotificationRecipientTypeDTO = z.infer<typeof notificationRecipientTypeSchema>;
export type NotificationConditionOperatorDTO = z.infer<typeof notificationConditionOperatorSchema>;
export type NotificationConditionDTO = z.infer<typeof notificationConditionSchema>;
export type NotificationRuleDTO = z.infer<typeof notificationRuleSchema>;
export type CreateNotificationRuleDTO = z.infer<typeof createNotificationRuleSchema>;
export type UpdateNotificationRuleDTO = z.infer<typeof updateNotificationRuleSchema>;
export type NotificationTriggerFieldDTO = z.infer<typeof notificationTriggerFieldSchema>;
export type NotificationTriggerDTO = z.infer<typeof notificationTriggerSchema>;
export type NotificationTriggerCatalogDTO = z.infer<typeof notificationTriggerCatalogSchema>;
export type NotificationDTO = z.infer<typeof notificationSchema>;
export type NotificationInboxDTO = z.infer<typeof notificationInboxSchema>;
