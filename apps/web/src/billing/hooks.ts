import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CardCheckoutDTO,
  CreateCardCheckoutRequestDTO,
  CreateStorageRequestDTO,
  StorageRequestDTO,
  StartModuleTrialRequestDTO,
  TenantBillingDTO,
} from "@mezan/contracts";
import { ShellRequest } from "@mezan/domain";
import { useApi } from "../data/ApiContext";
import { sessionMayAsk } from "../data/session";
import { ApiError, readError, useEntitlements } from "../data/hooks";
import { planServesRequest } from "../data/plan-modules";
import { useAppTranslation } from "../i18n";
import { CHECKOUT_POLL_LIMIT_MS, CHECKOUT_POLL_MS, absoluteCheckoutUrl } from "./CardCheckoutStatus";

export function useEditionHasSubscriptionBilling(): boolean {
  return planServesRequest(useEntitlements(), ShellRequest.Subscription);
}

/**
 * Asked only where the entitlements say subscription billing exists; the
 * desktop and LAN backends have no `/billing` routes and are never asked. A
 * 404 or 403 still reads as `null`, for a server that mounted no billing.
 */
export function useTenantBilling(): UseQueryResult<TenantBillingDTO | null, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const editionHasBilling = useEditionHasSubscriptionBilling();
  return useQuery<TenantBillingDTO | null, ApiError>({
    queryKey: ["billing", "subscription"],
    enabled: sessionMayAsk(session, ShellRequest.Subscription) && editionHasBilling,
    retry: false,
    queryFn: async () => {
      const res = await request("/billing/subscription");
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("billing.loadFailed"), t));
      return res.json<TenantBillingDTO>();
    },
  });
}

export function useRenewByCard() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CardCheckoutDTO, ApiError, CreateCardCheckoutRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/billing/checkout", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("billing.renew.failed"), t));
      return res.json<CardCheckoutDTO>();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["billing", "subscription"] });
    },
  });
}

/** Starts a card renewal and sends the browser to the hosted checkout; the result lands back on `returnPath`. */
export function useStartRenewal() {
  const renew = useRenewByCard();
  return {
    isPending: renew.isPending,
    error: renew.error,
    start(returnPath: string) {
      if (renew.isPending) return;
      renew.mutate(
        { returnPath },
        {
          onSuccess: (checkout) => {
            const url = absoluteCheckoutUrl(checkout);
            if (url) window.location.assign(url);
          },
        },
      );
    },
  };
}

/** Polls one checkout until the webhook has settled it, or the wait window passes. */
export function useTenantCheckout(id: string | null, startedAt: number): UseQueryResult<CardCheckoutDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const queryClient = useQueryClient();
  return useQuery<CardCheckoutDTO, ApiError>({
    queryKey: ["billing", "checkout", id],
    enabled: session !== null && id !== null,
    refetchInterval: (query) =>
      query.state.data?.status === "pending" && Date.now() - startedAt < CHECKOUT_POLL_LIMIT_MS ? CHECKOUT_POLL_MS : false,
    queryFn: async () => {
      const res = await request(`/billing/checkouts/${encodeURIComponent(id ?? "")}`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("billing.loadFailed"), t));
      const checkout = await res.json<CardCheckoutDTO>();
      if (checkout.status === "paid") {
        void queryClient.invalidateQueries({ queryKey: ["billing", "subscription"] });
        void queryClient.invalidateQueries({ queryKey: ["license-state"] });
      }
      return checkout;
    },
  });
}

/**
 * «جرّب هذه الوحدة» — one 14-day trial per module per tenant. The second
 * attempt comes back 409 with the server's own Arabic sentence, which
 * `readError` prefers over any wording this file could invent.
 */
export function useStartModuleTrial() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ module: string; endsAt: string }, ApiError, StartModuleTrialRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/billing/module-trials", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("plan.modules.failed"), t));
      return res.json<{ module: string; endsAt: string }>();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["billing", "subscription"] });
      void queryClient.invalidateQueries({ queryKey: ["entitlements"] });
    },
  });
}

export function useRequestStorage() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<StorageRequestDTO, ApiError, CreateStorageRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/billing/storage-requests", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("plan.storage.requestFailed"), t));
      return res.json<StorageRequestDTO>();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["billing", "subscription"] });
    },
  });
}
