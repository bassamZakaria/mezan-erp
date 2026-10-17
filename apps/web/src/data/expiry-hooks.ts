import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  BatchTrailEntryDTO,
  ExpiredWriteOffProposalDTO,
  ExpiryAlertsDTO,
  ExpirySettingsDTO,
  ExpirySettingsInput,
  ExpiryWriteOffRequest,
  ExpiryWriteOffResultDTO,
  FefoPreviewDTO,
} from "@mezan/contracts";
import { useApi } from "./ApiContext";
import { ApiError, loaderError, readError } from "./hooks";
import { useAppTranslation } from "../i18n";

const KEY = "inventory-expiry";

export function useExpirySettings(): UseQueryResult<ExpirySettingsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ExpirySettingsDTO, ApiError>({
    queryKey: [KEY, "settings"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/inventory/expiry/settings");
      if (!res.ok) throw await loaderError(res, t("expiry.settings.loadFailed"), t);
      return res.json<ExpirySettingsDTO>();
    },
  });
}

export function useSaveExpirySettings() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ExpirySettingsDTO, ApiError, ExpirySettingsInput>({
    mutationFn: async (body) => {
      const res = await request("/inventory/expiry/settings", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("expiry.settings.saveFailed"), t));
      return res.json<ExpirySettingsDTO>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useExpiryAlerts(enabled = true): UseQueryResult<ExpiryAlertsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ExpiryAlertsDTO, ApiError>({
    queryKey: [KEY, "alerts"],
    enabled: session !== null && enabled,
    queryFn: async () => {
      const res = await request("/inventory/expiry/alerts");
      if (!res.ok) throw await loaderError(res, t("expiry.alerts.loadFailed"), t);
      return res.json<ExpiryAlertsDTO>();
    },
  });
}

export function useExpiryWriteOffProposal(warehouseId: string): UseQueryResult<ExpiredWriteOffProposalDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ExpiredWriteOffProposalDTO, ApiError>({
    queryKey: [KEY, "write-off-proposal", warehouseId],
    enabled: session !== null && warehouseId !== "",
    queryFn: async () => {
      const res = await request(`/inventory/expiry/write-off-proposal?warehouseId=${encodeURIComponent(warehouseId)}`);
      if (!res.ok) throw await loaderError(res, t("expiry.writeOff.loadFailed"), t);
      return res.json<ExpiredWriteOffProposalDTO>();
    },
  });
}

export function useCreateExpiryWriteOff() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ExpiryWriteOffResultDTO, ApiError, ExpiryWriteOffRequest>({
    mutationFn: async (body) => {
      const res = await request("/inventory/expiry/write-off", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("expiry.writeOff.createFailed"), t));
      return res.json<ExpiryWriteOffResultDTO>();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: [KEY] });
      void queryClient.invalidateQueries({ queryKey: ["stock-adjustments"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory", "stock-adjustments"] });
    },
  });
}

export function useFefoPreview(input: { warehouseId: string; itemId: string; qty: number }): UseQueryResult<FefoPreviewDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const ready = input.warehouseId !== "" && input.itemId !== "";
  const qty = input.qty > 0 ? String(input.qty) : "";
  return useQuery<FefoPreviewDTO, ApiError>({
    queryKey: [KEY, "fefo", input.warehouseId, input.itemId, qty],
    enabled: session !== null && ready,
    queryFn: async () => {
      const params = new URLSearchParams({ warehouseId: input.warehouseId, itemId: input.itemId });
      if (qty !== "") params.set("qty", qty);
      const res = await request(`/inventory/fefo-preview?${params.toString()}`);
      if (!res.ok) throw await loaderError(res, t("expiry.fefo.loadFailed"), t);
      return res.json<FefoPreviewDTO>();
    },
  });
}

export function useBatchTrail(sourceDocId: string | null): UseQueryResult<BatchTrailEntryDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<BatchTrailEntryDTO[], ApiError>({
    queryKey: [KEY, "trail", sourceDocId],
    enabled: session !== null && sourceDocId !== null,
    queryFn: async () => {
      const res = await request(`/inventory/expiry/batch-trail?sourceDocId=${encodeURIComponent(sourceDocId ?? "")}`);
      if (!res.ok) throw await loaderError(res, t("expiry.trail.loadFailed"), t);
      return res.json<BatchTrailEntryDTO[]>();
    },
  });
}

export function useBatchRecall(batchNo: string): UseQueryResult<BatchTrailEntryDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const trimmed = batchNo.trim();
  return useQuery<BatchTrailEntryDTO[], ApiError>({
    queryKey: [KEY, "recall", trimmed],
    enabled: session !== null && trimmed !== "",
    queryFn: async () => {
      const res = await request(`/inventory/expiry/recall?batchNo=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw await loaderError(res, t("expiry.trail.loadFailed"), t);
      return res.json<BatchTrailEntryDTO[]>();
    },
  });
}
