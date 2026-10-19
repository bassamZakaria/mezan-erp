import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  AcceptAuditRestoreRequestDTO,
  AcceptAuditRestoreResultDTO,
  ExtendTenantRetentionRequestDTO,
  PurgeTenantNowRequestDTO,
  TenantAuditAnchorDTO,
  TenantPurgeResultDTO,
  TenantRetentionDTO,
} from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { PlatformApiError, readPlatformError, readPlatformErrorMessage, usePlatformApi } from "./api";

const auditAnchorKey = (tenantId: string) => ["platform", "tenants", tenantId, "audit-anchor"] as const;

export function useTenantAuditAnchorQuery(tenantId: string, enabled: boolean): UseQueryResult<TenantAuditAnchorDTO, PlatformApiError> {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  return useQuery<TenantAuditAnchorDTO, PlatformApiError>({
    queryKey: auditAnchorKey(tenantId),
    enabled,
    queryFn: async () => {
      const res = await request(`/tenants/${tenantId}/audit-anchor`);
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.anchor.loadFailed"));
      return res.json<TenantAuditAnchorDTO>();
    },
  });
}

export function useAcceptAuditRestoreMutation() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<AcceptAuditRestoreResultDTO, PlatformApiError, { tenantId: string; body: AcceptAuditRestoreRequestDTO }>({
    mutationFn: async ({ tenantId, body }) => {
      const res = await request(`/tenants/${tenantId}/audit-anchor/accept-restore`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const failure = await readPlatformError(res, t, "platform.anchor.accept.failed");
        throw new PlatformApiError(res.status, failure.message, failure.code);
      }
      return res.json<AcceptAuditRestoreResultDTO>();
    },
    onSettled: (_data, _err, { tenantId }) => {
      void queryClient.invalidateQueries({ queryKey: auditAnchorKey(tenantId) });
    },
  });
}

const retentionKey = (tenantId: string) => ["platform", "tenants", tenantId, "retention"] as const;

export function useTenantRetentionQuery(tenantId: string, enabled: boolean): UseQueryResult<TenantRetentionDTO, PlatformApiError> {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  return useQuery<TenantRetentionDTO, PlatformApiError>({
    queryKey: retentionKey(tenantId),
    enabled,
    queryFn: async () => {
      const res = await request(`/tenants/${tenantId}/retention`);
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.retention.loadFailed"));
      return res.json<TenantRetentionDTO>();
    },
  });
}

export function useExtendTenantRetentionMutation() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<TenantRetentionDTO, PlatformApiError, { tenantId: string; body: ExtendTenantRetentionRequestDTO }>({
    mutationFn: async ({ tenantId, body }) => {
      const res = await request(`/tenants/${tenantId}/retention/extend`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const failure = await readPlatformError(res, t, "platform.retention.extend.failed");
        throw new PlatformApiError(res.status, failure.message, failure.code);
      }
      return res.json<TenantRetentionDTO>();
    },
    onSettled: (_data, _err, { tenantId }) => {
      void queryClient.invalidateQueries({ queryKey: retentionKey(tenantId) });
    },
  });
}

export function usePurgeTenantNowMutation() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<TenantPurgeResultDTO, PlatformApiError, { tenantId: string; body: PurgeTenantNowRequestDTO }>({
    mutationFn: async ({ tenantId, body }) => {
      const res = await request(`/tenants/${tenantId}/retention/purge`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const failure = await readPlatformError(res, t, "platform.retention.purge.failed");
        throw new PlatformApiError(res.status, failure.message, failure.code);
      }
      return res.json<TenantPurgeResultDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["platform", "tenants"] });
    },
  });
}
