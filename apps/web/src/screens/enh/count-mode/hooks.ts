import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  COUNT_MODE_LIVE_REFRESH_MS,
  type CountModeCounterDTO,
  type CountModeMineEntryDTO,
  type CountModeRecountDTO,
  type CountModeScanInputDTO,
  type CountModeScanRecordDTO,
  type CountModeScanResultDTO,
  type CountModeSessionDTO,
  type StartCountModeDTO,
} from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { ApiError, loaderError, readError } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";

const BASE = "/inventory/count-mode";

export const COUNT_MODE_KEY = "count-mode";

export function useCountModeMine(): UseQueryResult<CountModeMineEntryDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<CountModeMineEntryDTO[], ApiError>({
    queryKey: [COUNT_MODE_KEY, "mine"],
    enabled: session !== null,
    refetchInterval: COUNT_MODE_LIVE_REFRESH_MS,
    queryFn: async () => {
      const res = await request(`${BASE}/mine`);
      if (!res.ok) throw await loaderError(res, t("countMode.couldNotLoadMine"), t);
      return res.json<CountModeMineEntryDTO[]>();
    },
  });
}

export function useCountModeSession(countId: string | undefined, live: boolean): UseQueryResult<CountModeSessionDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<CountModeSessionDTO, ApiError>({
    queryKey: [COUNT_MODE_KEY, "session", countId],
    enabled: session !== null && Boolean(countId),
    refetchInterval: live ? COUNT_MODE_LIVE_REFRESH_MS : false,
    queryFn: async () => {
      const res = await request(`${BASE}/${encodeURIComponent(countId ?? "")}`);
      if (!res.ok) throw await loaderError(res, t("countMode.couldNotLoadSession"), t);
      return res.json<CountModeSessionDTO>();
    },
  });
}

export function useCountModeCounters(enabled: boolean): UseQueryResult<CountModeCounterDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<CountModeCounterDTO[], ApiError>({
    queryKey: [COUNT_MODE_KEY, "counters"],
    enabled: session !== null && enabled,
    queryFn: async () => {
      const res = await request(`${BASE}/counters`);
      if (!res.ok) throw await loaderError(res, t("countMode.couldNotLoadCounters"), t);
      return res.json<CountModeCounterDTO[]>();
    },
  });
}

export function useCountModeTrail(countId: string, zoneId: string | undefined, enabled: boolean): UseQueryResult<CountModeScanRecordDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<CountModeScanRecordDTO[], ApiError>({
    queryKey: [COUNT_MODE_KEY, "trail", countId, zoneId ?? ""],
    enabled: session !== null && enabled,
    queryFn: async () => {
      const query = zoneId ? `?zoneId=${encodeURIComponent(zoneId)}` : "";
      const res = await request(`${BASE}/${encodeURIComponent(countId)}/scans${query}`);
      if (!res.ok) throw await loaderError(res, t("countMode.couldNotLoadTrail"), t);
      return res.json<CountModeScanRecordDTO[]>();
    },
  });
}

export function useStartCountMode() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CountModeSessionDTO, ApiError, StartCountModeDTO>({
    mutationFn: async (body) => {
      const res = await request(BASE, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("countMode.startFailed"), t));
      return res.json<CountModeSessionDTO>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [COUNT_MODE_KEY] }),
  });
}

export interface ScanFailure {
  readonly retryable: boolean;
  readonly message: string;
}

export function useSendScan(countId: string, zoneId: string) {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return async (body: CountModeScanInputDTO): Promise<CountModeScanResult> => {
    try {
      const res = await request(`${BASE}/${encodeURIComponent(countId)}/zones/${encodeURIComponent(zoneId)}/scan`, { method: "POST", body: JSON.stringify(body) });
      if (res.ok) return { ok: true, result: await res.json<CountModeScanResultDTO>() };
      const retryable = res.status >= 500;
      return { ok: false, failure: { retryable, message: await readError(res, t("countMode.scanFailed"), t) } };
    } catch {
      return { ok: false, failure: { retryable: true, message: t("countMode.scanOffline") } };
    }
  };
}

export type CountModeScanResult =
  | { readonly ok: true; readonly result: CountModeScanResultDTO }
  | { readonly ok: false; readonly failure: ScanFailure };

function useZoneAction<TBody>(path: (countId: string, zoneId: string) => string, failure: "countMode.submitFailed" | "countMode.zeroFillFailed" | "countMode.recountFailed" | "countMode.approveFailed") {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<unknown, ApiError, { countId: string; zoneId: string; body?: TBody }>({
    mutationFn: async ({ countId, zoneId, body }) => {
      const res = await request(path(countId, zoneId), { method: "POST", body: JSON.stringify(body ?? {}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t(failure), t));
      return res.json<unknown>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [COUNT_MODE_KEY] }),
  });
}

const zonePath = (action: string) => (countId: string, zoneId: string) => `${BASE}/${encodeURIComponent(countId)}/zones/${encodeURIComponent(zoneId)}/${action}`;

export function useSubmitZone() {
  return useZoneAction<Record<string, never>>(zonePath("submit"), "countMode.submitFailed");
}

export function useZeroFillZone() {
  return useZoneAction<Record<string, never>>(zonePath("zero-fill"), "countMode.zeroFillFailed");
}

export function useRecountZone() {
  return useZoneAction<CountModeRecountDTO>(zonePath("recount"), "countMode.recountFailed");
}

export function useApproveZone() {
  return useZoneAction<Record<string, never>>(zonePath("approve"), "countMode.approveFailed");
}

export function useVoidScan() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<unknown, ApiError, { countId: string; scanId: string }>({
    mutationFn: async ({ countId, scanId }) => {
      const res = await request(`${BASE}/${encodeURIComponent(countId)}/scans/${encodeURIComponent(scanId)}/void`, { method: "POST", body: "{}" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("countMode.voidFailed"), t));
      return res.json<unknown>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [COUNT_MODE_KEY] }),
  });
}

export function useCompleteCountMode() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CountModeSessionDTO, ApiError, string>({
    mutationFn: async (countId) => {
      const res = await request(`${BASE}/${encodeURIComponent(countId)}/complete`, { method: "POST", body: "{}" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("countMode.completeFailed"), t));
      return res.json<CountModeSessionDTO>();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [COUNT_MODE_KEY] });
      queryClient.invalidateQueries({ queryKey: ["physical-counts"] });
    },
  });
}
