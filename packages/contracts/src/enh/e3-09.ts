import { z } from "zod";

export enum ApiKeyScopeDTO {
  CustomersRead = "customers:read",
  CustomersWrite = "customers:write",
  SuppliersRead = "suppliers:read",
  ItemsRead = "items:read",
  StockRead = "stock:read",
  SalesInvoicesRead = "sales_invoices:read",
  SalesInvoicesWrite = "sales_invoices:write",
  ReceiptsRead = "receipts:read",
  ReceiptsWrite = "receipts:write",
  PaymentsRead = "payments:read",
  TrialBalanceRead = "trial_balance:read",
}

export enum ApiKeyStatusDTO {
  Active = "active",
  Expired = "expired",
  Revoked = "revoked",
}

export enum WebhookDeliveryStatusDTO {
  Pending = "pending",
  Delivered = "delivered",
  DeadLetter = "dead_letter",
  Skipped = "skipped",
}

export enum IntegrationRefusal {
  ValidationError = "VALIDATION_ERROR",
  NotFound = "NOT_FOUND",
  ScopeExceedsGrant = "API_KEY_SCOPE_EXCEEDS_GRANT",
  KeyAlreadyRevoked = "API_KEY_ALREADY_REVOKED",
  TooManyKeys = "API_KEY_LIMIT_REACHED",
  TooManyWebhooks = "WEBHOOK_LIMIT_REACHED",
  TargetRefused = "WEBHOOK_TARGET_REFUSED",
  UnknownEvent = "WEBHOOK_UNKNOWN_EVENT",
  DeliveryNotRedeliverable = "WEBHOOK_DELIVERY_NOT_REDELIVERABLE",
  WebhookInactive = "WEBHOOK_INACTIVE",
}

export enum PublicApiRefusal {
  Unauthenticated = "API_KEY_INVALID",
  KeyNotAcceptedHere = "API_KEY_NOT_ACCEPTED_HERE",
  InsufficientScope = "API_KEY_INSUFFICIENT_SCOPE",
  ModuleNotLicensed = "INTEGRATIONS_NOT_LICENSED",
  RateLimited = "RATE_LIMITED",
  NotFound = "NOT_FOUND",
  IdempotencyKeyInvalid = "IDEMPOTENCY_KEY_INVALID",
  IdempotencyInFlight = "IDEMPOTENCY_KEY_IN_FLIGHT",
  ValidationError = "VALIDATION_ERROR",
}

export const API_KEY_TOKEN_PREFIX = "mzn_";
export const PUBLIC_API_BASE_PATH = "/api/v1";
export const PUBLIC_API_IDEMPOTENCY_HEADER = "idempotency-key";
export const WEBHOOK_SIGNATURE_HEADER = "mezan-signature";
export const WEBHOOK_EVENT_HEADER = "mezan-event";
export const WEBHOOK_DELIVERY_HEADER = "mezan-delivery-id";
export const WEBHOOK_ATTEMPT_HEADER = "mezan-attempt";
export const WEBHOOK_TEST_EVENT = "WEBHOOK_TEST";
export const API_KEY_NAME_MAX = 80;
export const WEBHOOK_NAME_MAX = 80;
export const WEBHOOK_URL_MAX = 2048;
export const IDEMPOTENCY_KEY_MAX = 128;

const scopeSchema = z.nativeEnum(ApiKeyScopeDTO);

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(API_KEY_NAME_MAX),
  scopes: z.array(scopeSchema).min(1).max(Object.keys(ApiKeyScopeDTO).length),
  expiresAt: z.string().datetime({ offset: true }).nullish(),
});
export type CreateApiKeyDTO = z.infer<typeof createApiKeySchema>;

export const createWebhookSchema = z.object({
  name: z.string().trim().min(1).max(WEBHOOK_NAME_MAX),
  url: z.string().trim().url().max(WEBHOOK_URL_MAX),
  events: z.array(z.string().min(1)).min(1).max(100),
});
export type CreateWebhookDTO = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z.object({
  name: z.string().trim().min(1).max(WEBHOOK_NAME_MAX).optional(),
  url: z.string().trim().url().max(WEBHOOK_URL_MAX).optional(),
  events: z.array(z.string().min(1)).min(1).max(100).optional(),
  active: z.boolean().optional(),
});
export type UpdateWebhookDTO = z.infer<typeof updateWebhookSchema>;

export const webhookDeliveryQuerySchema = z.object({
  webhookId: z.string().min(1).optional(),
  status: z.nativeEnum(WebhookDeliveryStatusDTO).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export interface ApiKeyDTO {
  readonly id: string;
  readonly name: string;
  readonly displayPrefix: string;
  readonly scopes: readonly ApiKeyScopeDTO[];
  readonly status: ApiKeyStatusDTO;
  readonly createdBy: string;
  readonly createdByName: string | null;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
}

export interface ApiKeyCreatedDTO {
  readonly key: ApiKeyDTO;
  readonly token: string;
}

export interface WebhookDTO {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly events: readonly string[];
  readonly active: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly secretRotatedAt: string;
  readonly pending: number;
  readonly deadLetters: number;
  readonly lastDeliveredAt: string | null;
}

export interface WebhookCreatedDTO {
  readonly webhook: WebhookDTO;
  readonly signingSecret: string;
}

export interface WebhookDeliveryDTO {
  readonly id: string;
  readonly webhookId: string;
  readonly webhookName: string | null;
  readonly eventCode: string;
  readonly status: WebhookDeliveryStatusDTO;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly lastStatusCode: number | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
  readonly redeliveryOf: string | null;
  readonly payload: string;
}

export interface ApiScopeOptionDTO {
  readonly scope: ApiKeyScopeDTO;
  readonly permissions: readonly string[];
  readonly grantable: boolean;
  readonly write: boolean;
}

export interface WebhookEventOptionDTO {
  readonly code: string;
  readonly category: string;
  readonly labelAr: string;
}

export interface IntegrationsCatalogDTO {
  readonly scopes: readonly ApiScopeOptionDTO[];
  readonly events: readonly WebhookEventOptionDTO[];
  readonly apiBasePath: string;
  readonly openApiPath: string;
  readonly signatureHeader: string;
  readonly maxDeliveryAttempts: number;
  readonly signatureToleranceSeconds: number;
  readonly rateLimitPerMinute: number;
}
