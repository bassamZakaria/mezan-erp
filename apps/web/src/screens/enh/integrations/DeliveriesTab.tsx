import { useState } from "react";
import { Button, Card, EmptyState, Select, StatusPill, useFormat, type PillTone } from "@mezan/ui";
import { WEBHOOK_TEST_EVENT, WebhookDeliveryStatusDTO, type WebhookDeliveryDTO } from "@mezan/contracts";
import { Field } from "../../../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { errorMessage } from "../../../lib/error-message";
import { eventLabelByCode } from "../../../domain-labels";
import { useDeliveries, useRedeliver, useWebhooks } from "./hooks";
import { ErrorNotice } from "./OneTimeSecret";

const ALL = "";

const STATUS_TONE: Readonly<Record<WebhookDeliveryStatusDTO, PillTone>> = {
  [WebhookDeliveryStatusDTO.Pending]: "info",
  [WebhookDeliveryStatusDTO.Delivered]: "success",
  [WebhookDeliveryStatusDTO.DeadLetter]: "danger",
  [WebhookDeliveryStatusDTO.Skipped]: "warning",
};

function statusLabelKey(status: WebhookDeliveryStatusDTO): AppTranslationKey {
  return `integrations.deliveries.status.${status}` as AppTranslationKey;
}

function prettyPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

export function DeliveriesTab({ mayManage }: { mayManage: boolean }) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const [webhookId, setWebhookId] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const webhooks = useWebhooks();
  const deliveries = useDeliveries({ webhookId: webhookId === ALL ? null : webhookId, status: status === ALL ? null : (status as WebhookDeliveryStatusDTO) });
  const redeliver = useRedeliver();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const webhookOptions = [{ value: ALL, label: t("integrations.deliveries.allWebhooks") }, ...(webhooks.data ?? []).map((w) => ({ value: w.id, label: w.name }))];
  const statusOptions = [
    { value: ALL, label: t("integrations.deliveries.allStatuses") },
    ...Object.values(WebhookDeliveryStatusDTO).map((value) => ({ value, label: t(statusLabelKey(value)) })),
  ];

  function resend(delivery: WebhookDeliveryDTO) {
    if (pendingId !== null) return;
    setPendingId(delivery.id);
    setError(null);
    redeliver.mutate(delivery.id, {
      onError: (err) => setError(errorMessage(err, t("integrations.deliveries.redeliverFailed"))),
      onSettled: () => setPendingId(null),
    });
  }

  function eventName(code: string): string {
    return code === WEBHOOK_TEST_EVENT ? t("integrations.webhooks.test") : (eventLabelByCode(code, t) ?? code);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-ink-muted">{t("integrations.deliveries.hint")}</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label={t("integrations.deliveries.webhook")}>
          <Select value={webhookId} onChange={setWebhookId} options={webhookOptions} aria-label={t("integrations.deliveries.webhook")} />
        </Field>
        <Field label={t("integrations.deliveries.status")}>
          <Select value={status} onChange={setStatus} options={statusOptions} aria-label={t("integrations.deliveries.status")} />
        </Field>
      </div>
      <ErrorNotice message={error} />
      {deliveries.isLoading ? (
        <Card className="p-[18px_20px] text-[13px] text-ink-muted">{t("common.loading")}</Card>
      ) : deliveries.isError || !deliveries.data ? (
        <Card className="p-[18px_20px] text-[13px] text-danger-ink" role="alert">
          {deliveries.error?.message ?? t("integrations.loadFailed")}
        </Card>
      ) : deliveries.data.length === 0 ? (
        <EmptyState title={t("integrations.deliveries.empty")} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11.5px] font-semibold text-ink-faint">
                <th className="p-3 text-start">{t("integrations.deliveries.col.createdAt")}</th>
                <th className="p-3 text-start">{t("integrations.deliveries.webhook")}</th>
                <th className="p-3 text-start">{t("integrations.deliveries.col.event")}</th>
                <th className="p-3 text-start">{t("integrations.deliveries.status")}</th>
                <th className="p-3 text-start">{t("integrations.deliveries.col.attempts")}</th>
                <th className="p-3 text-start">{t("integrations.deliveries.col.response")}</th>
                <th className="p-3 text-start">{t("integrations.deliveries.col.next")}</th>
                <th className="p-3 text-start" />
              </tr>
            </thead>
            <tbody>
              {deliveries.data.map((delivery) => (
                <tr key={delivery.id} className="border-b border-border align-top">
                  <td className="p-3 mz-num">{fmt.dateTime(delivery.createdAt)}</td>
                  <td className="p-3">{delivery.webhookName ?? delivery.webhookId}</td>
                  <td className="p-3">
                    <div>{eventName(delivery.eventCode)}</div>
                    {delivery.redeliveryOf ? <div className="text-[11.5px] text-ink-faint">{t("integrations.deliveries.redeliveryOf")}</div> : null}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11.5px] text-ink-muted">{t("integrations.deliveries.payload")}</summary>
                      <pre dir="ltr" className="mt-1 max-h-[240px] max-w-[420px] overflow-auto rounded-md bg-surface-2 p-2 text-start font-mono text-[11px] text-ink">
                        {prettyPayload(delivery.payload)}
                      </pre>
                    </details>
                  </td>
                  <td className="p-3">
                    <StatusPill label={t(statusLabelKey(delivery.status))} tone={STATUS_TONE[delivery.status]} />
                  </td>
                  <td className="p-3 mz-num">
                    {fmt.number(delivery.attempts)} / {fmt.number(delivery.maxAttempts)}
                  </td>
                  <td className="p-3">
                    {delivery.lastStatusCode !== null ? <div className="mz-num">HTTP {delivery.lastStatusCode}</div> : null}
                    {delivery.lastError ? <div className="max-w-[260px] break-words text-[11.5px] text-danger-ink">{delivery.lastError}</div> : null}
                    {delivery.lastStatusCode === null && !delivery.lastError ? t("integrations.none") : null}
                  </td>
                  <td className="p-3 mz-num">
                    {delivery.status === WebhookDeliveryStatusDTO.Pending && delivery.nextAttemptAt ? fmt.dateTime(delivery.nextAttemptAt) : t("integrations.none")}
                  </td>
                  <td className="p-3">
                    {mayManage && delivery.status !== WebhookDeliveryStatusDTO.Pending ? (
                      <div className="flex justify-end">
                        <Button size="sm" variant="ghost" disabled={pendingId === delivery.id} onClick={() => resend(delivery)}>
                          {t("integrations.deliveries.redeliver")}
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
    </div>
  );
}
