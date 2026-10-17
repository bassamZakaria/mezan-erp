import { useCallback } from "react";
import { Button, Card, StatusPill, useFormat } from "@mezan/ui";
import { DrainOutcomeKind } from "@mezan/domain";
import { useDrainNotificationOutbox, useMayManageNotificationOutbox, useNotificationOutbox, type NotificationOutboxDTO } from "../data/notification-outbox-hooks";
import { errorMessage } from "../lib/error-message";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

const OUTCOME_LABEL: Readonly<Record<DrainOutcomeKind, AppTranslationKey>> = {
  [DrainOutcomeKind.Sent]: "notifOutbox.outcome.sent",
  [DrainOutcomeKind.Failed]: "notifOutbox.outcome.failed",
  [DrainOutcomeKind.StillQueued]: "notifOutbox.outcome.stillQueued",
};

const OUTCOME_TONE: Readonly<Record<DrainOutcomeKind, "success" | "danger" | "warning">> = {
  [DrainOutcomeKind.Sent]: "success",
  [DrainOutcomeKind.Failed]: "danger",
  [DrainOutcomeKind.StillQueued]: "warning",
};

const NOTHING_WAITING: AppTranslationKey = "notifOutbox.nothingWaiting";

function whyNothingCanBeSent(state: NotificationOutboxDTO): AppTranslationKey | null {
  if (!state.transportAvailable) return "notifOutbox.noTransport";
  if (!state.mailConfigured) return "notifOutbox.mailNotConfigured";
  if (state.queued === 0) return NOTHING_WAITING;
  return null;
}

export function NotificationOutboxCard() {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const mayManage = useMayManageNotificationOutbox();
  const outbox = useNotificationOutbox();
  const drain = useDrainNotificationOutbox();
  const { mutate, isPending } = drain;

  const send = useCallback(() => {
    if (isPending) return;
    mutate();
  }, [isPending, mutate]);

  if (!mayManage) return null;

  const state = outbox.data ?? null;
  const blocked = state === null ? null : whyNothingCanBeSent(state);
  const result = drain.data ?? null;

  return (
    <Card className="mt-[18px] p-[16px_18px]">
      <div className="flex flex-wrap items-start justify-between gap-[12px]">
        <div>
          <h2 className="font-display text-[15px] font-bold text-ink">{t("notifOutbox.title")}</h2>
          <p className="mt-[4px] max-w-[72ch] text-[12.5px] text-ink-muted">{t("notifOutbox.subtitle")}</p>
        </div>
        <Button variant="primary" disabled={state === null || blocked !== null || isPending} onClick={send}>
          {isPending ? t("notifOutbox.sending") : t("notifOutbox.sendNow")}
        </Button>
      </div>

      {outbox.isLoading ? (
        <p className="mt-[12px] text-[12.5px] text-ink-muted">{t("common.loading")}</p>
      ) : outbox.error ? (
        <p role="alert" className="mt-[12px] text-[12.5px] text-danger-ink">
          {outbox.error.message}
        </p>
      ) : state ? (
        <>
          <div className="mt-[14px] grid grid-cols-2 gap-[12px]">
            <div className="rounded-lg border border-border bg-surface p-[12px_14px]">
              <div className="text-[11px] font-semibold text-ink-faint">{t("notifOutbox.waiting")}</div>
              <div data-testid="outbox-queued" className="mz-num mt-[6px] text-[15px] font-bold text-ink">
                {fmt.number(state.queued)}
                {state.queuedIsCapped ? "+" : ""}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-[12px_14px]">
              <div className="text-[11px] font-semibold text-ink-faint">{t("notifOutbox.oldest")}</div>
              <div data-testid="outbox-oldest" className="mt-[6px] text-[15px] font-bold tabular-nums text-ink">
                {state.oldestQueuedAt ? fmt.dateTime(state.oldestQueuedAt) : "—"}
              </div>
            </div>
          </div>
          {blocked ? (
            <div
              className={
                blocked === NOTHING_WAITING
                  ? "mt-[10px] text-[12.5px] text-ink-muted"
                  : "mt-[10px] rounded-md border border-warning bg-warning-soft px-[12px] py-[9px] text-[12.5px] text-warning-ink"
              }
            >
              {t(blocked)}
            </div>
          ) : null}
        </>
      ) : null}

      {drain.error ? (
        <div role="alert" className="mt-[12px] rounded-md border border-danger bg-danger-soft px-[12px] py-[9px] text-[12.5px] text-danger-ink">
          {errorMessage(drain.error, t("notifOutbox.sendFailed"))}
        </div>
      ) : null}

      {result ? (
        <div className="mt-[14px]">
          <p className="text-[12.5px] font-semibold text-ink">
            {t("notifOutbox.resultSummary", {
              sent: fmt.number(result.sent),
              failed: fmt.number(result.failed),
              stillQueued: fmt.number(result.stillQueued),
            })}
          </p>
          {result.outcomes.length > 0 ? (
            <div className="mt-[10px] overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
                <thead className="bg-surface-2 text-[11px] font-semibold text-ink-faint">
                  <tr>
                    <th className="px-[13px] py-[8px] text-start">{t("notifOutbox.col.message")}</th>
                    <th className="px-[13px] py-[8px] text-start">{t("notifOutbox.col.recipient")}</th>
                    <th className="px-[13px] py-[8px] text-start">{t("notifOutbox.col.outcome")}</th>
                    <th className="px-[13px] py-[8px] text-start">{t("notifOutbox.col.reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.outcomes.map((outcome) => (
                    <tr key={`${outcome.notificationId}/${outcome.channel}`} className="border-t border-border align-top">
                      <td className="px-[13px] py-[9px] text-ink">{outcome.title}</td>
                      <td className="px-[13px] py-[9px]">
                        <bdi>{outcome.recipient ?? "—"}</bdi>
                      </td>
                      <td className="px-[13px] py-[9px]">
                        <StatusPill label={t(OUTCOME_LABEL[outcome.outcome])} tone={OUTCOME_TONE[outcome.outcome]} />
                      </td>
                      <td className="px-[13px] py-[9px] text-ink-muted">{outcome.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
