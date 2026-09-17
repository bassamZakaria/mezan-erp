import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import type { RecordSimplifiedRegimeDTO, SimplifiedRegimeElectionDTO, SimplifiedRegimeStatusDTO } from "@mezan/contracts";
import { useApi } from "../../data/ApiContext";
import { ApiError } from "../../data/hooks";
import { useAppTranslation } from "../../i18n";

/**
 * النظام الضريبي المبسط — reads and writes `/tax/simplified-regime` over the
 * SAME session transport every other screen uses. The write is a RECORD of a
 * filing the taxpayer already made; nothing here elects anything.
 */

const KEY = ["tax", "simplified-regime"] as const;

export function useSimplifiedRegime(): UseQueryResult<SimplifiedRegimeStatusDTO & { activeToday: boolean }, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery({
    queryKey: KEY,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/tax/simplified-regime");
      if (!res.ok) throw new ApiError(res.status, t("simplifiedRegime.api.loadFailed"));
      return res.json<SimplifiedRegimeStatusDTO & { activeToday: boolean }>();
    },
  });
}

export function useRecordSimplifiedRegime(): UseMutationResult<
  SimplifiedRegimeElectionDTO,
  ApiError,
  RecordSimplifiedRegimeDTO
> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: RecordSimplifiedRegimeDTO) => {
      const res = await request("/tax/simplified-regime", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) {
        const detail = await res.json<{ message?: string }>().catch(() => null);
        throw new ApiError(res.status, detail?.message ?? t("simplifiedRegime.api.saveFailed"));
      }
      return res.json<SimplifiedRegimeElectionDTO>();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}
