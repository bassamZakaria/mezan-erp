import { Button, Card, StatusPill, formatDateTime, type PillTone } from "@mezan/ui";
import { HealthLevelDTO, type HealthJobDTO, type PlatformAlertStateDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { usePlatformApi } from "./api";
import { usePlatformOperationsQuery } from "./hooks";

const LEVEL_TONE: Readonly<Record<HealthLevelDTO, PillTone>> = {
  [HealthLevelDTO.Ok]: "success",
  [HealthLevelDTO.Warn]: "warning",
  [HealthLevelDTO.Critical]: "danger",
  [HealthLevelDTO.Unknown]: "neutral",
};

const LEVEL_LABEL: Readonly<Record<HealthLevelDTO, AppTranslationKey>> = {
  [HealthLevelDTO.Ok]: "health.level.ok",
  [HealthLevelDTO.Warn]: "health.level.warn",
  [HealthLevelDTO.Critical]: "health.level.critical",
  [HealthLevelDTO.Unknown]: "health.level.unknown",
};

const CHECK_LABEL: Readonly<Record<string, AppTranslationKey>> = {
  platform_database: "platform.operations.check.platform_database",
  tenant_router: "platform.operations.check.tenant_router",
};

const JOB_LABEL: Readonly<Record<string, AppTranslationKey>> = {
  platform_dunning: "platform.operations.job.platform_dunning",
  platform_owner_digest: "platform.operations.job.platform_owner_digest",
  platform_card_checkout_sweep: "platform.operations.job.platform_card_checkout_sweep",
  platform_backups: "platform.operations.job.platform_backups",
  platform_audit_anchor: "platform.operations.job.platform_audit_anchor",
};

const ALERT_LABEL: Readonly<Record<string, AppTranslationKey>> = {
  error_burst: "platform.operations.alert.error_burst",
  job_failed: "platform.operations.alert.job_failed",
  unclean_restart: "platform.operations.alert.unclean_restart",
  not_ready: "platform.operations.alert.not_ready",
  unhandled_rejection: "platform.operations.alert.unhandled_rejection",
};

function JobRow({ job }: { job: HealthJobDTO }) {
  const { t, locale } = useAppTranslation();
  const label = JOB_LABEL[job.kind];
  return (
    <li className="flex flex-col gap-[2px] border-b border-border py-[8px] text-[12px] text-ink-muted last:border-0">
      <div className="flex items-center justify-between gap-[8px]">
        <span className="font-semibold text-ink">{label ? t(label) : <span className="mz-lat">{job.kind}</span>}</span>
        <StatusPill label={t(LEVEL_LABEL[job.level])} tone={LEVEL_TONE[job.level]} />
      </div>
      <div>{job.lastRunAt ? t("health.jobs.lastRun", { time: formatDateTime(job.lastRunAt, { locale }) }) : t("health.jobs.neverRun")}</div>
      {job.nextRunAt ? <div>{t("health.jobs.nextRun", { time: formatDateTime(job.nextRunAt, { locale }) })}</div> : null}
      {job.lastError ? <div className="text-danger-ink [overflow-wrap:anywhere]">{t("health.jobs.lastError", { error: job.lastError })}</div> : null}
    </li>
  );
}

function AlertRow({ alert }: { alert: PlatformAlertStateDTO }) {
  const { t, locale } = useAppTranslation();
  const label = ALERT_LABEL[alert.kind];
  return (
    <li className="flex flex-col gap-[2px] border-b border-border py-[8px] text-[12px] text-ink-muted last:border-0">
      <span className="font-semibold text-ink">
        {label ? t(label) : <span className="mz-lat">{alert.kind}</span>}
        <span className="mz-lat ms-[6px] text-ink-faint" dir="ltr">{alert.key}</span>
      </span>
      <div>{t("platform.operations.alert.lastRaised", { time: formatDateTime(alert.lastRaisedAt, { locale }) })}</div>
      <div>{alert.lastSentAt ? t("platform.operations.alert.lastSent", { time: formatDateTime(alert.lastSentAt, { locale }) }) : t("platform.operations.alert.neverSent")}</div>
      {alert.suppressed > 0 ? <div>{t("platform.operations.alert.suppressed", { count: String(alert.suppressed) })}</div> : null}
    </li>
  );
}

export function OperationsPage() {
  const { t } = useAppTranslation();
  const { session } = usePlatformApi();
  const isOwner = session?.user.role === "owner";
  const query = usePlatformOperationsQuery();
  const data = query.data;

  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h1 className="font-display text-[20px] font-bold text-ink">{t("platform.operations.title")}</h1>
        <p className="mt-[4px] max-w-[80ch] text-[12.5px] text-ink-muted">{t("platform.operations.description")}</p>
      </div>

      {!isOwner ? (
        <Card className="p-[18px] text-[13px] font-semibold text-ink-muted">{t("platform.operations.ownerOnly")}</Card>
      ) : query.isLoading ? (
        <Card className="p-[18px] text-[13px] text-ink-muted">{t("common.loading")}</Card>
      ) : query.isError ? (
        <Card className="flex flex-wrap items-center justify-between gap-[10px] p-[18px]">
          <p role="alert" className="text-[13px] font-semibold text-danger-ink">{query.error.message}</p>
          <Button onClick={() => void query.refetch()}>{t("common.retry")}</Button>
        </Card>
      ) : data ? (
        <>
          <Card className="flex flex-col gap-[8px] p-[16px_18px]">
            <StatusPill label={t(data.ready ? "platform.operations.ready" : "platform.operations.notReady")} tone={data.ready ? "success" : "danger"} />
            <ul className="flex flex-col gap-[4px] text-[12.5px]">
              {Object.entries(data.checks).map(([check, ok]) => (
                <li key={check} className="flex items-center justify-between gap-[8px]">
                  <span className="text-ink">{CHECK_LABEL[check] ? t(CHECK_LABEL[check]!) : <span className="mz-lat">{check}</span>}</span>
                  <span className={ok ? "text-ink-muted" : "font-semibold text-danger-ink"}>{t(ok ? "platform.operations.checkOk" : "platform.operations.checkFailing")}</span>
                </li>
              ))}
            </ul>
            <p className={data.alertsConfigured ? "text-[12px] text-ink-muted" : "text-[12px] font-semibold text-warning-ink"}>
              {t(data.alertsConfigured ? "platform.operations.alertsConfigured" : "platform.operations.alertsNotConfigured")}
            </p>
          </Card>
          <div className="grid grid-cols-1 gap-[14px] md:grid-cols-2">
            <Card className="p-[16px_18px]">
              <h2 className="mb-[6px] text-[13px] font-bold text-ink">{t("platform.operations.jobs")}</h2>
              {data.jobs.length === 0 ? (
                <p className="text-[12px] text-ink-muted">{t("platform.operations.noJobs")}</p>
              ) : (
                <ul>{data.jobs.map((job) => <JobRow key={job.kind} job={job} />)}</ul>
              )}
            </Card>
            <Card className="p-[16px_18px]">
              <h2 className="mb-[6px] text-[13px] font-bold text-ink">{t("platform.operations.alerts")}</h2>
              {data.alerts.length === 0 ? (
                <p className="text-[12px] text-ink-muted">{t("platform.operations.noAlerts")}</p>
              ) : (
                <ul>{data.alerts.map((alert) => <AlertRow key={alert.key} alert={alert} />)}</ul>
              )}
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
