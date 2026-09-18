import { Button } from "@mezan/ui";
import { useUpdates } from "./data/update-hooks";
import { useAppTranslation } from "./i18n";

/**
 * Desktop update banner (docs/archive/plan.md §2.3). Surfaces the main
 * process's update status and relays the user's consent — the download is never
 * silent, and a release whose Ed25519 signature does not verify is reported as
 * refused, not quietly retried. Nothing renders on the web edition, or while
 * idle / checking / up-to-date.
 *
 * TWO THINGS THIS SCREEN GOT WRONG, and both were the top of the support queue:
 *
 *   1. A failure was a red `role="alert"` across every screen with NO WAY TO
 *      CLOSE IT until the app restarted. Anyone who pressed «تحقق من التحديثات»
 *      on a machine with no feed configured — which is every machine in the
 *      field today — lived with it for the rest of the day.
 *   2. That state was reported as an ERROR at all. A build with no update feed
 *      is not broken; it is updated by running a new installer, and now it says
 *      so calmly, in blue, once.
 */
export function UpdateBanner() {
  const { t } = useAppTranslation();
  const { supported, status, download, install, dismiss } = useUpdates();
  if (!supported) return null;

  const { phase, version, percent } = status;

  const dismissButton = (
    <Button variant="ghost" size="sm" onClick={dismiss}>
      {t("update.dismiss")}
    </Button>
  );

  // A refused (unauthentic) update is a security event — show it in red.
  if (phase === "rejected") {
    return (
      <div
        role="alert"
        className="mb-[16px] flex flex-wrap items-center justify-between gap-[12px] rounded-md border border-danger bg-danger-soft px-[14px] py-[10px] text-[12.5px] text-danger-ink"
      >
        <div>
          <div className="font-semibold">{t("update.rejected.title")}</div>
          <div className="mt-[2px]">{t("update.rejected.body")}</div>
        </div>
        {dismissButton}
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div
        role="alert"
        className="mb-[16px] flex flex-wrap items-center justify-between gap-[12px] rounded-md border border-danger bg-danger-soft px-[14px] py-[10px] text-[12.5px] text-danger-ink"
      >
        <span>{t("update.error")}</span>
        {dismissButton}
      </div>
    );
  }

  // Not an error: this build simply does not receive updates over a feed.
  if (phase === "unavailable") {
    return (
      <div
        role="status"
        className="mb-[16px] flex flex-wrap items-center justify-between gap-[12px] rounded-md border border-border bg-surface-2 px-[14px] py-[10px] text-[12.5px] text-ink"
      >
        <span>{t("update.unavailable")}</span>
        {dismissButton}
      </div>
    );
  }

  // The launch-time pre-update backup. No dismiss: the app is not usable until
  // it finishes, and hiding the one sentence that explains why would leave a
  // frozen screen with no reason on it.
  if (phase === "migrating") {
    return (
      <div
        role="status"
        className="mb-[16px] rounded-md border border-brand bg-brand-soft px-[14px] py-[10px] text-[12.5px] text-ink"
      >
        {t("update.migrating")}
      </div>
    );
  }

  if (phase === "scheduled") {
    return (
      <div
        role="status"
        className="mb-[16px] flex flex-wrap items-center justify-between gap-[12px] rounded-md border border-brand bg-brand-soft px-[14px] py-[10px] text-[12.5px] text-ink"
      >
        <span>{t("update.scheduled")}</span>
        {dismissButton}
      </div>
    );
  }

  if (phase === "available" || phase === "verifying") {
    return (
      <div
        role="status"
        className="mb-[16px] flex flex-wrap items-center gap-[12px] rounded-md border border-brand bg-brand-soft px-[14px] py-[10px] text-[12.5px] text-ink"
      >
        <span className="font-semibold">
          {t("update.available", { version: version ?? "" })}
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={download}
          disabled={phase === "verifying"}
        >
          {phase === "verifying" ? t("update.verifying") : t("update.download")}
        </Button>
        {dismissButton}
      </div>
    );
  }

  if (phase === "downloading") {
    return (
      <div
        role="status"
        className="mb-[16px] rounded-md border border-brand bg-brand-soft px-[14px] py-[10px] text-[12.5px] text-ink"
      >
        {t("update.downloading", { percent: String(percent ?? 0) })}
      </div>
    );
  }

  if (phase === "ready") {
    return (
      <div
        role="status"
        className="mb-[16px] flex flex-wrap items-center gap-[12px] rounded-md border border-brand bg-brand-soft px-[14px] py-[10px] text-[12.5px] text-ink"
      >
        <span className="font-semibold">{t("update.ready")}</span>
        <Button variant="primary" size="sm" onClick={install}>
          {t("update.install")}
        </Button>
        {dismissButton}
      </div>
    );
  }

  return null;
}
