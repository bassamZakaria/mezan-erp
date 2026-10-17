import { useState } from "react";
import { Button, Card } from "@mezan/ui";
import { useApi } from "../data/ApiContext";
import { sessionHolds } from "../data/session";
import { useAppTranslation } from "../i18n";
import { BackupProtectionPanel } from "./BackupProtectionPanel";
import { useBackupRecovery, useRefreshBackupRecovery } from "./useBackupRecovery";

const RESTORE_PERMISSION = "admin.backup.restore";

/**
 * The dashboard's reminder for an install that never set a recovery secret.
 * Shown to whoever may set it, until it is set; on a till, the browser build or
 * for anyone else the status reading is null and this renders nothing.
 */
export function BackupProtectionNotice() {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const protection = useBackupRecovery();
  const refreshProtection = useRefreshBackupRecovery();
  const [open, setOpen] = useState(false);
  const recovery = protection.data?.recovery ?? null;
  const token = session?.token ?? null;

  if (!recovery || !token || recovery.mode !== null || !recovery.keyStoreAvailable) return null;
  if (!sessionHolds(session, RESTORE_PERMISSION)) return null;

  return (
    <Card role="alert" className="border-danger p-[16px_18px]">
      <div className="text-[13.5px] font-semibold text-danger-ink">{t("backupProtection.dashboard.title")}</div>
      <p className="mt-[4px] text-[12.5px] text-ink">{t("backupProtection.dashboard.body")}</p>
      {open ? (
        <div className="mt-[12px]">
          <BackupProtectionPanel sessionToken={token} recovery={recovery} onSaved={() => void refreshProtection()} />
        </div>
      ) : (
        <Button variant="primary" size="sm" className="mt-[10px]" onClick={() => setOpen(true)}>
          {t("backupProtection.banner.action")}
        </Button>
      )}
    </Card>
  );
}
