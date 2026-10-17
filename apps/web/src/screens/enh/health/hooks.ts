import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { SystemHealthDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { ApiError, loaderError } from "../../../data/hooks";
import { sessionHolds } from "../../../data/session";
import { useAppTranslation } from "../../../i18n";
import { backupBridge, isBackupFailure } from "../../../settings/backup-bridge";

export const HEALTH_PERMISSION = "admin.health.view";
const HEALTH_REFETCH_MS = 30_000;

export function useMayViewSystemHealth(): boolean {
  const { session } = useApi();
  return sessionHolds(session, HEALTH_PERMISSION);
}

export function useSystemHealth(): UseQueryResult<SystemHealthDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const enabled = useMayViewSystemHealth();
  return useQuery<SystemHealthDTO, ApiError>({
    queryKey: ["system-health"],
    enabled,
    refetchInterval: HEALTH_REFETCH_MS,
    queryFn: async () => {
      const res = await request("/system/health");
      if (!res.ok) throw await loaderError(res, t("health.loadFailed"), t);
      return res.json<SystemHealthDTO>();
    },
  });
}

export interface DesktopBackupHealth {
  readonly lastBackupAt: string | null;
  readonly lastGoodDrillAt: string | null;
  readonly newestDrillOutcome: string | null;
  readonly diskFreeBytes: number | null;
}

export function useDesktopBackupHealth(): UseQueryResult<DesktopBackupHealth | null, Error> {
  const { session } = useApi();
  const token = session?.token ?? null;
  const bridge = backupBridge();
  return useQuery<DesktopBackupHealth | null, Error>({
    queryKey: ["system-health", "desktop-backup"],
    enabled: token !== null && bridge?.status !== undefined,
    refetchInterval: HEALTH_REFETCH_MS,
    queryFn: async () => {
      if (!bridge?.status || !token) return null;
      const result = await bridge.status(token);
      if (isBackupFailure(result)) return null;
      return {
        lastBackupAt: result.lastBackupAt ?? null,
        lastGoodDrillAt: result.lastGoodDrillAt,
        newestDrillOutcome: result.drills[0]?.outcome ?? null,
        diskFreeBytes: result.diskFreeBytes ?? null,
      };
    },
  });
}
