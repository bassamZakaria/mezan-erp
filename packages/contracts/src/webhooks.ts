import { z } from "zod";

/** Wire shape for a listed webhook — never includes `secret`. */
export const webhookSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  targetUrl: z.string(),
  events: z.array(z.string()),
  active: z.boolean(),
  createdBy: z.string().min(1),
  createdAt: z.string(),
});

export const createWebhookSchema = z.object({
  name: z.string().min(1),
  targetUrl: z.string().url(),
  events: z.array(z.string().min(1)).min(1, "at least one event is required"),
});

export const updateWebhookSchema = z.object({
  name: z.string().min(1).optional(),
  targetUrl: z.string().url().optional(),
  events: z.array(z.string().min(1)).min(1).optional(),
  active: z.boolean().optional(),
});

/** Create response ONLY — carries the plaintext signing secret exactly once. */
export const createWebhookResultSchema = webhookSchema.extend({
  secret: z.string().min(1),
});

export const webhookDeliverySchema = z.object({
  id: z.string().min(1),
  webhookId: z.string().min(1),
  eventCode: z.string().min(1),
  attemptedAt: z.string(),
  statusCode: z.number().int().nullable(),
  success: z.boolean(),
  errorMessage: z.string().nullable(),
});

export type WebhookDTO = z.infer<typeof webhookSchema>;
export type CreateWebhookDTO = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookDTO = z.infer<typeof updateWebhookSchema>;
export type CreateWebhookResultDTO = z.infer<typeof createWebhookResultSchema>;
export type WebhookDeliveryDTO = z.infer<typeof webhookDeliverySchema>;
