import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { can, createAuthContext } from "@mezan/domain";
import type { AssignOpportunityDTO, CrmOwnerDTO, LostReasonOptionDTO, OpportunityDTO, WeightedForecastDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { ApiError, loaderError } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";

const OPPORTUNITIES_KEY = ["crm-opportunities"] as const;
const FORECAST_KEY = ["crm-pipeline", "forecast"] as const;

export const OPPORTUNITY_VIEW_ALL = "crm.opportunity.view";
export const OPPORTUNITY_ASSIGN = "crm.opportunity.assign";

export interface CrmAccess {
  readonly userId: string | null;
  readonly seesEveryDeal: boolean;
  readonly mayAssign: boolean;
  readonly mayQuote: boolean;
}

export function useCrmAccess(): CrmAccess {
  const { session } = useApi();
  return useMemo(() => {
    const auth = createAuthContext({
      userId: session?.userId ?? "anonymous",
      permissions: session?.permissions ?? [],
      branchScope: "*",
      warehouseScope: "*",
    });
    return {
      userId: session?.userId ?? null,
      seesEveryDeal: can(auth, OPPORTUNITY_VIEW_ALL),
      mayAssign: can(auth, OPPORTUNITY_ASSIGN),
      mayQuote: can(auth, "sales.quote.create"),
    };
  }, [session]);
}

export function useCrmLostReasons(): UseQueryResult<LostReasonOptionDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<LostReasonOptionDTO[], ApiError>({
    queryKey: ["crm-pipeline", "lost-reasons"],
    enabled: session !== null,
    staleTime: Infinity,
    queryFn: async () => {
      const res = await request("/crm-pipeline/lost-reasons");
      if (!res.ok) throw await loaderError(res, t("crmPipeline.lost.loadFailed"), t);
      return res.json<LostReasonOptionDTO[]>();
    },
  });
}

export function useCrmOwners(): UseQueryResult<CrmOwnerDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<CrmOwnerDTO[], ApiError>({
    queryKey: ["crm-pipeline", "owners"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/crm-pipeline/owners");
      if (!res.ok) throw await loaderError(res, t("crmPipeline.owner.loadFailed"), t);
      return res.json<CrmOwnerDTO[]>();
    },
  });
}

export function useCrmForecast(branchId: string, ownerUserId: string): UseQueryResult<WeightedForecastDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<WeightedForecastDTO, ApiError>({
    queryKey: [...FORECAST_KEY, branchId, ownerUserId],
    enabled: session !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      if (ownerUserId) params.set("ownerUserId", ownerUserId);
      const query = params.toString();
      const res = await request(`/crm-pipeline/forecast${query ? `?${query}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("crmPipeline.forecast.loadFailed"), t);
      return res.json<WeightedForecastDTO>();
    },
  });
}

export function useAssignOpportunity() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<OpportunityDTO, ApiError, { id: string; body: AssignOpportunityDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/crm/opportunities/${encodeURIComponent(id)}/assign`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await loaderError(res, t("crmPipeline.owner.assignFailed"), t);
      return res.json<OpportunityDTO>();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: OPPORTUNITIES_KEY });
      void queryClient.invalidateQueries({ queryKey: FORECAST_KEY });
    },
  });
}

export function useLinkedOpportunity(id: string): UseQueryResult<OpportunityDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<OpportunityDTO, ApiError>({
    queryKey: ["crm-opportunity", id],
    enabled: session !== null && id !== "",
    retry: false,
    queryFn: async () => {
      const res = await request(`/crm/opportunities/${encodeURIComponent(id)}`);
      if (!res.ok) throw await loaderError(res, t("api.opportunitiesCouldNotBeLoaded"), t);
      return res.json<OpportunityDTO>();
    },
  });
}
