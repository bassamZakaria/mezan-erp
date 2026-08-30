import { Button } from "@mezan/ui";
import { useUpdates } from "./data/update-hooks";
import { useAppTranslation } from "./i18n";

/**
 * Desktop update banner (docs/archive/plan.md §2.3). Surfaces the main
 * process's update status and relays the user's consent — the download is never
 * silent, and a release whose Ed25519 signature does not verify is reported as
 * refused, not quietly retried. Nothing renders on the web edition, or while
 * idle / checking / up-to-date.
 */
export function UpdateBanner() {
  const { t } = useAppTranslation();
  const { supported, status, download, install } = useUpdates();
  if (!supported) return null;

  const { phase, version, percent } = status;

  // A refused (unauthentic) update is a security event — show it in red.
  if (phase === "rejected") {
    return (
      <div
        role="alert"
        className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[14px] py-[10px] text-[12.5px] text-danger-ink"
      >
        <div className="font-semibold">{t("update.rejected.title")}</div>
        <div className="mt-[2px]">{t("update.rejected.body")}</div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div
        role="alert"
        className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[14px] py-[10px] text-[12.5px] text-danger-ink"
      >
        {t("update.error")}
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
      </div>
    );
  }

  return null;
}
