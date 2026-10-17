import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback } from "react";
import { useApi } from "../data/ApiContext";
import { backupBridge, isBackupFailure, type RecoveryStatus } from "./backup-bridge";

export const BACKUP_RECOVERY_QUERY_KEY = ["backup", "recovery"] as const;
const RECOVERY_STALE_MS = 5 * 60 * 1000;

export interface BackupRecoveryReading {
  readonly recovery: RecoveryStatus;
  readonly secondFolderSet: boolean;
  readonly lastCopyPortable: boolean | null;
}

/**
 * Null whenever the main process does not answer with a status: the browser
 * build, a LAN till (its backup channels refuse — it owns no backups), or a
 * user without the backup grant. Every surface that warns about protection
 * renders nothing on null, which is what keeps it off a till.
 */
export function useBackupRecovery(): UseQueryResult<BackupRecoveryReading | null, Error> {
  const { session } = useApi();
  const token = session?.token ?? null;
  const bridge = backupBridge();
  return useQuery<BackupRecoveryReading | null, Error>({
    queryKey: BACKUP_RECOVERY_QUERY_KEY,
    enabled: token !== null && bridge?.status !== undefined,
    staleTime: RECOVERY_STALE_MS,
    queryFn: async () => {
      if (!bridge?.status || !token) return null;
      const result = await bridge.status(token);
      if (isBackupFailure(result) || !result.recovery) return null;
      return {
        recovery: result.recovery,
        secondFolderSet: result.secondTarget.dir !== null,
        lastCopyPortable: result.secondTarget.lastCopyPortable ?? null,
      };
    },
  });
}

export function useRefreshBackupRecovery(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries({ queryKey: BACKUP_RECOVERY_QUERY_KEY }), [queryClient]);
}
