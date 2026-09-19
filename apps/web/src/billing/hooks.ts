import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { CardCheckoutDTO, CreateCardCheckoutRequestDTO, TenantBillingDTO } from "@mezan/contracts";
import { useApi } from "../data/ApiContext";
import { ApiError, readError } from "../data/hooks";
import { useAppTranslation } from "../i18n";
import { CHECKOUT_POLL_LIMIT_MS, CHECKOUT_POLL_MS, absoluteCheckoutUrl } from "./CardCheckoutStatus";

/**
 * `null` when this edition has no subscription billing — the desktop and LAN
 * backends have no `/billing` routes, so the card simply does not render.
 */
export function useTenantBilling(): UseQueryResult<TenantBillingDTO | null, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<TenantBillingDTO | null, ApiError>({
    queryKey: ["billing", "subscription"],
    enabled: session !== null,
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
