import { useState } from "react";
import { Button, Card, EmptyState, Segmented } from "@mezan/ui";
import { DunningReminderStatusDTO, type CollectionsDrainResultDTO } from "@mezan/contracts";
import { useAppTranslation } from "../../../i18n";
import { errorMessage } from "../../../lib/error-message";
import { ReminderTable } from "./ReminderTable";
import { useCollectionsOutbox, useDrainCollectionsOutbox, useReminders } from "./hooks";

enum ReminderFilter {
  Active = "active",
  All = "all",
}

const ACTIVE_STATUSES: readonly string[] = [DunningReminderStatusDTO.Prepared, DunningReminderStatusDTO.Queued, DunningReminderStatusDTO.Failed];

function OutboxCard({ maySend }: { maySend: boolean }) {
  const { t } = useAppTranslation();
  const outbox = useCollectionsOutbox();
  const drain = useDrainCollectionsOutbox();
  const [result, setResult] = useState<CollectionsDrainResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  function send() {
    if (drain.isPending) return;
    setError(null);
    drain.mutate(undefined, {
      onSuccess: setResult,
      onError: (err) => setError(errorMessage(err, t("collections.outbox.drainFailed"))),
    });
  }

  const queued = outbox.data?.queued ?? 0;
  const mailConfigured = outbox.data?.mailConfigured ?? false;
  return (
    <Card className="flex flex-col gap-2 p-[14px_16px]">
      <div className="text-[13px] font-semibold text-ink">{t("collections.outbox.title")}</div>
      {outbox.isError ? <div className="text-[12.5px] text-danger-ink">{outbox.error.message}</div> : null}
      <div className="text-[12.5px] text-ink-muted">{queued > 0 ? t("collections.outbox.queued", { count: queued }) : t("collections.outbox.none")}</div>
      <div className="text-[11.5px] text-ink-faint">{t("collections.outbox.operatorNote")}</div>
      {!mailConfigured && outbox.data ? <div className="text-[12px] text-warning-ink">{t("collections.outbox.mailOff")}</div> : null}
      {result ? (
        <div className="text-[12.5px] text-ink-muted">
          {t("collections.outbox.result", { sent: result.sent, attempted: result.attempted, stillQueued: result.stillQueued, failed: result.failed })}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      {maySend ? (
        <div>
          <Button variant="primary" size="sm" disabled={drain.isPending || queued === 0 || !mailConfigured} onClick={send}>
            {drain.isPending ? t("collections.outbox.draining") : t("collections.outbox.drain")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export function RemindersTab({ maySend }: { maySend: boolean }) {
  const { t } = useAppTranslation();
  const [filter, setFilter] = useState<ReminderFilter>(ReminderFilter.Active);
  const query = useReminders(filter === ReminderFilter.Active ? ACTIVE_STATUSES : []);

  return (
    <div className="flex flex-col gap-4">
      <OutboxCard maySend={maySend} />
      <Segmented
        value={filter}
        onChange={(next) => setFilter(next as ReminderFilter)}
        options={[
          { key: ReminderFilter.Active, label: t("collections.reminders.filterActive") },
          { key: ReminderFilter.All, label: t("collections.reminders.filterAll") },
        ]}
        aria-label={t("collections.reminders.filter")}
      />
      {query.isLoading ? <Card className="p-[18px_20px] text-[13px] text-ink-muted">{t("common.loading")}</Card> : null}
      {query.isError ? (
        <Card className="p-[18px_20px] text-[13px] text-danger-ink" role="alert">
          {query.error.message}
        </Card>
      ) : null}
      {query.data && query.data.length === 0 ? <EmptyState title={t("collections.reminders.empty")} /> : null}
      {query.data && query.data.length > 0 ? (
        <Card className="p-[8px_12px]">
          <ReminderTable reminders={query.data} showCustomer mayAct={maySend} />
        </Card>
      ) : null}
    </div>
  );
}
