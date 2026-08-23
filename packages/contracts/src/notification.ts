import { z } from "zod";
import { notificationChannelSchema, notificationPrioritySchema } from "./notification-rule.js";

/** Wire contract for a generated in-app notification instance (the top-bar bell panel's data). */
export const notificationChannelStatusSchema = z.enum(["delivered", "queued"]);

export const notificationSchema = z.object({
  id: z.string().min(1),
  ruleId: z.string().min(1).nullable(),
  recipientUserId: z.string().min(1),
  eventCode: z.string().min(1),
  title: z.string(),
  body: z.string(),
  priority: notificationPrioritySchema,
  channels: z.array(notificationChannelSchema),
  channelStatus: z.record(z.string(), notificationChannelStatusSchema),
  status: z.enum(["unread", "read"]),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});

export const notificationListQuerySchema = z.object({
  status: z.enum(["unread", "read"]).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const unreadCountResponseSchema = z.object({
  count: z.number().int().nonnegative(),
});

export type NotificationChannelStatusDTO = z.infer<typeof notificationChannelStatusSchema>;
export type NotificationDTO = z.infer<typeof notificationSchema>;
export type NotificationListQueryDTO = z.infer<typeof notificationListQuerySchema>;
export type UnreadCountResponseDTO = z.infer<typeof unreadCountResponseSchema>;
