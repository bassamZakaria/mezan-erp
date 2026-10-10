import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { FiscalPeriodDTO, PeriodCloseChecklistDTO, PeriodCloseRequestDTO, PeriodCloseSummaryDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { ApiError } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";

const ENGLISH_LOCALE = "en";

async function refusalOf(res: { status: number; json<T>(): Promise<T> }, fallback: string, locale: string): Promise<ApiError> {
  const body = (await res.json<{ message?: string; messageEn?: string }>().catch(() => ({}))) as { message?: string; messageEn?: string };
  const message = locale === ENGLISH_LOCALE && body.messageEn ? body.messageEn : body.message;
  return new ApiError(res.status, message && message.trim() !== "" ? message : fallback);
}

const CHECKLIST_KEY = "period-close-checks";
const SUMMARIES_KEY = "period-close-summaries";
const FISCAL_PERIODS_KEY = "fiscal-periods";

export enum PeriodCloseAction {
  Close = "close",
  Lock = "lock",
}

export function usePeriodCloseChecklist(periodId: string | null): UseQueryResult<PeriodCloseChecklistDTO, ApiError> {
  const { t, locale } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PeriodCloseChecklistDTO, ApiError>({
    queryKey: [CHECKLIST_KEY, periodId],
    enabled: session !== null && periodId !== null,
    queryFn: async () => {
      const res = await request(`/period-close/${encodeURIComponent(periodId ?? "")}/checks`);
      if (!res.ok) throw await refusalOf(res, t("periodClose.loadFailed"), locale);
      return res.json<PeriodCloseChecklistDTO>();
    },
  });
}

export function usePeriodCloseSummaries(periodId: string | null): UseQueryResult<readonly PeriodCloseSummaryDTO[], ApiError> {
  const { t, locale } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<readonly PeriodCloseSummaryDTO[], ApiError>({
    queryKey: [SUMMARIES_KEY, periodId],
    enabled: session !== null && periodId !== null,
    queryFn: async () => {
      const res = await request(`/period-close/${encodeURIComponent(periodId ?? "")}/summaries`);
      if (!res.ok) throw await refusalOf(res, t("periodClose.summariesLoadFailed"), locale);
      return res.json<readonly PeriodCloseSummaryDTO[]>();
    },
  });
}

export interface PeriodCloseTransitionInput {
  readonly periodId: string;
  readonly action: PeriodCloseAction;
  readonly overrideReason?: string;
}

export function usePeriodCloseTransition() {
  const { t, locale } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<FiscalPeriodDTO, ApiError, PeriodCloseTransitionInput>({
    mutationFn: async ({ periodId, action, overrideReason }) => {
      const body: PeriodCloseRequestDTO = overrideReason === undefined ? {} : { overrideReason };
      const res = await request(`/fiscal-periods/${encodeURIComponent(periodId)}/${action}`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await refusalOf(res, t("periodClose.actionFailed"), locale);
      return res.json<FiscalPeriodDTO>();
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: [FISCAL_PERIODS_KEY] }),
        queryClient.invalidateQueries({ queryKey: [CHECKLIST_KEY] }),
        queryClient.invalidateQueries({ queryKey: [SUMMARIES_KEY] }),
      ]),
  });
}
