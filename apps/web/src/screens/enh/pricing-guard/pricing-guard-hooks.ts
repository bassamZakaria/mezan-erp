import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CreatePricingGuardRuleDTO,
  PricingGuardEvaluateRequestDTO,
  PricingGuardEvaluationDTO,
  PricingGuardOverrideReportDTO,
  PricingGuardRuleDTO,
  PricingGuardRuleInputDTO,
  PricingGuardRuleStatusDTO,
} from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { ApiError, loaderError, readError } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";

const RULES_KEY = ["pricing-guard-rules"] as const;
const OVERRIDES_KEY = "pricing-guard-overrides";
const PREVIEW_DEBOUNCE_MS = 400;

export function usePricingGuardRules(): UseQueryResult<PricingGuardRuleDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PricingGuardRuleDTO[], ApiError>({
    queryKey: RULES_KEY,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/pricing-guard/rules");
      if (!res.ok) throw await loaderError(res, t("pricingGuard.rulesCouldNotLoad"), t);
      return res.json<PricingGuardRuleDTO[]>();
    },
  });
}

export interface PricingGuardOverrideFilterDTO {
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly customerId?: string;
  readonly itemId?: string;
}

export function usePricingGuardOverrides(filter: PricingGuardOverrideFilterDTO): UseQueryResult<PricingGuardOverrideReportDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PricingGuardOverrideReportDTO, ApiError>({
    queryKey: [OVERRIDES_KEY, filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(filter)) if (value) qs.set(key, value);
      const res = await request(`/pricing-guard/overrides${qs.size > 0 ? `?${qs.toString()}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("pricingGuard.overridesCouldNotLoad"), t);
      return res.json<PricingGuardOverrideReportDTO>();
    },
  });
}

export function useSavePricingGuardRule() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PricingGuardRuleDTO, ApiError, { id: string | null; body: PricingGuardRuleInputDTO | CreatePricingGuardRuleDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(id ? `/pricing-guard/rules/${encodeURIComponent(id)}` : "/pricing-guard/rules", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("pricingGuard.ruleCouldNotBeSaved"), t));
      return res.json<PricingGuardRuleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RULES_KEY }),
  });
}

export function useSetPricingGuardRuleStatus() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PricingGuardRuleDTO, ApiError, { id: string; status: PricingGuardRuleStatusDTO }>({
    mutationFn: async ({ id, status }) => {
      const res = await request(`/pricing-guard/rules/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("pricingGuard.ruleCouldNotBeSaved"), t));
      return res.json<PricingGuardRuleDTO>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: RULES_KEY }),
  });
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

export function usePricingGuardPreview(body: PricingGuardEvaluateRequestDTO | null): PricingGuardEvaluationDTO | null {
  const { request, session } = useApi();
  const serialized = body === null || body.lines.length === 0 ? null : JSON.stringify(body);
  const settled = useDebounced(serialized, PREVIEW_DEBOUNCE_MS);
  const query = useQuery<PricingGuardEvaluationDTO | null>({
    queryKey: ["pricing-guard-preview", settled],
    enabled: session !== null && settled !== null,
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: async () => {
      const res = await request("/pricing-guard/evaluate", { method: "POST", body: settled ?? "{}" });
      if (!res.ok) return null;
      return res.json<PricingGuardEvaluationDTO>();
    },
  });
  return serialized === null ? null : (query.data ?? null);
}
