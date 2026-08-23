import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ProfileDTO,
  UpdateProfileDTO,
  ChangePasswordDTO,
  ChangePinDTO,
  AuditEventDTO,
  ApiKeyDTO,
  CreateApiKeyDTO,
  CreateApiKeyResultDTO,
  WebhookDTO,
  CreateWebhookDTO,
  UpdateWebhookDTO,
  CreateWebhookResultDTO,
  WebhookDeliveryDTO,
} from "@mezan/contracts";
import { useApi } from "./ApiContext";

/**
 * Self-service profile, API keys and webhooks — kept out of `data/hooks.ts`
 * (per file ownership for this task) but following the exact same pattern:
 * a typed TanStack Query hook per endpoint, real loading/error/empty states,
 * mutations invalidate their query key.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readError(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

// --- الملف الشخصي (self-service profile) ---

export function useProfile(): UseQueryResult<ProfileDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<ProfileDTO, ApiError>({
    queryKey: ["profile"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/profile");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الملف الشخصي.");
      return res.json<ProfileDTO>();
    },
  });
}

export function useUpdateProfile() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProfileDTO, ApiError, UpdateProfileDTO>({
    mutationFn: async (body) => {
      const res = await request("/profile", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر حفظ الملف الشخصي."));
      return res.json<ProfileDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });
}

export function useChangePassword() {
  const { request } = useApi();
  return useMutation<void, ApiError, ChangePasswordDTO>({
    mutationFn: async (body) => {
      const res = await request("/profile/change-password", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تغيير كلمة المرور."));
    },
  });
}

export function useChangePin() {
  const { request } = useApi();
  return useMutation<void, ApiError, ChangePinDTO>({
    mutationFn: async (body) => {
      const res = await request("/profile/change-pin", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تغيير الرقم السري."));
    },
  });
}

export function useProfileActivity(): UseQueryResult<AuditEventDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<AuditEventDTO[], ApiError>({
    queryKey: ["profile", "activity"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/profile/activity");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل سجل النشاط.");
      return res.json<AuditEventDTO[]>();
    },
  });
}

// --- مفاتيح API ---

export function useApiKeys(): UseQueryResult<ApiKeyDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ApiKeyDTO[], ApiError>({
    queryKey: ["api-keys"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/api-keys");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل مفاتيح API.");
      return res.json<ApiKeyDTO[]>();
    },
  });
}

export function useCreateApiKey() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CreateApiKeyResultDTO, ApiError, CreateApiKeyDTO>({
    mutationFn: async (body) => {
      const res = await request("/api-keys", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إنشاء مفتاح API."));
      return res.json<CreateApiKeyResultDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useRevokeApiKey() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ApiKeyDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/api-keys/${id}/revoke`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إلغاء مفتاح API."));
      return res.json<ApiKeyDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

// --- الويب هوك ---

export function useWebhooks(): UseQueryResult<WebhookDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<WebhookDTO[], ApiError>({
    queryKey: ["webhooks"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/webhooks");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الويب هوك.");
      return res.json<WebhookDTO[]>();
    },
  });
}

export function useCreateWebhook() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CreateWebhookResultDTO, ApiError, CreateWebhookDTO>({
    mutationFn: async (body) => {
      const res = await request("/webhooks", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إنشاء الويب هوك."));
      return res.json<CreateWebhookResultDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["webhooks"] }),
  });
}

export function useUpdateWebhook() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WebhookDTO, ApiError, { id: string; body: UpdateWebhookDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/webhooks/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر حفظ الويب هوك."));
      return res.json<WebhookDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["webhooks"] }),
  });
}

export function useWebhookDeliveries(webhookId: string | null): UseQueryResult<WebhookDeliveryDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<WebhookDeliveryDTO[], ApiError>({
    queryKey: ["webhooks", webhookId, "deliveries"],
    enabled: session !== null && webhookId !== null,
    queryFn: async () => {
      const res = await request(`/webhooks/${webhookId}/deliveries`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل محاولات التسليم.");
      return res.json<WebhookDeliveryDTO[]>();
    },
  });
}
