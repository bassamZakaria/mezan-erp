import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ChangePlanRequestDTO,
  CreateTenantRequestDTO,
  PlanDTO,
  ProvisionResultDTO,
  ProvisionRetryRequestDTO,
  RecordPaymentRequestDTO,
  TenantSummaryDTO,
} from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { PlatformApiError, readPlatformErrorMessage, usePlatformApi } from "./api";

export function useTenantsQuery(): UseQueryResult<TenantSummaryDTO[], PlatformApiError> {
  const { t } = useAppTranslation();
  const { request, session } = usePlatformApi();
  return useQuery<TenantSummaryDTO[], PlatformApiError>({
    queryKey: ["platform", "tenants"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/tenants");
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.tenants.loadFailed"));
      return res.json<TenantSummaryDTO[]>();
    },
  });
}

export function useTenantQuery(id: string): UseQueryResult<TenantSummaryDTO, PlatformApiError> {
  const { t } = useAppTranslation();
  const { request, session } = usePlatformApi();
  return useQuery<TenantSummaryDTO, PlatformApiError>({
    queryKey: ["platform", "tenants", id],
    enabled: session !== null && id !== "",
    queryFn: async () => {
      const res = await request(`/tenants/${id}`);
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.tenantDetail.notFound"));
      return res.json<TenantSummaryDTO>();
    },
  });
}

export function usePlansQuery(): UseQueryResult<PlanDTO[], PlatformApiError> {
  const { t } = useAppTranslation();
  const { request, session } = usePlatformApi();
  return useQuery<PlanDTO[], PlatformApiError>({
    queryKey: ["platform", "plans"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/plans");
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.plans.loadFailed"));
      return res.json<PlanDTO[]>();
    },
  });
}

/** Every tenant/subscription mutation below returns the refreshed `TenantSummaryDTO`, so the same handler both invalidates the list and seeds the detail page's cache — the detail screen never shows a stale state after its own write. */
function useSummaryMutation<TVars>(
  buildPath: (vars: TVars) => string,
  buildBody: (vars: TVars) => unknown,
  errorKey: AppTranslationKey,
) {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<TenantSummaryDTO, PlatformApiError, TVars>({
    mutationFn: async (vars) => {
      const body = buildBody(vars);
      const res = await request(buildPath(vars), { method: "POST", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, errorKey));
      return res.json<TenantSummaryDTO>();
    },
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: ["platform", "tenants"] });
      queryClient.setQueryData(["platform", "tenants", summary.tenant.id], summary);
    },
  });
}

export function useCreateTenantMutation() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<ProvisionResultDTO, PlatformApiError, CreateTenantRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/tenants", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.newTenant.error.generic"));
      return res.json<ProvisionResultDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["platform", "tenants"] }),
  });
}

export function useRetryProvisionMutation() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<ProvisionResultDTO, PlatformApiError, { tenantId: string; body?: ProvisionRetryRequestDTO }>({
    mutationFn: async ({ tenantId, body }) => {
      const res = await request(`/tenants/${tenantId}/provision`, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.tenantDetail.retryProvision.error.generic"));
      return res.json<ProvisionResultDTO>();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["platform", "tenants"] });
      queryClient.invalidateQueries({ queryKey: ["platform", "tenants", result.tenant.id] });
    },
  });
}

export function useSuspendTenantMutation() {
  return useSummaryMutation<string>((tenantId) => `/tenants/${tenantId}/suspend`, () => undefined, "platform.tenantDetail.suspend");
}

export function useResumeTenantMutation() {
  return useSummaryMutation<string>((tenantId) => `/tenants/${tenantId}/resume`, () => undefined, "platform.tenantDetail.resume");
}

export function useArchiveTenantMutation() {
  return useSummaryMutation<string>((tenantId) => `/tenants/${tenantId}/archive`, () => undefined, "platform.tenantDetail.archive");
}

export function useChangePlanMutation() {
  return useSummaryMutation<{ tenantId: string; body: ChangePlanRequestDTO }>(
    ({ tenantId }) => `/tenants/${tenantId}/subscription/change-plan`,
    ({ body }) => body,
    "platform.tenantDetail.changePlan",
  );
}

export function useCancelSubscriptionMutation() {
  return useSummaryMutation<string>((tenantId) => `/tenants/${tenantId}/subscription/cancel`, () => undefined, "platform.tenantDetail.cancelSubscription");
}

export function useRecordPaymentMutation() {
  return useSummaryMutation<{ tenantId: string; body: RecordPaymentRequestDTO }>(
    ({ tenantId }) => `/tenants/${tenantId}/payments`,
    ({ body }) => body,
    "platform.recordPayment.error.generic",
  );
}
