import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  OwnerDigestCadence,
  OwnerDigestLanguage,
  OwnerDigestPreviewDTO,
  OwnerDigestRecipientOptionDTO,
  OwnerDigestSendResultDTO,
  OwnerDigestSettingsDTO,
  OwnerDigestSettingsInputDTO,
} from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { ApiError, loaderError } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";

const KEY = ["owner-digest"] as const;

export function useOwnerDigestSettings(): UseQueryResult<OwnerDigestSettingsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<OwnerDigestSettingsDTO, ApiError>({
    queryKey: [...KEY, "settings"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/owner-digest/settings");
      if (!res.ok) throw await loaderError(res, t("ownerDigest.loadFailed"), t);
      return res.json<OwnerDigestSettingsDTO>();
    },
  });
}

export function useOwnerDigestPreview(cadence: OwnerDigestCadence | null, language: OwnerDigestLanguage | null): UseQueryResult<OwnerDigestPreviewDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<OwnerDigestPreviewDTO, ApiError>({
    queryKey: [...KEY, "preview", cadence, language],
    enabled: session !== null && cadence !== null && language !== null,
    queryFn: async () => {
      const res = await request(`/owner-digest/preview?cadence=${cadence}&language=${language}`);
      if (!res.ok) throw await loaderError(res, t("ownerDigest.loadFailed"), t);
      return res.json<OwnerDigestPreviewDTO>();
    },
  });
}

export function useOwnerDigestRecipients(enabled: boolean): UseQueryResult<OwnerDigestRecipientOptionDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<OwnerDigestRecipientOptionDTO[], ApiError>({
    queryKey: [...KEY, "recipients"],
    enabled: session !== null && enabled,
    queryFn: async () => {
      const res = await request("/owner-digest/recipients");
      if (!res.ok) throw await loaderError(res, t("ownerDigest.loadFailed"), t);
      return res.json<OwnerDigestRecipientOptionDTO[]>();
    },
  });
}

export function useSaveOwnerDigestSettings() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<OwnerDigestSettingsDTO, ApiError, OwnerDigestSettingsInputDTO>({
    mutationFn: async (body) => {
      const res = await request("/owner-digest/settings", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw await loaderError(res, t("ownerDigest.settings.saveFailed"), t);
      return res.json<OwnerDigestSettingsDTO>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSendOwnerDigest() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<OwnerDigestSendResultDTO, ApiError, { cadence: OwnerDigestCadence; language: OwnerDigestLanguage }>({
    mutationFn: async (body) => {
      const res = await request("/owner-digest/send", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await loaderError(res, t("ownerDigest.sendFailed"), t);
      return res.json<OwnerDigestSendResultDTO>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
