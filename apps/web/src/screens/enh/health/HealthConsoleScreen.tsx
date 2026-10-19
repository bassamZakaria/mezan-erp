import { useCountPhrase } from "../../../lib/count-phrase";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Button, Card, StatusPill, formatDateTime } from "@mezan/ui";
import { HealthItemKey, HealthLevel, backupLevel, deviceLevel, diskLevel, drillLevel, healthDaysBetween, DrillVerdict, worstLevel, ArabicCase, CountedNoun } from "@mezan/domain";
import { HealthLevelDTO, HealthSectionDTO, type HealthJobDTO, type SystemHealthDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { isDesktopHost, useLanSessions, useLanStatus } from "../../../data/hooks";
import { useDrainNotificationOutbox } from "../../../data/notification-outbox-hooks";
import { useVerifyAuditChain } from "../../../data/platform-hooks";
import { sessionHolds } from "../../../data/session";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { pathForRoute } from "../../../routing";
import type { ScreenKey } from "../../../router/screens";
import { MaintenancePanel } from "../../../settings/MaintenancePanel";
import { SystemStatusScreen } from "../../hubs/SystemStatusScreen";
import { useDesktopBackupHealth, useMayViewSystemHealth, useSystemHealth } from "./hooks";
import { ClientErrorsCard } from "./ClientErrorsCard";

const FIX_SCREEN: Readonly<Record<HealthItemKey, ScreenKey>> = {
  [HealthItemKey.Outbox]: "notification-rules",
  [HealthItemKey.Eta]: "eta",
  [HealthItemKey.AuditChain]: "audit",
  [HealthItemKey.Licence]: "settings-billing",
  [HealthItemKey.Seats]: "users",
  [HealthItemKey.Jobs]: "leave-accrual-batches",
  [HealthItemKey.Database]: "settings-backup",
  [HealthItemKey.Devices]: "devices",
  [HealthItemKey.Backup]: "settings-backup",
  [HealthItemKey.Drill]: "settings-backup",
  [HealthItemKey.Disk]: "settings-backup",
};

const ITEM_LABEL: Readonly<Record<HealthItemKey, AppTranslationKey>> = {
  [HealthItemKey.Outbox]: "health.item.outbox",
  [HealthItemKey.Eta]: "health.item.eta",
  [HealthItemKey.AuditChain]: "health.item.audit_chain",
  [HealthItemKey.Licence]: "health.item.licence",
  [HealthItemKey.Seats]: "health.item.seats",
  [HealthItemKey.Jobs]: "health.item.jobs",
  [HealthItemKey.Database]: "health.item.database",
  [HealthItemKey.Devices]: "health.item.devices",
  [HealthItemKey.Backup]: "health.item.backup",
  [HealthItemKey.Drill]: "health.item.drill",
  [HealthItemKey.Disk]: "health.item.disk",
};

const LEVEL_LABEL: Readonly<Record<HealthLevel, AppTranslationKey>> = {
  [HealthLevel.Ok]: "health.level.ok",
  [HealthLevel.Warn]: "health.level.warn",
  [HealthLevel.Critical]: "health.level.critical",
  [HealthLevel.Unknown]: "health.level.unknown",
};

const OVERALL_LABEL: Readonly<Record<HealthLevel, AppTranslationKey>> = {
  [HealthLevel.Ok]: "health.overall.ok",
  [HealthLevel.Warn]: "health.overall.warn",
  [HealthLevel.Critical]: "health.overall.critical",
  [HealthLevel.Unknown]: "health.overall.unknown",
};

const LEVEL_TONE: Readonly<Record<HealthLevel, "success" | "warning" | "danger" | "neutral">> = {
  [HealthLevel.Ok]: "success",
  [HealthLevel.Warn]: "warning",
  [HealthLevel.Critical]: "danger",
  [HealthLevel.Unknown]: "neutral",
};

const DTO_LEVEL: Readonly<Record<HealthLevelDTO, HealthLevel>> = {
  [HealthLevelDTO.Ok]: HealthLevel.Ok,
  [HealthLevelDTO.Warn]: HealthLevel.Warn,
  [HealthLevelDTO.Critical]: HealthLevel.Critical,
  [HealthLevelDTO.Unknown]: HealthLevel.Unknown,
};

const JOB_LABEL: Readonly<Record<string, AppTranslationKey>> = {
  leave_accrual: "health.jobs.kind.leave_accrual",
  crm_activity_reminders: "health.jobs.kind.crm_activity_reminders",
};

const BYTES_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const BYTES_STEP = 1024;
const MS_PER_SECOND = 1000;
const DRILL_FAILED_OUTCOME = "fail";

function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= BYTES_STEP && unit < BYTES_UNITS.length - 1) {
    value /= BYTES_STEP;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${BYTES_UNITS[unit]}`;
}

interface ConsoleItem {
  readonly key: HealthItemKey;
  readonly level: HealthLevel;
  readonly body: ReactNode;
}

function LevelPill({ level }: { level: HealthLevel }) {
  const { t } = useAppTranslation();
  return <StatusPill label={t(LEVEL_LABEL[level])} tone={LEVEL_TONE[level]} />;
}

function OutboxBody({ health, mayRetry }: { health: NonNullable<SystemHealthDTO["outbox"]>; mayRetry: boolean }) {
  const { t } = useAppTranslation();
  const drain = useDrainNotificationOutbox();
  return (
    <div className="flex flex-col gap-[6px]">
      <p className="text-[12px] text-ink-muted">
        {health.queued === 0 && health.failed === 0
          ? t("health.outbox.none")
          : t("health.outbox.summary", { queued: String(health.queued), failed: String(health.failed) })}
      </p>
      {health.oldestAgeMinutes !== null && health.queued > 0 ? (
        <p className="text-[12px] text-ink-muted">{t("health.outbox.oldest", { minutes: String(health.oldestAgeMinutes) })}</p>
      ) : null}
      {!health.mailConfigured && health.queued > 0 ? <p className="text-[12px] text-warning-ink">{t("health.outbox.mailOff")}</p> : null}
      {mayRetry && health.queued > 0 && health.mailConfigured ? (
        <div>
          <Button size="sm" disabled={drain.isPending} onClick={() => drain.mutate()}>
            {drain.isPending ? t("health.outbox.retrying") : t("health.outbox.retry")}
          </Button>
        </div>
      ) : null}
      {drain.data ? (
        <p role="status" className="text-[12px] text-ink">
          {t("health.outbox.retried", { sent: String(drain.data.sent), failed: String(drain.data.failed) })}
        </p>
      ) : null}
      {drain.error ? <p role="alert" className="text-[12px] text-danger-ink">{drain.error.message}</p> : null}
    </div>
  );
}

function EtaBody({ health, now }: { health: NonNullable<SystemHealthDTO["eta"]>; now: Date }) {
  const { t } = useAppTranslation();
  const oldestHours = health.oldestUnsentAt ? Math.floor((now.getTime() - new Date(health.oldestUnsentAt).getTime()) / (MS_PER_SECOND * 3600)) : null;
  return (
    <div className="flex flex-col gap-[6px]">
      <p className="text-[12px] text-ink-muted">
        {t("health.eta.summary", {
          ready: String(health.ready),
          pending: String(health.pendingSignature),
          error: String(health.error),
          submitted: String(health.submitted),
        })}
      </p>
      {health.clientSecretNeedsReentry ? (
        <p role="alert" className="text-[12px] font-semibold text-danger-ink">
          {t("health.eta.secretNeedsReentry")}
        </p>
      ) : null}
      {oldestHours !== null ? <p className="text-[12px] text-ink-muted">{t("health.eta.oldest", { hours: String(oldestHours) })}</p> : null}
      {health.recentErrors.length === 0 ? (
        <p className="text-[12px] text-ink-faint">{t("health.eta.noErrors")}</p>
      ) : (
        <div>
          <p className="text-[12px] font-semibold text-ink">{t("health.eta.recentErrors")}</p>
          <ul className="mt-[4px] flex flex-col gap-[2px] text-[11.5px] text-ink-muted">
            {health.recentErrors.map((error) => (
              <li key={error.internalId}>
                <span className="mz-num font-semibold text-ink">{error.internalId}</span> — {error.message ?? "—"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AuditBody({ health, mayVerify }: { health: NonNullable<SystemHealthDTO["auditChain"]>; mayVerify: boolean }) {
  const { t } = useAppTranslation();
  const verify = useVerifyAuditChain();
  const result = verify.data;
  return (
    <div className="flex flex-col gap-[6px]">
      <p className="text-[12px] text-ink-muted">
        {DTO_LEVEL[health.level] === HealthLevel.Ok ? t("health.audit.ok") : t("health.audit.bad", { reason: health.reason })}
      </p>
      {mayVerify ? (
        <div>
          <Button size="sm" disabled={verify.isPending} onClick={() => verify.mutate()}>
            {verify.isPending ? t("health.audit.verifying") : t("health.audit.verify")}
          </Button>
        </div>
      ) : null}
      {result ? (
        <p role="status" className={`text-[12px] ${result.ok ? "text-ink" : "text-danger-ink"}`}>
          {result.ok
            ? t("health.audit.verifiedOk", { checked: String(result.checked) })
            : t("health.audit.verifiedBad", { reason: result.reason, row: String(result.brokenRowId ?? "—") })}
        </p>
      ) : null}
      {verify.error ? <p role="alert" className="text-[12px] text-danger-ink">{verify.error.message}</p> : null}
    </div>
  );
}

function JobsBody({ jobs }: { jobs: readonly HealthJobDTO[] }) {
  const { t, locale } = useAppTranslation();
  if (jobs.length === 0) return <p className="text-[12px] text-ink-muted">{t("health.jobs.none")}</p>;
  return (
    <ul className="flex flex-col gap-[8px]">
      {jobs.map((job) => {
        const label = JOB_LABEL[job.kind];
        return (
          <li key={job.kind} className="text-[12px] text-ink-muted">
            <div className="flex items-center justify-between gap-[8px]">
              <span className="font-semibold text-ink">{label ? t(label) : job.kind}</span>
              <LevelPill level={DTO_LEVEL[job.level]} />
            </div>
            <div>{job.lastRunAt ? t("health.jobs.lastRun", { time: formatDateTime(job.lastRunAt, { locale }) }) : t("health.jobs.neverRun")}</div>
            {job.nextRunAt ? <div>{t("health.jobs.nextRun", { time: formatDateTime(job.nextRunAt, { locale }) })}</div> : null}
            {job.lastError ? <div className="text-danger-ink">{t("health.jobs.lastError", { error: job.lastError })}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}

function DevicesBody() {
  const { t, locale } = useAppTranslation();
  const status = useLanStatus(isDesktopHost());
  const licensed = status.data?.licensed === true;
  const sessions = useLanSessions(licensed);
  if (!isDesktopHost()) return <p className="text-[12px] text-ink-muted">{t("health.devices.desktopOnly")}</p>;
  if (status.data && !status.data.licensed) return <p className="text-[12px] text-ink-muted">{t("health.devices.notLicensed")}</p>;
  const rows = sessions.data?.sessions ?? [];
  const now = Date.now();
  return (
    <div className="flex flex-col gap-[8px]">
      {status.data ? (
        <p className="text-[12px] text-ink-muted">
          {t("health.devices.licensed", { connected: String(status.data.connected), seats: String(status.data.seats) })}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-[12px] text-ink-faint">{t("health.devices.none")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-[12px]">
            <thead className="text-ink-faint">
              <tr>
                <th className="py-[4px] text-start font-semibold">{t("health.devices.col.device")}</th>
                <th className="py-[4px] text-start font-semibold">{t("health.devices.col.version")}</th>
                <th className="py-[4px] text-start font-semibold">{t("health.devices.col.lastSeen")}</th>
                <th className="py-[4px] text-start font-semibold">{t("health.devices.col.connected")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const idle = Math.max(0, Math.floor((now - row.lastSeenAt) / MS_PER_SECOND));
                return (
                  <tr key={row.sessionId} className="border-t border-border">
                    <td className="py-[4px] text-ink">{row.deviceLabel}</td>
                    <td className="mz-num py-[4px] text-ink-muted">{row.appVersion ?? t("health.devices.versionUnknown")}</td>
                    <td className="py-[4px]">
                      <span className="mz-num me-[6px] text-ink-muted">{t("health.devices.secondsAgo", { s: String(idle) })}</span>
                      <LevelPill level={deviceLevel({ idleSeconds: idle })} />
                    </td>
                    <td className="mz-num py-[4px] text-ink-muted">{formatDateTime(new Date(row.connectedAt).toISOString(), { locale })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function devicesLevel(rows: readonly { lastSeenAt: number }[] | undefined, now: number): HealthLevel {
  if (!rows) return HealthLevel.Unknown;
  return worstLevel(rows.map((row) => deviceLevel({ idleSeconds: Math.max(0, Math.floor((now - row.lastSeenAt) / MS_PER_SECOND)) })));
}

export function HealthConsoleScreen() {
  const { t, locale } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const { session } = useApi();
  const mayView = useMayViewSystemHealth();
  const health = useSystemHealth();
  const desktop = isDesktopHost();
  const backup = useDesktopBackupHealth();
  const lanStatus = useLanStatus(desktop);
  const lanSessions = useLanSessions(desktop && lanStatus.data?.licensed === true);
  const [now] = useState(() => new Date());

  if (!mayView) {
    return (
      <div className="flex flex-col gap-[16px]">
        <p className="text-[12.5px] text-ink-muted">{t("health.noAccess")}</p>
        <SystemStatusScreen />
      </div>
    );
  }

  const data = health.data;
  const readNow = data ? new Date(data.generatedAt) : now;
  const items: ConsoleItem[] = [];

  if (data) {
    if (data.outbox) {
      items.push({
        key: HealthItemKey.Outbox,
        level: DTO_LEVEL[data.outbox.level],
        body: <OutboxBody health={data.outbox} mayRetry={sessionHolds(session, "admin.settings.edit")} />,
      });
    }
    if (data.eta) items.push({ key: HealthItemKey.Eta, level: DTO_LEVEL[data.eta.level], body: <EtaBody health={data.eta} now={readNow} /> });
    if (data.auditChain) {
      items.push({
        key: HealthItemKey.AuditChain,
        level: DTO_LEVEL[data.auditChain.level],
        body: <AuditBody health={data.auditChain} mayVerify={sessionHolds(session, "audit.logs.view")} />,
      });
    }
    items.push({
      key: HealthItemKey.Licence,
      level: DTO_LEVEL[data.licence.level],
      body: (
        <div className="flex flex-col gap-[4px] text-[12px] text-ink-muted">
          <p>{t("health.licence.state", { state: data.licence.state })}</p>
          <p>
            {data.licence.expiresAt && data.licence.daysLeft !== null
              ? t("health.licence.expires", { days: countPhrase(Math.max(0, data.licence.daysLeft), CountedNoun.Day, ArabicCase.Oblique), date: formatDateTime(data.licence.expiresAt, { locale }) })
              : t("health.licence.noExpiry")}
          </p>
          {!data.licence.canWrite ? <p className="text-danger-ink">{t("health.licence.readOnly")}</p> : null}
        </div>
      ),
    });
    items.push({
      key: HealthItemKey.Seats,
      level: DTO_LEVEL[data.seats.level],
      body: (
        <p className="text-[12px] text-ink-muted">
          {data.seats.licensed > 0
            ? t("health.seats.summary", { users: String(data.seats.activeUsers), licensed: String(data.seats.licensed) })
            : t("health.seats.unknown")}
        </p>
      ),
    });
    items.push({
      key: HealthItemKey.Jobs,
      level: worstLevel(data.jobs.map((job) => DTO_LEVEL[job.level])),
      body: <JobsBody jobs={data.jobs} />,
    });
    items.push({
      key: HealthItemKey.Database,
      level: HealthLevel.Ok,
      body: (
        <div className="flex flex-col gap-[2px] text-[12px] text-ink-muted">
          <p>{t("health.database.summary", { size: formatBytes(data.database.dbBytes) })}</p>
          {data.database.walBytes !== null ? <p>{t("health.database.wal", { size: formatBytes(data.database.walBytes) })}</p> : null}
          <p>{t("health.database.free", { size: formatBytes(data.database.freeListBytes) })}</p>
        </div>
      ),
    });
  }

  if (desktop) {
    items.push({ key: HealthItemKey.Devices, level: devicesLevel(lanSessions.data?.sessions, now.getTime()), body: <DevicesBody /> });
    const reading = backup.data;
    if (reading === undefined || reading === null) {
      items.push({
        key: HealthItemKey.Backup,
        level: HealthLevel.Unknown,
        body: <p className="text-[12px] text-ink-muted">{t("health.backup.unavailable")}</p>,
      });
    } else {
      const backupAge = reading.lastBackupAt ? healthDaysBetween(reading.lastBackupAt, readNow) : null;
      const ageLevel = backupLevel(backupAge);
      const unprotected = reading.recoverySet === false;
      items.push({
        key: HealthItemKey.Backup,
        level: unprotected && ageLevel === HealthLevel.Ok ? HealthLevel.Warn : ageLevel,
        body: (
          <div className="flex flex-col gap-[2px] text-[12px] text-ink-muted">
            <p>
              {reading.lastBackupAt && backupAge !== null
                ? t("health.backup.age", { days: countPhrase(backupAge, CountedNoun.Day, ArabicCase.Oblique), date: formatDateTime(reading.lastBackupAt, { locale }) })
                : t("health.backup.never")}
            </p>
            {unprotected ? <p className="text-warning-ink">{t("backupProtection.health.notSet")}</p> : null}
            {reading.recoverySet && reading.recoverySetAt ? (
              <p>{t("backupProtection.health.set", { date: formatDateTime(reading.recoverySetAt, { locale }) })}</p>
            ) : null}
          </div>
        ),
      });
      const drillAge = reading.lastGoodDrillAt ? healthDaysBetween(reading.lastGoodDrillAt, readNow) : null;
      const verdict = reading.newestDrillOutcome === DRILL_FAILED_OUTCOME ? DrillVerdict.Fail : null;
      items.push({
        key: HealthItemKey.Drill,
        level: drillLevel({ lastGoodAgeDays: drillAge, newestVerdict: verdict }),
        body: (
          <p className="text-[12px] text-ink-muted">
            {verdict === DrillVerdict.Fail
              ? t("health.drill.failed")
              : drillAge !== null
                ? t("health.drill.lastGood", { days: countPhrase(drillAge, CountedNoun.Day, ArabicCase.Oblique) })
                : t("health.drill.never")}
          </p>
        ),
      });
      items.push({
        key: HealthItemKey.Disk,
        level: diskLevel(reading.diskFreeBytes),
        body: <p className="text-[12px] text-ink-muted">{reading.diskFreeBytes === null ? "—" : t("health.disk.free", { size: formatBytes(reading.diskFreeBytes) })}</p>,
      });
    }
  } else if (data) {
    items.push({
      key: HealthItemKey.Backup,
      level: HealthLevel.Ok,
      body: <p className="text-[12px] text-ink-muted">{t("health.backup.cloud")}</p>,
    });
  }

  const overall = items.length === 0 ? HealthLevel.Unknown : worstLevel(items.map((item) => item.level));
  const needsAction = items.filter((item) => item.level === HealthLevel.Warn || item.level === HealthLevel.Critical);

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">{t("health.title")}</h1>
          <p className="mt-[4px] max-w-[68ch] text-[12.5px] text-ink-muted">{t("health.subtitle")}</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            void health.refetch();
            void backup.refetch();
          }}
        >
          {t("health.refresh")}
        </Button>
      </div>

      {health.isError ? (
        <Card className="p-[18px_20px]">
          <p role="alert" className="text-[13px] font-semibold text-danger-ink">{health.error.message}</p>
        </Card>
      ) : (
        <Card className="flex flex-wrap items-center gap-[10px] p-[14px_18px]">
          <StatusPill label={health.isLoading ? t("common.loading") : t(OVERALL_LABEL[overall])} tone={health.isLoading ? "neutral" : LEVEL_TONE[overall]} />
          {data ? <span className="mz-num text-[11.5px] text-ink-faint">{t("health.generatedAt", { time: formatDateTime(data.generatedAt, { locale }) })}</span> : null}
        </Card>
      )}

      {needsAction.length > 0 ? (
        <Card className="p-[16px_18px]">
          <h2 className="font-display text-[14.5px] font-bold text-ink">{t("health.attention")}</h2>
          <ul className="mt-[8px] flex flex-col gap-[6px]">
            {needsAction.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center justify-between gap-[8px]">
                <span className="flex items-center gap-[8px] text-[12.5px] text-ink">
                  <LevelPill level={item.level} />
                  {t(ITEM_LABEL[item.key])}
                </span>
                <Link className="text-[12px] font-semibold text-accent underline" to={pathForRoute(FIX_SCREEN[item.key])}>
                  {t("health.fix")}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-[14px] md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <Card key={item.key} className="p-[16px_18px]">
            <div className="mb-[8px] flex items-center justify-between gap-[8px]">
              <span className="text-[13px] font-bold text-ink">{t(ITEM_LABEL[item.key])}</span>
              <LevelPill level={item.level} />
            </div>
            {item.body}
            {item.level === HealthLevel.Warn || item.level === HealthLevel.Critical ? (
              <Link className="mt-[8px] inline-block text-[12px] font-semibold text-accent underline" to={pathForRoute(FIX_SCREEN[item.key])}>
                {t("health.fix")}
              </Link>
            ) : null}
          </Card>
        ))}
      </div>

      {data?.clientErrors ? <ClientErrorsCard errors={data.clientErrors} /> : null}

      {data && data.withheld.length > 0 ? (
        <p className="text-[11.5px] text-ink-faint">
          {t("health.withheld")}: {data.withheld.map((section: HealthSectionDTO) => section).join("، ")}
        </p>
      ) : null}

      <section aria-label={t("health.services")} className="flex flex-col gap-[8px]">
        <SystemStatusScreen nested />
        <MaintenancePanel />
      </section>
    </div>
  );
}
