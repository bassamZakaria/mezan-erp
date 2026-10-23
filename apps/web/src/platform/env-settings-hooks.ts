import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { EnvSettingsDTO, RestartServerRequestDTO, UpdateEnvSettingsRequestDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { PlatformApiError, readPlatformErrorMessage, usePlatformApi } from "./api";

const ENV_SETTINGS_KEY = ["platform", "env-settings"] as const;

export function useEnvSettingsQuery(): UseQueryResult<EnvSettingsDTO, PlatformApiError> {
  const { t } = useAppTranslation();
  const { request, session } = usePlatformApi();
  return useQuery<EnvSettingsDTO, PlatformApiError>({
    queryKey: ENV_SETTINGS_KEY,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/settings/env");
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.envSettings.loadFailed"));
      return res.json<EnvSettingsDTO>();
    },
  });
}

export function useSaveEnvSettingsMutation() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<EnvSettingsDTO, PlatformApiError, UpdateEnvSettingsRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/settings/env", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.envSettings.saveFailed"));
      return res.json<EnvSettingsDTO>();
    },
    onSuccess: (settings) => queryClient.setQueryData(ENV_SETTINGS_KEY, settings),
  });
}

export function useRestartServerMutation() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  return useMutation<void, PlatformApiError, RestartServerRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/settings/restart", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.envSettings.restartFailed"));
    },
  });
}
