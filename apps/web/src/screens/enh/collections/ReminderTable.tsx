import { useState } from "react";
import { Button, Money, StatusPill, useFormat, type PillTone } from "@mezan/ui";
import { DunningChannelDTO, DunningReminderStatusDTO, StatementChannelDTO, type DunningReminderDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { errorMessage } from "../../../lib/error-message";
import { useDismissReminder, useSendCustomerReminders, useSendReminder } from "./hooks";

const STATUS_TONE: Record<DunningReminderStatusDTO, PillTone> = {
  [DunningReminderStatusDTO.Prepared]: "info",
  [DunningReminderStatusDTO.Queued]: "warning",
  [DunningReminderStatusDTO.Sent]: "success",
  [DunningReminderStatusDTO.Failed]: "danger",
  [DunningReminderStatusDTO.Dismissed]: "neutral",
  [DunningReminderStatusDTO.Voided]: "neutral",
};

const ACTIONABLE = new Set<DunningReminderStatusDTO>([DunningReminderStatusDTO.Prepared, DunningReminderStatusDTO.Failed]);

export interface ReminderTableProps {
  readonly reminders: readonly DunningReminderDTO[];
  readonly showCustomer: boolean;
  readonly mayAct: boolean;
}

function groupByCustomer(reminders: readonly DunningReminderDTO[]): [string, DunningReminderDTO[]][] {
  const groups = new Map<string, DunningReminderDTO[]>();
  for (const reminder of reminders) {
    const list = groups.get(reminder.customerId) ?? [];
    list.push(reminder);
    groups.set(reminder.customerId, list);
  }
  return [...groups];
}

export function ReminderTable({ reminders, showCustomer, mayAct }: ReminderTableProps) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const send = useSendReminder();
  const dismiss = useDismissReminder();
  const together = useSendCustomerReminders();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  function act(id: string, run: (settled: () => void) => void) {
    if (pendingId !== null) return;
    setPendingId(id);
    setError(null);
    setNotice(null);
    setLink(null);
    run(() => setPendingId((current) => (current === id ? null : current)));
  }

  function sendReminder(reminder: DunningReminderDTO) {
    act(reminder.id, (settled) =>
      send.mutate({ id: reminder.id }, { onError: (err) => setError(errorMessage(err, t("collections.reminders.sendFailed"))), onSettled: settled }),
    );
  }

  function dismissReminder(reminder: DunningReminderDTO) {
    act(reminder.id, (settled) =>
      dismiss.mutate({ id: reminder.id }, { onError: (err) => setError(errorMessage(err, t("collections.reminders.dismissFailed"))), onSettled: settled }),
    );
  }

  function sendTogether(customerId: string, channel: StatementChannelDTO) {
    act(`${customerId}:${channel}`, (settled) =>
      together.mutate(
        { customerId, channel },
        {
          onSuccess: (result) => {
            if (result.whatsappLink) setLink(result.whatsappLink);
            else setNotice(t("collections.reminders.togetherQueued"));
          },
          onError: (err) => setError(errorMessage(err, t("collections.reminders.sendFailed"))),
          onSettled: settled,
        },
      ),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div role="alert" className="rounded-lg border border-danger bg-danger-soft p-3 text-[13px] text-danger-ink">
          {error}
        </div>
      ) : null}
      {notice ? <div className="text-[12.5px] text-ink-muted">{notice}</div> : null}
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-semibold text-brand underline">
          {t("collections.reminders.togetherOpenWhatsApp")}
        </a>
      ) : null}
      {groupByCustomer(reminders).map(([customerId, group]) => {
        const actionable = group.filter((reminder) => mayAct && ACTIONABLE.has(reminder.status));
        const emails = actionable.filter((reminder) => reminder.channel === DunningChannelDTO.Email);
        const whatsapps = actionable.filter((reminder) => reminder.channel === DunningChannelDTO.WhatsApp);
        return (
          <div key={customerId} className="flex flex-col gap-2">
            {showCustomer || emails.length > 1 || whatsapps.length > 1 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                {showCustomer ? <div className="text-[13px] font-semibold text-ink">{t("collections.reminders.together", { name: group[0]?.customerName ?? customerId, count: group.length })}</div> : <div />}
                <div className="flex flex-wrap gap-2">
                  {emails.length > 1 ? (
                    <Button size="sm" disabled={pendingId !== null} onClick={() => sendTogether(customerId, StatementChannelDTO.Email)}>
                      {t("collections.reminders.togetherEmail")} ({emails.length})
                    </Button>
                  ) : null}
                  {whatsapps.length > 1 ? (
                    <Button size="sm" disabled={pendingId !== null} onClick={() => sendTogether(customerId, StatementChannelDTO.WhatsApp)}>
                      {t("collections.reminders.togetherWhatsApp")} ({whatsapps.length})
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11.5px] font-semibold text-ink-faint">
                    <th className="p-2 text-start">{t("collections.reminders.document")}</th>
                    <th className="p-2 text-start">{t("collections.reminders.step")}</th>
                    <th className="p-2 text-start">{t("collections.reminders.channel")}</th>
                    <th className="p-2 text-start">{t("collections.reminders.amount")}</th>
                    <th className="p-2 text-start">{t("collections.reminders.daysOverdue")}</th>
                    <th className="p-2 text-start">{t("collections.reminders.status")}</th>
                    <th className="p-2 text-start" />
                  </tr>
                </thead>
                <tbody>
                  {group.map((reminder) => {
                    const busy = pendingId === reminder.id;
                    const canAct = mayAct && ACTIONABLE.has(reminder.status);
                    return (
                      <tr key={reminder.id} className="border-b border-border align-top">
                        <td className="p-2">
                          <div className="mz-num">{reminder.reference ?? t("collections.worklist.kind.receivable_other")}</div>
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[11.5px] text-ink-faint">{t("collections.reminders.preview")}</summary>
                            <div className="mt-1 max-w-[420px] whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-2 text-[12px] text-ink">
                              <div className="font-semibold">{reminder.subject}</div>
                              {reminder.body}
                            </div>
                          </details>
                        </td>
                        <td className="p-2 mz-num">{reminder.stepLevel}</td>
                        <td className="p-2">{t(`collections.channel.${reminder.channel}` as AppTranslationKey)}</td>
                        <td className="p-2">
                          <Money value={reminder.amount} />
                        </td>
                        <td className="p-2 mz-num">{reminder.daysOverdue}</td>
                        <td className="p-2">
                          <StatusPill label={t(`collections.reminders.status.${reminder.status}` as AppTranslationKey)} tone={STATUS_TONE[reminder.status]} />
                          {reminder.sentAt && reminder.status === DunningReminderStatusDTO.Sent ? (
                            <div className="mt-1 text-[11px] text-ink-faint">{t("collections.reminders.sentAt", { date: fmt.date(reminder.sentAt) })}</div>
                          ) : null}
                          {reminder.failureReason ? (
                            <div className="mt-1 text-[11px] text-danger-ink">{t("collections.reminders.failureReason", { reason: reminder.failureReason })}</div>
                          ) : null}
                        </td>
                        <td className="p-2">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {reminder.channel === DunningChannelDTO.Sms && canAct ? (
                              <Button size="sm" disabled aria-disabled title={t("collections.reminders.smsDisabled")}>
                                {t("collections.reminders.send")}
                              </Button>
                            ) : null}
                            {reminder.channel === DunningChannelDTO.Email && canAct ? (
                              <Button size="sm" variant="primary" disabled={busy} onClick={() => sendReminder(reminder)}>
                                {t("collections.reminders.sendEmail")}
                              </Button>
                            ) : null}
                            {reminder.channel === DunningChannelDTO.WhatsApp && canAct && reminder.whatsappLink ? (
                              <a
                                href={reminder.whatsappLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-disabled={busy}
                                className="inline-flex min-h-[44px] items-center rounded-md border border-brand bg-brand px-[11px] text-xs font-semibold text-brand-ink shadow-1 hover:bg-brand-strong"
                                onClick={() => sendReminder(reminder)}
                              >
                                {t("collections.reminders.openWhatsApp")}
                              </a>
                            ) : null}
                            {reminder.channel === DunningChannelDTO.Call && canAct ? (
                              <Button size="sm" variant="primary" disabled={busy} onClick={() => sendReminder(reminder)}>
                                {t("collections.reminders.logCall")}
                              </Button>
                            ) : null}
                            {canAct ? (
                              <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismissReminder(reminder)}>
                                {t("collections.reminders.dismiss")}
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
