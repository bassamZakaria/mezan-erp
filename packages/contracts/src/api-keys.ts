import { z } from "zod";

/** Wire shape for a listed API key — never includes the key or its hash. */
export const apiKeySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  prefix: z.string().min(1),
  scopes: z.array(z.string()),
  createdBy: z.string().min(1),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export const createApiKeySchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1, "at least one scope is required"),
});

/** Create response ONLY — carries the plaintext key exactly once. */
export const createApiKeyResultSchema = apiKeySchema.extend({
  key: z.string().min(1),
});

export type ApiKeyDTO = z.infer<typeof apiKeySchema>;
export type CreateApiKeyDTO = z.infer<typeof createApiKeySchema>;
export type CreateApiKeyResultDTO = z.infer<typeof createApiKeyResultSchema>;
