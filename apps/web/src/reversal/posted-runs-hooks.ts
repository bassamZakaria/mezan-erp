import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useApi } from "../data/ApiContext";
import { ApiError, readError } from "../data/hooks";
import type { HrProvisionKindDTO } from "../data/hr-payroll-hooks";
import { useAppTranslation } from "../i18n";

export interface FxRevaluationRunRow {
  readonly entryId: string;
  readonly entryNo: string | null;
  readonly date: string;
  readonly memo: string | null;
  readonly reversible: boolean;
  readonly reversalEntryId: string | null;
  readonly reversalEntryNo: string | null;
  readonly reversalDate: string | null;
}

export interface HrProvisionPostingRow {
  readonly asOfDate: string;
  readonly journalEntryId: string;
  readonly journalEntryNo: string | null;
  readonly movement: string;
  readonly reversible: boolean;
  readonly reversalEntryId: string | null;
  readonly reversalEntryNo: string | null;
  readonly reversalDate: string | null;
}

export function useFxRevaluationRuns(): UseQueryResult<FxRevaluationRunRow[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<FxRevaluationRunRow[], ApiError>({
    queryKey: ["revaluation", "runs"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/revaluation/runs");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("reversal.fxRuns.couldNotLoad"), t));
      return (await res.json<{ runs: FxRevaluationRunRow[] }>()).runs;
    },
  });
}

export function useHrProvisionPostings(kind: HrProvisionKindDTO): UseQueryResult<HrProvisionPostingRow[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<HrProvisionPostingRow[], ApiError>({
    queryKey: ["hr", "payroll", "provisions", kind, "postings"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/hr/payroll/provisions/${kind}/postings`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("reversal.provisionPostings.couldNotLoad"), t));
      return (await res.json<{ postings: HrProvisionPostingRow[] }>()).postings;
    },
  });
}
