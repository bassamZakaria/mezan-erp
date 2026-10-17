import { useMemo, useState } from "react";
import { Button, Card, Checkbox, ConfirmDialog, EmptyState, Switch, TextInput, useFormat } from "@mezan/ui";
import type { IntegrationsCatalogDTO, WebhookDTO, WebhookEventOptionDTO } from "@mezan/contracts";
import { Field } from "../../../settings/form-controls";
import { useAppTranslation } from "../../../i18n";
import { errorMessage } from "../../../lib/error-message";
import { eventLabel } from "../../../domain-labels";
import { useCreateWebhook, useRotateWebhookSecret, useTestWebhook, useUpdateWebhook, useWebhooks } from "./hooks";
import { ErrorNotice, OneTimeSecret } from "./OneTimeSecret";

function groupedEvents(events: readonly WebhookEventOptionDTO[]): [string, WebhookEventOptionDTO[]][] {
  const groups = new Map<string, WebhookEventOptionDTO[]>();
  for (const event of events) groups.set(event.category, [...(groups.get(event.category) ?? []), event]);
  return [...groups.entries()];
}

function CreateWebhookForm({ catalog, onCreated, onCancel }: { catalog: IntegrationsCatalogDTO; onCreated: (secret: string) => void; onCancel: () => void }) {
  const { t } = useAppTranslation();
  const create = useCreateWebhook();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("https://");
  const [events, setEvents] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => groupedEvents(catalog.events), [catalog.events]);

  function toggle(code: string, on: boolean) {
    setEvents((current) => {
      const next = new Set(current);
      if (on) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  function submit() {
    if (create.isPending) return;
    if (name.trim() === "" || !url.trim().startsWith("https://") || events.size === 0) {
      setError(t("integrations.webhooks.required"));
      return;
    }
    setError(null);
    create.mutate(
      { name: name.trim(), url: url.trim(), events: [...events] },
      { onSuccess: (created) => onCreated(created.signingSecret), onError: (err) => setError(errorMessage(err, t("integrations.webhooks.saveFailed"))) },
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-[16px_18px]">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={t("integrations.webhooks.name")}>
          <TextInput value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t("integrations.webhooks.url")}>
          <TextInput dir="ltr" type="url" value={url} onChange={(event) => setUrl(event.target.value)} />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[12.5px] font-semibold text-ink">{t("integrations.webhooks.events")}</legend>
        {groups.map(([category, options]) => (
          <div key={category} className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {options.map((option) => (
              <Checkbox
                key={option.code}
                checked={events.has(option.code)}
                onChange={(event) => toggle(option.code, event.target.checked)}
                label={eventLabel(option, t)}
                hint={<span dir="ltr" className="font-mono">{option.code}</span>}
              />
            ))}
          </div>
        ))}
      </fieldset>
      <ErrorNotice message={error} />
      <div className="flex gap-2">
        <Button variant="primary" disabled={create.isPending} onClick={submit}>
          {create.isPending ? t("integrations.webhooks.saving") : t("integrations.webhooks.create")}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t("integrations.cancel")}
        </Button>
      </div>
    </Card>
  );
}

export function WebhooksTab({ catalog, mayManage }: { catalog: IntegrationsCatalogDTO; mayManage: boolean }) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const webhooks = useWebhooks();
  const update = useUpdateWebhook();
  const rotate = useRotateWebhookSecret();
  const test = useTestWebhook();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [rotating, setRotating] = useState<WebhookDTO | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function act(id: string, run: (done: { onError: (err: unknown) => void; onSettled: () => void }) => void, fallback: string) {
    if (pendingId !== null) return;
    setPendingId(id);
    setError(null);
    setNotice(null);
    run({ onError: (err) => setError(errorMessage(err, fallback)), onSettled: () => setPendingId(null) });
  }

  function setActive(webhook: WebhookDTO, active: boolean) {
    act(webhook.id, (done) => update.mutate({ id: webhook.id, patch: { active } }, done), t("integrations.webhooks.saveFailed"));
  }

  function sendTest(webhook: WebhookDTO) {
    act(
      webhook.id,
      (done) => test.mutate(webhook.id, { ...done, onSuccess: () => setNotice(t("integrations.webhooks.testQueued")) }),
      t("integrations.webhooks.testFailed"),
    );
  }

  function confirmRotate() {
    const webhook = rotating;
    setRotating(null);
    if (!webhook) return;
    act(webhook.id, (done) => rotate.mutate(webhook.id, { ...done, onSuccess: (renewed) => setSecret(renewed.signingSecret) }), t("integrations.webhooks.rotateFailed"));
  }

  if (webhooks.isLoading) return <Card className="p-[18px_20px] text-[13px] text-ink-muted">{t("common.loading")}</Card>;
  if (webhooks.isError || !webhooks.data) {
    return (
      <Card className="p-[18px_20px] text-[13px] text-danger-ink" role="alert">
        {webhooks.error?.message ?? t("integrations.loadFailed")}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-ink-muted">{t("integrations.webhooks.hint", { attempts: catalog.maxDeliveryAttempts })}</p>
      {secret ? (
        <OneTimeSecret
          title={t("integrations.webhooks.secretTitle")}
          body={t("integrations.webhooks.secretBody", { header: catalog.signatureHeader })}
          secret={secret}
          onDone={() => setSecret(null)}
        />
      ) : null}
      {mayManage && !creating && !secret ? (
        <div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t("integrations.webhooks.add")}
          </Button>
        </div>
      ) : null}
      {creating ? (
        <CreateWebhookForm
          catalog={catalog}
          onCancel={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setSecret(created);
          }}
        />
      ) : null}
      <ErrorNotice message={error} />
      {notice ? (
        <div role="status" className="rounded-lg border border-border bg-surface-2 p-3 text-[13px] text-ink">
          {notice}
        </div>
      ) : null}
      {webhooks.data.length === 0 ? (
        <EmptyState title={t("integrations.webhooks.empty")} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11.5px] font-semibold text-ink-faint">
                <th className="p-3 text-start">{t("integrations.webhooks.col.name")}</th>
                <th className="p-3 text-start">{t("integrations.webhooks.col.events")}</th>
                <th className="p-3 text-start">{t("integrations.webhooks.col.active")}</th>
                <th className="p-3 text-start">{t("integrations.webhooks.col.pending")}</th>
                <th className="p-3 text-start">{t("integrations.webhooks.col.dead")}</th>
                <th className="p-3 text-start">{t("integrations.webhooks.col.lastDelivered")}</th>
                <th className="p-3 text-start" />
              </tr>
            </thead>
            <tbody>
              {webhooks.data.map((webhook) => (
                <tr key={webhook.id} className="border-b border-border align-top">
                  <td className="p-3">
                    <div className="font-semibold text-ink">{webhook.name}</div>
                    <div dir="ltr" className="break-all text-start font-mono text-[11.5px] text-ink-faint">
                      {webhook.url}
                    </div>
                  </td>
                  <td className="p-3" title={webhook.events.join("\n")}>
                    {t("integrations.webhooks.eventsCount", { count: webhook.events.length })}
                  </td>
                  <td className="p-3">
                    <Switch
                      checked={webhook.active}
                      disabled={!mayManage || pendingId === webhook.id}
                      onChange={(active) => setActive(webhook, active)}
                      label={t("integrations.webhooks.toggle", { name: webhook.name })}
                    />
                  </td>
                  <td className="p-3 mz-num">{fmt.number(webhook.pending)}</td>
                  <td className={webhook.deadLetters > 0 ? "p-3 font-semibold text-danger-ink mz-num" : "p-3 mz-num"}>{fmt.number(webhook.deadLetters)}</td>
                  <td className="p-3 mz-num">{webhook.lastDeliveredAt ? fmt.dateTime(webhook.lastDeliveredAt) : t("integrations.none")}</td>
                  <td className="p-3">
                    {mayManage ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="ghost" disabled={pendingId === webhook.id || !webhook.active} onClick={() => sendTest(webhook)}>
                          {t("integrations.webhooks.test")}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={pendingId === webhook.id} onClick={() => setRotating(webhook)}>
                          {t("integrations.webhooks.rotate")}
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <ConfirmDialog
        open={rotating !== null}
        tone="danger"
        title={t("integrations.webhooks.rotateTitle", { name: rotating?.name ?? "" })}
        consequence={t("integrations.webhooks.rotateConsequence")}
        confirmLabel={t("integrations.webhooks.rotate")}
        cancelLabel={t("integrations.cancel")}
        onConfirm={confirmRotate}
        onCancel={() => setRotating(null)}
      />
    </div>
  );
}
