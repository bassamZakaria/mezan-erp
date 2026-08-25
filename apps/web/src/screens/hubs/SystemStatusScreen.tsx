import { FulcrumRule, Button, Card, StatusPill } from "@mezan/ui";
import { useSystemStatus, type ServiceStateDTO } from "../../data/hub-hooks";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";

/**
 * حالة النظام (/status). Mezan is a local-first, fully-offline desktop app —
 * there is no cloud services board to report, so this screen is honest about
 * what "service health" even means here: it checks the TWO things that can
 * genuinely fail on a real install (the API responding, the SQLite database
 * being reachable for a real read) via `useSystemStatus`, shows the actual
 * shipped app version (from `apps/web/package.json`, a real build constant),
 * and is explicit that there is no incident-tracking system and no fabricated
 * uptime history — an empty incident list, not invented outages.
 *
 * The changelog below is real: each entry is an actual commit that shipped in
 * this repository (`git log`), not marketing copy.
 */

const STATE_TONE: Record<ServiceStateDTO, "success" | "warning" | "danger" | "neutral"> = {
  operational: "success",
  degraded: "warning",
  down: "danger",
  checking: "neutral",
};

const STATE_KEY: Record<ServiceStateDTO, AppTranslationKey> = {
  operational: "systemStatus.runningNormally",
  degraded: "systemStatus.degraded",
  down: "systemStatus.unavailable",
  checking: "systemStatus.checking",
};

/** Real commits from this repository's own history (`git log --date=short`), not invented release notes. */
const RECENT_CHANGES: { date: string; summaryKey: AppTranslationKey }[] = [
  { date: "2026-08-23", summaryKey: "systemStatus.itemCategoriesAndUnitsNow" },
  { date: "2026-08-23", summaryKey: "systemStatus.stockBalancesTransfersAdjustmentsAnd" },
  { date: "2026-08-23", summaryKey: "systemStatus.entitlementsAreServedOverA" },
  { date: "2026-08-23", summaryKey: "systemStatus.settingsBranchesWarehousesAndThe" },
  { date: "2026-08-23", summaryKey: "systemStatus.theTrialBalanceAndAll" },
  { date: "2026-08-23", summaryKey: "systemStatus.theSessionSurvivesAPage" },
];

export function SystemStatusScreen() {
  const { t } = useAppTranslation();
  const query = useSystemStatus();
  const status = query.data;
  const services = status?.services ?? [];
  const allOperational = services.length > 0 && services.every((s) => s.state === "operational");

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <div className="mz-eyebrow">System status</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">{t("systemStatus.systemStatus")}</h1>
          <p className="mt-[4px] max-w-[68ch] text-[12.5px] text-ink-muted">
            {t("systemStatus.mezanIsADesktopApplication")}
          </p>
        </div>
        <Button size="sm" onClick={() => query.refetch()}>
          {t("systemStatus.checkAgainNow")}
        </Button>
      </div>
      <div className="-mt-[18px] -mb-[22px]">
        <FulcrumRule />
      </div>

      {query.isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("systemStatus.couldNotRunTheSystem")}</p>
        </Card>
      ) : (
        <Card className="flex items-center gap-[10px] p-[14px_18px]">
          <StatusPill
            label={query.isLoading ? t("systemStatus.checking") : allOperational ? t("systemStatus.everythingIsRunningNormally") : t("systemStatus.oneOfTheSystemsHas")}
            tone={query.isLoading ? "neutral" : allOperational ? "success" : "danger"}
          />
          {status ? (
            <span className="mz-num text-[11.5px] text-ink-faint">{t("systemStatus.lastChecked")} {new Date(status.checkedAt).toLocaleTimeString("ar-EG")}</span>
          ) : null}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
        {services.map((service) => (
          <Card key={service.key} className="p-[16px_18px]">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-ink">{service.label}</span>
              <StatusPill label={t(STATE_KEY[service.state])} tone={STATE_TONE[service.state]} />
            </div>
            <p className="mt-[8px] text-[11.5px] text-ink-faint">{service.detail}</p>
          </Card>
        ))}
        <Card className="p-[16px_18px]">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold text-ink">{t("systemStatus.applicationVersion")}</span>
            <StatusPill label={t("systemStatus.note")} tone="neutral" />
          </div>
          <p className="mz-num mt-[8px] text-[11.5px] text-ink-faint">
            {status ? t("systemStatus.versionIs", { version: status.appVersion }) : "—"} {t("systemStatus.nothingUpdatesItselfOverThe")}
          </p>
        </Card>
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">{t("systemStatus.incidentLog")}</h3>
        <p className="mt-[2px] text-[11.5px] text-ink-faint">
          {t("systemStatus.thisLocalApplicationHasNo")}
        </p>
        <div className="mt-[12px] rounded-md border border-dashed border-border p-[16px] text-center text-[12.5px] text-ink-muted">
          {t("systemStatus.noIncidentsRecorded")}
        </div>
      </Card>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">{t("systemStatus.recentUpdates")}</h3>
        <div className="mt-[2px] text-[11.5px] text-ink-faint">{t("systemStatus.realChangesFromTheProject")}</div>
        <ul className="mt-[12px] flex flex-col gap-[10px]">
          {RECENT_CHANGES.map((change, index) => (
            <li key={index} className="flex items-start gap-[10px]">
              <span aria-hidden className="mt-[6px] h-[6px] w-[6px] flex-none rounded-full bg-brand" />
              <div>
                <div className="text-[12.5px] text-ink">{t(change.summaryKey)}</div>
                <div className="mz-num mt-[1px] text-[11px] text-ink-faint">{change.date}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
