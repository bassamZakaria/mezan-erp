import { useMutation, useMutationState, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { ownerPinResetResultSchema } from "@mezan/contracts";
import type {
  CardCheckoutDTO,
  PlatformCardCheckoutsDTO,
  ChangePlanRequestDTO,
  CreateTenantRequestDTO,
  PlanDTO,
  OwnerCandidateDTO,
  OwnerPinResetResultDTO,
  TenantBooksDTO,
  ProvisionResultDTO,
  ProvisionRetryRequestDTO,
  RecordPaymentRequestDTO,
  SubscriptionResumeRequestDTO,
  SubscriptionSuspendRequestDTO,
  TenantSummaryDTO,
} from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { PlatformApiError, readPlatformErrorMessage, usePlatformApi } from "./api";
import { CHECKOUT_POLL_MS } from "../billing/CardCheckoutStatus";

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

export enum OwnerPinResetPhase {
  Idle = "idle",
  Pending = "pending",
  Issued = "issued",
}

export interface OwnerPinReset {
  readonly phase: OwnerPinResetPhase;
  readonly issued: OwnerPinResetResultDTO | null;
  reset(handlers: { onError: (err: PlatformApiError) => void }): void;
  acknowledge(): void;
}

const ownerPinResetKey = (operatorId: string, tenantId: string) => ["platform", "ownerPinReset", operatorId, tenantId] as const;

export function useOwnerPinReset(tenantId: string): OwnerPinReset {
  const { t } = useAppTranslation();
  const { request, session } = usePlatformApi();
  const queryClient = useQueryClient();
  const mutationKey = ownerPinResetKey(session?.user.id ?? "", tenantId);
  const mutation = useMutation<OwnerPinResetResultDTO, PlatformApiError, void>({
    mutationKey,
    gcTime: Infinity,
    mutationFn: async () => {
      const res = await request(`/tenants/${tenantId}/owner-pin/reset`, { method: "POST" });
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.tenantDetail.resetOwnerPin.error.generic"));
      return res.json<OwnerPinResetResultDTO>();
    },
  });
  const latest = useMutationState({
    filters: { mutationKey, exact: true },
    select: (entry) => ({ status: entry.state.status, data: entry.state.data }),
  }).at(-1);
  const pending = latest?.status === "pending";
  const parsed = latest?.status === "success" ? ownerPinResetResultSchema.safeParse(latest.data) : null;
  const issued = parsed?.success ? parsed.data : null;

  const forget = () => {
    const cache = queryClient.getMutationCache();
    for (const entry of cache.findAll({ mutationKey, exact: true })) {
      if (entry.state.status !== "pending") cache.remove(entry);
    }
  };

  return {
    phase: pending ? OwnerPinResetPhase.Pending : issued ? OwnerPinResetPhase.Issued : OwnerPinResetPhase.Idle,
    issued,
    reset: ({ onError }) => {
      if (pending) return;
      forget();
      mutation.mutate(undefined, { onError });
    },
    acknowledge: forget,
  };
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

export function useReleaseTenantMutation() {
  return useSummaryMutation<string>((tenantId) => `/tenants/${tenantId}/release`, () => undefined, "platform.tenantDetail.release");
}

export function useOwnerCandidates(tenantId: string, enabled: boolean) {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  return useQuery<OwnerCandidateDTO[], PlatformApiError>({
    queryKey: ["platform", "tenants", tenantId, "ownerCandidates"],
    enabled,
    queryFn: async () => {
      const res = await request(`/tenants/${tenantId}/owner/candidates`);
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.tenantDetail.owner.loadFailed"));
      return res.json<OwnerCandidateDTO[]>();
    },
  });
}

export function useAssignOwnerMutation() {
  return useSummaryMutation<{ tenantId: string; userId: string }>(
    ({ tenantId }) => `/tenants/${tenantId}/owner`,
    ({ userId }) => ({ userId }),
    "platform.tenantDetail.owner.assignFailed",
  );
}

export function useConfirmPendingOwnerMutation() {
  return useSummaryMutation<string>((tenantId) => `/tenants/${tenantId}/owner/confirm`, () => undefined, "platform.tenantDetail.owner.confirmFailed");
}

export function useDeclinePendingOwnerMutation() {
  return useSummaryMutation<string>((tenantId) => `/tenants/${tenantId}/owner/decline`, () => undefined, "platform.tenantDetail.owner.declineFailed");
}

export function useResendPendingOwnerMutation() {
  return useSummaryMutation<string>((tenantId) => `/tenants/${tenantId}/owner/resend`, () => undefined, "platform.tenantDetail.owner.resendFailed");
}

export function useTenantBooksQuery(tenantId: string, enabled: boolean) {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  return useQuery<TenantBooksDTO, PlatformApiError>({
    queryKey: ["platform", "tenants", tenantId, "books"],
    enabled,
    queryFn: async () => {
      const res = await request(`/tenants/${tenantId}/books`);
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.books.confirm.loadFailed"));
      return res.json<TenantBooksDTO>();
    },
  });
}

export function useConfirmTenantBooksMutation() {
  return useSummaryMutation<{ tenantId: string; userId: string; companyName: string | null }>(
    ({ tenantId }) => `/tenants/${tenantId}/books/confirm`,
    ({ userId, companyName }) => ({ userId, companyName }),
    "platform.books.confirm.failed",
  );
}

export function useDisownTenantBooksMutation() {
  return useSummaryMutation<string>((tenantId) => `/tenants/${tenantId}/books/disown`, () => undefined, "platform.books.disown.failed");
}

export function useUnbindTenantBooksMutation() {
  return useSummaryMutation<{ tenantId: string; code: string }>(({ tenantId }) => `/tenants/${tenantId}/books/unbind`, ({ code }) => ({ code }), "platform.books.unbind.failed");
}

export function useSetBillingAnchorDayMutation() {
  return useSummaryMutation<{ tenantId: string; day: number }>(
    ({ tenantId }) => `/tenants/${tenantId}/subscription/anchor-day`,
    ({ day }) => ({ day }),
    "platform.tenantDetail.anchorDay.save",
  );
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

export function useSuspendSubscriptionMutation() {
  return useSummaryMutation<{ tenantId: string; body: SubscriptionSuspendRequestDTO }>(
    ({ tenantId }) => `/tenants/${tenantId}/subscription/suspend`,
    ({ body }) => body,
    "platform.tenantDetail.suspendSubscription",
  );
}

export function useResumeSubscriptionMutation() {
  return useSummaryMutation<{ tenantId: string; body: SubscriptionResumeRequestDTO }>(
    ({ tenantId }) => `/tenants/${tenantId}/subscription/resume`,
    ({ body }) => body,
    "platform.tenantDetail.resumeSubscription",
  );
}

export function useRecordPaymentMutation() {
  return useSummaryMutation<{ tenantId: string; body: RecordPaymentRequestDTO }>(
    ({ tenantId }) => `/tenants/${tenantId}/payments`,
    ({ body }) => body,
    "platform.recordPayment.error.generic",
  );
}

/** Polls while any checkout is still waiting on its webhook, so a payment made in another tab shows up here on its own. */
export function useCardCheckoutsQuery(tenantId: string): UseQueryResult<PlatformCardCheckoutsDTO, PlatformApiError> {
  const { t } = useAppTranslation();
  const { request, session } = usePlatformApi();
  const queryClient = useQueryClient();
  return useQuery<PlatformCardCheckoutsDTO, PlatformApiError>({
    queryKey: ["platform", "tenants", tenantId, "card-checkouts"],
    enabled: session !== null && tenantId !== "",
    refetchInterval: (query) => (query.state.data?.checkouts.some((c) => c.status === "pending") ? CHECKOUT_POLL_MS : false),
    queryFn: async () => {
      const res = await request(`/tenants/${tenantId}/card-checkouts`);
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.cardCheckout.loadFailed"));
      const body = await res.json<PlatformCardCheckoutsDTO>();
      const previous = queryClient.getQueryData<PlatformCardCheckoutsDTO>(["platform", "tenants", tenantId, "card-checkouts"]);
      const newlyPaid = body.checkouts.some(
        (c) => c.status === "paid" && previous?.checkouts.find((p) => p.id === c.id)?.status !== "paid",
      );
      if (newlyPaid) void queryClient.invalidateQueries({ queryKey: ["platform", "tenants", tenantId], exact: true });
      return body;
    },
  });
}

export function useCreateCardCheckoutMutation() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<CardCheckoutDTO, PlatformApiError, string>({
    mutationFn: async (tenantId) => {
      const res = await request(`/tenants/${tenantId}/card-checkout`, { method: "POST" });
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.cardCheckout.error.generic"));
      return res.json<CardCheckoutDTO>();
    },
    onSettled: (_data, _err, tenantId) => {
      void queryClient.invalidateQueries({ queryKey: ["platform", "tenants", tenantId, "card-checkouts"] });
    },
  });
}
