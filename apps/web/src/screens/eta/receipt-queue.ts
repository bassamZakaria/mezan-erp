import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ApiError } from "../../data/hooks";
import { useApi } from "../../data/ApiContext";

/** Mirrors @mezan/domain's `EtaReceiptQueueSummary` as served by `GET /eta/receipts/summary`. */
export interface EtaReceiptQueueEntryDTO {
  readonly id: string;
  readonly internalId: string;
  readonly issuedAt: string;
  readonly deadline: string;
  readonly hoursRemaining: number;
}

export interface EtaReceiptQueueSummaryDTO {
  readonly pending: number;
  readonly overdue: number;
  readonly dueSoon: number;
  readonly oldestPendingIssuedAt: string | null;
  readonly windowHours: number;
  readonly overdueEntries: readonly EtaReceiptQueueEntryDTO[];
}

export function useEtaReceiptQueue(): UseQueryResult<EtaReceiptQueueSummaryDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<EtaReceiptQueueSummaryDTO, ApiError>({
    queryKey: ["eta", "receipts", "summary"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/eta/receipts/summary");
      if (!res.ok) throw new ApiError(res.status, "تعذّر قراءة قائمة الإيصالات الإلكترونية.");
      return res.json<EtaReceiptQueueSummaryDTO>();
    },
  });
}
