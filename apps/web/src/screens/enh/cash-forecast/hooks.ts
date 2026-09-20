import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CashForecastDTO,
  CashForecastHorizonDTO,
  CashForecastOverdueDTO,
  CashForecastThresholdDTO,
  UpdateCashForecastThresholdDTO,
} from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { ApiError, loaderError } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";

const KEY = ["cash-forecast"] as const;

export function useCashForecast(
  horizon: CashForecastHorizonDTO,
  overdue: CashForecastOverdueDTO,
  branchId: string,
): UseQueryResult<CashForecastDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<CashForecastDTO, ApiError>({
    queryKey: [...KEY, horizon, overdue, branchId],
    enabled: session !== null,
    queryFn: async () => {
      const branch = branchId ? `&branchId=${encodeURIComponent(branchId)}` : "";
      const res = await request(`/cash-forecast?horizon=${horizon}&overdue=${overdue}${branch}`);
      if (!res.ok) throw await loaderError(res, t("cashForecast.loadFailed"), t);
      return res.json<CashForecastDTO>();
    },
  });
}

export function useUpdateCashForecastThreshold() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CashForecastThresholdDTO, ApiError, UpdateCashForecastThresholdDTO>({
    mutationFn: async (body) => {
      const res = await request("/cash-forecast/threshold", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw await loaderError(res, t("cashForecast.threshold.saveFailed"), t);
      return res.json<CashForecastThresholdDTO>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
