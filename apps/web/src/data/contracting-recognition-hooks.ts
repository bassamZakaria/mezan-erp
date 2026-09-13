import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { PostRecognitionRunDTO, RecognitionPreviewDTO, RecognitionRunDTO } from "@mezan/contracts";
import { useApi } from "./ApiContext";
import { ApiError } from "./hooks";
import { useAppTranslation } from "../i18n";

/**
 * تشغيل الاعتراف بالإيراد — the monthly run's data hooks (design D-03, D-12).
 * Posting a run changes the ledger the status board is derived from, so a
 * mutation invalidates the whole subtree rather than one list.
 */

async function readError(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

const ROOT = "/contracting/recognition";
const KEY = ["contracting", "recognition"] as const;

export interface RecognitionStatusDTO {
  readonly periodEnd: string;
  readonly rows: readonly RecognitionPreviewDTO[];
}

/** Every live contract with its last run and this period's figures. */
export function useRecognitionStatus(periodEnd: string | null): UseQueryResult<RecognitionStatusDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RecognitionStatusDTO, ApiError>({
    queryKey: [...KEY, "status", periodEnd],
    enabled: session !== null && periodEnd !== null,
    queryFn: async () => {
      const res = await request(`${ROOT}/status?periodEnd=${encodeURIComponent(periodEnd as string)}`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("revenueRecognition.api.statusFailed")));
      return res.json<RecognitionStatusDTO>();
    },
  });
}

export function useRecognitionRuns(contractId: string | null): UseQueryResult<RecognitionRunDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RecognitionRunDTO[], ApiError>({
    queryKey: [...KEY, "runs", contractId],
    enabled: session !== null,
    queryFn: async () => {
      const search = contractId ? `?contractId=${encodeURIComponent(contractId)}` : "";
      const res = await request(`${ROOT}/runs${search}`);
      if (!res.ok) throw new ApiError(res.status, t("revenueRecognition.api.runsFailed"));
      return res.json<RecognitionRunDTO[]>();
    },
  });
}

/** One run, addressed by its `RR-…` number or its id. */
export function useRecognitionRun(idOrDocNo: string | null): UseQueryResult<RecognitionRunDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RecognitionRunDTO, ApiError>({
    queryKey: [...KEY, "run", idOrDocNo],
    enabled: session !== null && idOrDocNo !== null,
    queryFn: async () => {
      const res = await request(`${ROOT}/runs/${encodeURIComponent(idOrDocNo as string)}`);
      if (!res.ok) throw new ApiError(res.status, t("revenueRecognition.api.runFailed"));
      return res.json<RecognitionRunDTO>();
    },
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: KEY });
}

export function usePostRecognitionRun() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useInvalidate();
  return useMutation<RecognitionRunDTO, ApiError, PostRecognitionRunDTO>({
    mutationFn: async (body) => {
      const res = await request(`${ROOT}/runs`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("revenueRecognition.api.runFailedToPost")));
      return res.json<RecognitionRunDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useReverseRecognitionRun() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useInvalidate();
  return useMutation<RecognitionRunDTO, ApiError, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await request(`${ROOT}/runs/${encodeURIComponent(id)}/reverse`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("revenueRecognition.api.reverseFailed")));
      return res.json<RecognitionRunDTO>();
    },
    onSuccess: invalidate,
  });
}
