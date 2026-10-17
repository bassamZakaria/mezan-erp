import { useState } from "react";
import { Button, Card, Money, Select, TextArea, TextInput, useFormat } from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import { CollectionActivityKindDTO, StatementChannelDTO, type CustomerCollectionsDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { errorMessage } from "../../../lib/error-message";
import { Field } from "../../../settings/form-controls";
import { PromiseForm } from "./PromiseForm";
import { PromiseTable } from "./PromiseTable";
import { ReminderTable } from "./ReminderTable";
import { WorkItems } from "./WorklistTab";
import { useAddCollectionNote, useCustomerCollections, useLiftCollectionHold, useSendStatement, useSetCollectionHold } from "./hooks";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-[14px_16px]">
      <div className="text-[13.5px] font-semibold text-ink">{title}</div>
      {children}
    </Card>
  );
}

function NoteForm({ customerId }: { customerId: string }) {
  const { t } = useAppTranslation();
  const add = useAddCollectionNote();
  const [kind, setKind] = useState<CollectionActivityKindDTO.Note | CollectionActivityKindDTO.Call>(CollectionActivityKindDTO.Note);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (add.isPending || text.trim() === "") return;
    setError(null);
    add.mutate(
      { customerId, kind, text },
      { onSuccess: () => setText(""), onError: (err) => setError(errorMessage(err, t("collections.notes.saveFailed"))) },
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
        <Field label={t("collections.notes.kind")} htmlFor={`note-kind-${customerId}`}>
          <Select
            id={`note-kind-${customerId}`}
            value={kind}
            onChange={(value) => setKind(value as typeof kind)}
            options={[
              { value: CollectionActivityKindDTO.Note, label: t("collections.notes.kind.note") },
              { value: CollectionActivityKindDTO.Call, label: t("collections.notes.kind.call") },
            ]}
          />
        </Field>
        <Field label={t("collections.notes.text")} htmlFor={`note-text-${customerId}`}>
          <TextArea id={`note-text-${customerId}`} rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
      {error ? (
        <div role="alert" className="text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <div>
        <Button type="submit" size="sm" disabled={add.isPending || text.trim() === ""}>
          {t("collections.notes.save")}
        </Button>
      </div>
    </form>
  );
}

function HoldControl({ customerId, hold, mayEdit }: { customerId: string; hold: CustomerCollectionsDTO["hold"]; mayEdit: boolean }) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const set = useSetCollectionHold();
  const lift = useLiftCollectionHold();
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = set.isPending || lift.isPending;

  if (hold) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-[12.5px] text-warning-ink">
          {t("collections.hold.active", { reason: hold.reason })}
          {hold.until ? ` — ${fmt.date(hold.until)}` : ""}
        </div>
        {mayEdit ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              if (busy) return;
              setError(null);
              lift.mutate({ customerId }, { onError: (err) => setError(errorMessage(err, t("collections.hold.liftFailed"))) });
            }}
          >
            {t("collections.hold.lift")}
          </Button>
        ) : null}
        {error ? <div role="alert" className="text-[12.5px] text-danger-ink">{error}</div> : null}
      </div>
    );
  }
  if (!mayEdit) return null;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || reason.trim() === "") return;
        setError(null);
        set.mutate(
          { customerId, reason, until: until === "" ? null : until },
          { onSuccess: () => setReason(""), onError: (err) => setError(errorMessage(err, t("collections.hold.saveFailed"))) },
        );
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("collections.hold.reason")} htmlFor={`hold-reason-${customerId}`}>
          <TextInput id={`hold-reason-${customerId}`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label={t("collections.hold.until")} htmlFor={`hold-until-${customerId}`}>
          <TextInput id={`hold-until-${customerId}`} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
      </div>
      {error ? <div role="alert" className="text-[12.5px] text-danger-ink">{error}</div> : null}
      <div>
        <Button type="submit" size="sm" disabled={busy || reason.trim() === ""}>
          {t("collections.hold.set")}
        </Button>
      </div>
    </form>
  );
}

function StatementControl({ customerId }: { customerId: string }) {
  const { t } = useAppTranslation();
  const send = useSendStatement();
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function start(channel: StatementChannelDTO) {
    if (send.isPending) return;
    setError(null);
    setMessage(null);
    setLink(null);
    send.mutate(
      { customerId, channel },
      {
        onSuccess: (result) => {
          if (result.whatsappLink) setLink(result.whatsappLink);
          else setMessage(t("collections.statement.queued"));
        },
        onError: (err) => setError(errorMessage(err, t("collections.statement.failed"))),
      },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={send.isPending} onClick={() => start(StatementChannelDTO.Email)}>
          {t("collections.statement.sendEmail")}
        </Button>
        <Button size="sm" disabled={send.isPending} onClick={() => start(StatementChannelDTO.WhatsApp)}>
          {t("collections.statement.sendWhatsApp")}
        </Button>
      </div>
      {message ? <div className="text-[12.5px] text-ink-muted">{message}</div> : null}
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-semibold text-brand underline">
          {t("collections.reminders.openWhatsApp")}
        </a>
      ) : null}
      {error ? <div role="alert" className="text-[12.5px] text-danger-ink">{error}</div> : null}
    </div>
  );
}

export function CustomerCollectionsTab({ customerId }: { customerId: string }) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const { session } = useApi();
  const query = useCustomerCollections(customerId);
  const [promiseOpen, setPromiseOpen] = useState(false);
  const auth = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayEdit = can(auth, "sales.collections.edit");
  const maySend = can(auth, "sales.collections.send");

  if (query.isLoading) return <Card className="p-[18px_20px] text-[13px] text-ink-muted">{t("common.loading")}</Card>;
  if (query.isError || !query.data) {
    return (
      <Card className="p-[18px_20px] text-[13px] text-danger-ink" role="alert">
        {query.error?.message ?? t("collections.customer.loadFailed")}
      </Card>
    );
  }
  const data = query.data;

  return (
    <div className="flex flex-col gap-4">
      <Section title={t("collections.customer.items")}>
        {data.row ? (
          <>
            <div className="text-[12.5px] text-ink-muted">
              {t("collections.customer.overdueSummary", { amount: fmt.money(data.row.overdue), days: data.row.oldestDaysOverdue })}
            </div>
            <WorkItems row={data.row} />
          </>
        ) : (
          <div className="text-[12.5px] text-ink-muted">{t("collections.customer.noOverdue")}</div>
        )}
        <HoldControl customerId={customerId} hold={data.hold} mayEdit={mayEdit} />
        {maySend ? <StatementControl customerId={customerId} /> : null}
      </Section>

      <Section title={t("collections.customer.reminders")}>
        {data.reminders.length === 0 ? (
          <div className="text-[12.5px] text-ink-muted">{t("collections.customer.noReminders")}</div>
        ) : (
          <ReminderTable reminders={data.reminders} showCustomer={false} mayAct={maySend} />
        )}
      </Section>

      <Section title={t("collections.customer.promises")}>
        {data.promises.length === 0 ? (
          <div className="text-[12.5px] text-ink-muted">{t("collections.customer.noPromises")}</div>
        ) : (
          <PromiseTable promises={data.promises} showCustomer={false} mayCancel={mayEdit} />
        )}
        {mayEdit && data.row ? (
          promiseOpen ? (
            <PromiseForm customerId={customerId} overdue={data.row.overdue} onDone={() => setPromiseOpen(false)} />
          ) : (
            <div>
              <Button size="sm" onClick={() => setPromiseOpen(true)}>
                {t("collections.promises.new")}
              </Button>
            </div>
          )
        ) : null}
      </Section>

      <Section title={t("collections.customer.activity")}>
        {data.activities.length === 0 ? (
          <div className="text-[12.5px] text-ink-muted">{t("collections.customer.noActivity")}</div>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.activities.map((activity) => (
              <li key={activity.id} className="rounded-lg border border-border bg-surface-2 p-2 text-[12.5px]">
                <div className="text-[11px] text-ink-faint">
                  {t(`collections.notes.kind.${activity.kind}` as AppTranslationKey)} — {fmt.date(activity.createdAt)}
                </div>
                <div className="whitespace-pre-wrap text-ink">{activity.kind === CollectionActivityKindDTO.StatementSent ? t(`collections.channel.${activity.text}` as AppTranslationKey) : activity.text}</div>
              </li>
            ))}
          </ul>
        )}
        {mayEdit ? <NoteForm customerId={customerId} /> : null}
      </Section>
    </div>
  );
}
