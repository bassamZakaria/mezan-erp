import { useState } from "react";
import { Button, Card } from "@mezan/ui";
import { isDesktopHost } from "../data/hooks";
import { useApi } from "../data/ApiContext";
import { useUpdates } from "../data/update-hooks";
import { useAppTranslation } from "../i18n";

interface Bridge {
  licence?: { checkin(token: string): Promise<{ messageAr: string }> };
}

function bridge(): Bridge | undefined {
  return (globalThis as { mezan?: Bridge }).mezan;
}

/**
 * THE THREE THINGS AN OPERATOR CAN ASK FOR ON PURPOSE.
 *
 * Every one of them already happened on a schedule the shop could not see: the
 * daily backup, the licence check-in at startup, the update check outside
 * opening hours. Schedules are right — nobody should have to remember — but a
 * schedule with no manual trigger is unusable in the two moments that matter
 * most:
 *
 *   - the consultant on the phone who needs the machine to check in NOW,
 *     because the shop is one day from read-only and its router was down;
 *   - anyone about to do something risky, who wants a backup taken THIS minute
 *     rather than whenever the timer next fires.
 *
 * `useUpdates().check()` in particular already existed and nothing in the
 * product called it: the update banner only ever appeared once a scheduled check
 * had already found something, so a shop could not ask "is there a new version"
 * at all.
 *
 * Desktop-only, and it says so rather than rendering dead buttons in a browser
 * where none of these channels exist.
 */
export function MaintenancePanel() {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const updates = useUpdates();
  const [busy, setBusy] = useState<"backup" | "licence" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!isDesktopHost()) return null;

  const token = session?.token ?? null;

  async function takeBackup() {
    if (!token) return;
    setBusy("backup");
    setNotice(null);
    try {
      const api = (globalThis as { mezan?: { backup: { create(t: string): Promise<{ ok: boolean }> } } }).mezan;
      const result = await api?.backup.create(token);
      setNotice(result?.ok ? t("backup.created") : t("maintenance.backupFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function checkLicence() {
    if (!token) return;
    setBusy("licence");
    setNotice(null);
    try {
      const result = await bridge()?.licence?.checkin(token);
      // The handler already produces Arabic prose carrying the day count and
      // what to do; re-wording it here would put two different sentences in
      // front of support for the same state.
      setNotice(result?.messageAr ?? t("maintenance.licenceFailed"));
    } finally {
      setBusy(null);
    }
  }

  // WITHOUT THIS THE UPDATE BUTTON IS SILENT WHEN THERE IS NOTHING TO INSTALL.
  // `UpdateBanner` renders only from `available` onwards, so a machine already
  // on the newest build answered a deliberate press with no change on screen at
  // all — indistinguishable from a dead button.
  const updateNotice = ((): string | null => {
    switch (updates.status.phase) {
      case "checking":
        return t("maintenance.updateChecking");
      case "not-available":
        return t("maintenance.updateNone");
      case "available":
      case "downloading":
      case "verifying":
      case "ready":
        return `${t("maintenance.updateAvailable")} ${updates.status.version ?? ""}`.trim();
      case "error":
      case "rejected":
        return t("maintenance.updateFailed");
      default:
        return null;
    }
  })();

  return (
    <Card className="mt-[16px] p-[16px]">
      <h2 className="font-display text-[15px] font-bold text-ink">{t("maintenance.title")}</h2>
      <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("maintenance.subtitle")}</p>

      <div className="mt-[12px] flex flex-wrap gap-[8px]">
        <Button variant="default" size="sm" disabled={busy !== null} onClick={() => void takeBackup()}>
          {busy === "backup" ? t("maintenance.working") : t("backup.createNow")}
        </Button>
        <Button variant="default" size="sm" disabled={busy !== null} onClick={() => void checkLicence()}>
          {busy === "licence" ? t("maintenance.working") : t("maintenance.checkLicence")}
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={busy !== null || !updates.supported}
          onClick={() => {
            setNotice(null);
            updates.check();
          }}
        >
          {t("maintenance.checkUpdates")}
        </Button>
      </div>

      {(notice ?? updateNotice) ? (
        <p role="status" className="mt-[10px] text-[12.5px] text-ink">
          {notice ?? updateNotice}
        </p>
      ) : null}
    </Card>
  );
}
