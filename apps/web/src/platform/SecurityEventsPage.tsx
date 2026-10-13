import { Button, Card, StatusPill, type PillTone } from "@mezan/ui";
import type { PlatformUnrecordedSecurityEventDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { usePlatformApi } from "./api";
import { useUnrecordedSecurityEventsQuery } from "./hooks";

const ACTION_KEY: Readonly<Record<string, AppTranslationKey>> = {
  CARD_CHECKOUT_OPENED: "platform.security.action.CARD_CHECKOUT_OPENED",
  CARD_CHECKOUT_SWEEP_RUN: "platform.security.action.CARD_CHECKOUT_SWEEP_RUN",
  PLATFORM_LOGIN_FAILED: "platform.security.action.PLATFORM_LOGIN_FAILED",
  PLATFORM_LOGIN_SUCCEEDED: "platform.security.action.PLATFORM_LOGIN_SUCCEEDED",
  PLATFORM_ACCOUNT_LOCKED: "platform.security.action.PLATFORM_ACCOUNT_LOCKED",
};

const SEVERITY_KEY: Readonly<Record<string, AppTranslationKey>> = {
  CRITICAL: "platform.security.severity.CRITICAL",
  WARNING: "platform.security.severity.WARNING",
  INFO: "platform.security.severity.INFO",
};

const SEVERITY_TONE: Readonly<Record<string, PillTone>> = { CRITICAL: "danger", WARNING: "warning", INFO: "neutral" };

const DETAIL_KEY: Readonly<Record<string, AppTranslationKey>> = {
  examined: "platform.security.detail.examined",
  paid: "platform.security.detail.paid",
  declined: "platform.security.detail.declined",
  unapplied: "platform.security.detail.unapplied",
  expired: "platform.security.detail.expired",
  stillPending: "platform.security.detail.stillPending",
  alreadySettled: "platform.security.detail.alreadySettled",
  needsAttention: "platform.security.detail.needsAttention",
  unavailable: "platform.security.detail.unavailable",
  failed: "platform.security.detail.failed",
  deferred: "platform.security.detail.deferred",
  origin: "platform.security.detail.origin",
  checkoutId: "platform.security.detail.checkoutId",
  amount: "platform.security.detail.amount",
  requestedBy: "platform.security.detail.requestedBy",
  email: "platform.security.detail.email",
};

function utcStamp(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

function EventDetails({ details }: { details: PlatformUnrecordedSecurityEventDTO["details"] }) {
  const { t } = useAppTranslation();
  const entries = Object.entries(details ?? {});
  if (entries.length === 0) return <span className="text-ink-faint">—</span>;
  return (
    <ul className="flex flex-col gap-[2px]">
      {entries.map(([key, value]) => {
        const labelKey = DETAIL_KEY[key];
        return (
          <li key={key}>
            {labelKey ? t(labelKey) : <span className="mz-lat">{key}</span>}: <span className="mz-lat" dir="ltr">{String(value)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function EventRow({ event }: { event: PlatformUnrecordedSecurityEventDTO }) {
  const { t } = useAppTranslation();
  const actionKey = ACTION_KEY[event.action];
  const severityKey = SEVERITY_KEY[event.severity];
  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="mz-num p-[8px_10px] whitespace-nowrap" dir="ltr">{utcStamp(event.at)}</td>
      <td className="p-[8px_10px] font-semibold text-ink">{actionKey ? t(actionKey) : <span className="mz-lat">{event.action}</span>}</td>
      <td className="p-[8px_10px]">
        <StatusPill label={severityKey ? t(severityKey) : event.severity} tone={SEVERITY_TONE[event.severity] ?? "neutral"} />
      </td>
      <td className="mz-lat p-[8px_10px]" dir="ltr">{event.actor}</td>
      <td className="mz-lat p-[8px_10px]" dir="ltr">{event.entityId ?? "—"}</td>
      <td className="mz-lat p-[8px_10px]" dir="ltr">{event.reason}</td>
      <td className="p-[8px_10px]"><EventDetails details={event.details} /></td>
    </tr>
  );
}

const COLUMN_KEYS: readonly AppTranslationKey[] = [
  "platform.security.col.at",
  "platform.security.col.action",
  "platform.security.col.severity",
  "platform.security.col.actor",
  "platform.security.col.entity",
  "platform.security.col.reason",
  "platform.security.col.details",
];

export function SecurityEventsPage() {
  const { t } = useAppTranslation();
  const { session } = usePlatformApi();
  const isOwner = session?.user.role === "owner";
  const query = useUnrecordedSecurityEventsQuery();
  const events = query.data;

  return (
    <div className="flex flex-col gap-[14px]">
      <div>
        <h1 className="font-display text-[20px] font-bold text-ink">{t("platform.security.title")}</h1>
        <p className="mt-[4px] max-w-[80ch] text-[12.5px] text-ink-muted">{t("platform.security.description")}</p>
      </div>

      {!isOwner ? (
        <Card className="p-[18px] text-[13px] font-semibold text-ink-muted">{t("platform.security.ownerOnly")}</Card>
      ) : query.isLoading ? (
        <Card className="p-[18px] text-[13px] text-ink-muted">{t("common.loading")}</Card>
      ) : query.isError ? (
        <Card className="flex flex-wrap items-center justify-between gap-[10px] p-[18px]">
          <p role="alert" className="text-[13px] font-semibold text-danger-ink">{query.error.message}</p>
          <Button onClick={() => void query.refetch()}>{t("common.retry")}</Button>
        </Card>
      ) : !events || events.count === 0 ? (
        <Card className="p-[18px] text-[13px] text-ink-muted">{t("platform.security.empty")}</Card>
      ) : (
        <>
          <p className="text-[13px] font-semibold text-ink">{t("platform.security.total", { count: events.count, shown: events.recent.length })}</p>
          <Card className="overflow-auto p-0">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border bg-surface-2">
                  {COLUMN_KEYS.map((key) => (
                    <th key={key} className="p-[8px_10px] text-start font-semibold text-ink-muted">{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.recent.map((event, index) => (
                  <EventRow key={`${event.at}-${event.action}-${index}`} event={event} />
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
