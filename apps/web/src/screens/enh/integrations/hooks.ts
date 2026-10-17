import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ApiKeyCreatedDTO,
  ApiKeyDTO,
  CreateApiKeyDTO,
  CreateWebhookDTO,
  IntegrationsCatalogDTO,
  UpdateWebhookDTO,
  WebhookCreatedDTO,
  WebhookDTO,
  WebhookDeliveryDTO,
  WebhookDeliveryStatusDTO,
} from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { ApiError, loaderError } from "../../../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";

export const INTEGRATIONS_VIEW = "admin.integrations.view";
export const INTEGRATIONS_MANAGE = "admin.integrations.manage";

const ROOT = ["integrations"] as const;

export function useIntegrationsCatalog(): UseQueryResult<IntegrationsCatalogDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<IntegrationsCatalogDTO, ApiError>({
    queryKey: [...ROOT, "catalog"],
    enabled: session !== null,
    retry: false,
    queryFn: async () => {
      const res = await request("/integrations/catalog");
      if (!res.ok) throw await loaderError(res, t("integrations.loadFailed"), t);
      return res.json<IntegrationsCatalogDTO>();
    },
  });
}

export function useApiKeys(): UseQueryResult<ApiKeyDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ApiKeyDTO[], ApiError>({
    queryKey: [...ROOT, "api-keys"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/integrations/api-keys");
      if (!res.ok) throw await loaderError(res, t("integrations.loadFailed"), t);
      return res.json<ApiKeyDTO[]>();
    },
  });
}

export function useWebhooks(): UseQueryResult<WebhookDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<WebhookDTO[], ApiError>({
    queryKey: [...ROOT, "webhooks"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/integrations/webhooks");
      if (!res.ok) throw await loaderError(res, t("integrations.loadFailed"), t);
      return res.json<WebhookDTO[]>();
    },
  });
}

export interface DeliveryFilter {
  readonly webhookId: string | null;
  readonly status: WebhookDeliveryStatusDTO | null;
}

export function useDeliveries(filter: DeliveryFilter): UseQueryResult<WebhookDeliveryDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<WebhookDeliveryDTO[], ApiError>({
    queryKey: [...ROOT, "deliveries", filter.webhookId, filter.status],
    enabled: session !== null,
    refetchInterval: 15_000,
    queryFn: async () => {
      const query = new URLSearchParams();
      if (filter.webhookId) query.set("webhookId", filter.webhookId);
      if (filter.status) query.set("status", filter.status);
      const suffix = query.toString();
      const res = await request(`/integrations/deliveries${suffix === "" ? "" : `?${suffix}`}`);
      if (!res.ok) throw await loaderError(res, t("integrations.loadFailed"), t);
      return res.json<WebhookDeliveryDTO[]>();
    },
  });
}

function useIntegrationMutation<TResult, TInput>(fallbackKey: AppTranslationKey, send: (input: TInput) => { path: string; method: string; body?: unknown }) {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<TResult, ApiError, TInput>({
    mutationFn: async (input) => {
      const { path, method, body } = send(input);
      const res = await request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!res.ok) throw await loaderError(res, t(fallbackKey), t);
      return res.json<TResult>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROOT }),
  });
}

export function useCreateApiKey() {
  return useIntegrationMutation<ApiKeyCreatedDTO, CreateApiKeyDTO>("integrations.keys.createFailed", (body) => ({ path: "/integrations/api-keys", method: "POST", body }));
}

export function useRevokeApiKey() {
  return useIntegrationMutation<ApiKeyDTO, string>("integrations.keys.revokeFailed", (id) => ({ path: `/integrations/api-keys/${encodeURIComponent(id)}/revoke`, method: "POST" }));
}

export function useCreateWebhook() {
  return useIntegrationMutation<WebhookCreatedDTO, CreateWebhookDTO>("integrations.webhooks.saveFailed", (body) => ({ path: "/integrations/webhooks", method: "POST", body }));
}

export function useUpdateWebhook() {
  return useIntegrationMutation<WebhookDTO, { id: string; patch: UpdateWebhookDTO }>("integrations.webhooks.saveFailed", ({ id, patch }) => ({
    path: `/integrations/webhooks/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: patch,
  }));
}

export function useRotateWebhookSecret() {
  return useIntegrationMutation<WebhookCreatedDTO, string>("integrations.webhooks.rotateFailed", (id) => ({ path: `/integrations/webhooks/${encodeURIComponent(id)}/rotate-secret`, method: "POST" }));
}

export function useTestWebhook() {
  return useIntegrationMutation<WebhookDeliveryDTO, string>("integrations.webhooks.testFailed", (id) => ({ path: `/integrations/webhooks/${encodeURIComponent(id)}/test`, method: "POST" }));
}

export function useRedeliver() {
  return useIntegrationMutation<WebhookDeliveryDTO, string>("integrations.deliveries.redeliverFailed", (id) => ({ path: `/integrations/deliveries/${encodeURIComponent(id)}/redeliver`, method: "POST" }));
}
