import { useEffect, useState } from "react";
import { Button, Card } from "@mezan/ui";
// lan-ux
import { pairing, pairingSupported } from "../lan/pairing-bridge";
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
  /**
   * lan-ux: THIS MACHINE IS A TILL, AND THE PANEL HAS TO SAY SO.
   *
   * `isDesktopHost()` is true on a client too — the bridge is there, the
   * database is not — so the panel rendered three buttons that a till cannot
   * satisfy and said nothing about why. Null while the answer is still in
   * flight, so nothing on screen claims a role this component has not been
   * told.
   */
  const [clientOf, setClientOf] = useState<string | null>(null);

  useEffect(() => {
    if (!pairingSupported()) return;
    let live = true;
    void pairing({ kind: "state" })
      .then((res) => {
        if (live && res?.kind === "state" && res.role === "client") setClientOf(res.hostUrl);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!isDesktopHost()) return null;

  const token = session?.token ?? null;

  /**
   * lan-ux (N-7, ticket #7): «ضغطت نسخة احتياطية ولم يحدث شيء».
   *
   * BOTH HANDLERS NOW CATCH, and the reason is the client machine. An
   * `ipcMain.handle` that was never registered REJECTS — it does not resolve to
   * undefined — so on a till these two calls threw, nothing caught them, and
   * the operator's whole experience of pressing the button was nothing
   * happening. The main process answers every bridged channel with an Arabic
   * refusal now (main/client-refusals.ts), but a `catch` here is what makes
   * that guarantee unnecessary rather than load-bearing: a channel that goes
   * missing again must not silently do nothing.
   *
   * The refusal's OWN message is shown, never a re-wording: the handler knows
   * whether this is a client, an unauthorised caller or a genuine failure, and
   * a generic "it failed" here would throw that away.
   */
  async function takeBackup() {
    if (!token) return;
    setBusy("backup");
    setNotice(null);
    try {
      const api = (globalThis as {
        mezan?: { backup: { create(t: string): Promise<{ ok: boolean; message?: string }> } };
      }).mezan;
      const result = await api?.backup.create(token);
      setNotice(result?.ok ? t("backup.created") : (result?.message ?? t("maintenance.backupFailed")));
    } catch {
      setNotice(t("maintenance.backupFailed"));
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
    } catch {
      setNotice(t("maintenance.licenceFailed"));
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
      // NOT a failure, and it used to be reported as one on every machine in
      // the field: no feed and no vendor key means this build is updated by
      // running a new installer, which is a fact about the build rather than
      // something that went wrong when the operator pressed the button.
      case "unavailable":
        return t("maintenance.updateUnavailable");
      case "scheduled":
        return t("update.scheduled");
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

      {clientOf ? (
        <p className="mt-[10px] rounded-[6px] border border-border bg-surface-2 p-[10px] text-[12.5px] text-ink">
          {t("maintenance.clientMachine", { host: clientOf })}
        </p>
      ) : null}

      <div className="mt-[12px] flex flex-wrap gap-[8px]">
        <Button
          variant="default"
          size="sm"
          disabled={busy !== null || clientOf !== null}
          onClick={() => void takeBackup()}
        >
          {busy === "backup" ? t("maintenance.working") : t("backup.createNow")}
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={busy !== null || clientOf !== null}
          onClick={() => void checkLicence()}
        >
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

      {/*
        The order, in the product rather than only in a runbook. An offline shop
        updates by running a new installer, and the one thing it must not do is
        update a till before the host: a client and its host that disagree is
        the failure `/health` now refuses at startup, and «تعذّر الوصول» is what
        the counter would see instead of an explanation.
      */}
      <p className="mt-[10px] text-[12px] text-ink-faint">{t("maintenance.updateOrder")}</p>
    </Card>
  );
}
