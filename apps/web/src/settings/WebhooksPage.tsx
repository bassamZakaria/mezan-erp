import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DocumentList,
  DocumentDetail,
  Button,
  Card,
  StatusPill,
  SidePanel,
  Chip,
  formatDate,
  type DocumentListColumn,
  type PillTone,
} from "@mezan/ui";
import { EVENT_CATEGORIES, type EventCategory } from "@mezan/domain";
import type { WebhookDTO, CreateWebhookResultDTO, WebhookDeliveryDTO } from "@mezan/contracts";
import { useWebhooks, useCreateWebhook, useUpdateWebhook, useWebhookDeliveries } from "../data/account-hooks";
import { useApi } from "../data/ApiContext";
import { TextField, SectionCard } from "./form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { eventLabel, eventLabelByCode } from "../domain-labels";

/**
 * الويب هوك (`/settings/webhooks`) — register a target URL + subscribed
 * events, enable/disable, and show recent delivery attempts.
 *
 * The event picker offers only what `GET /webhooks/events` reports as
 * DELIVERABLE — the 39-event catalog narrowed to the codes this build really
 * publishes. The server refuses the rest with 422 either way; offering them
 * would sell a subscription that can never fire.
 *
 * The delivery tab reads the real attempts `WebhookDispatcher` recorded — one
 * row per try, so a retried-then-abandoned delivery shows all of its attempts
 * with the failure reason, not just the last one.
 */

interface DeliverableEvent {
  readonly code: string;
  readonly category: EventCategory;
  readonly labelAr: string;
}

function useDeliverableEvents() {
  const { t, locale } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<{ events: DeliverableEvent[]; enforced: boolean }>({
    queryKey: ["webhooks", "events"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/webhooks/events");
      if (!res.ok) throw new Error(t("webhooks.couldNotLoadTheAvailable"));
      return res.json<{ events: DeliverableEvent[]; enforced: boolean }>();
    },
  });
}

const CATEGORY_KEYS: Readonly<Record<EventCategory, AppTranslationKey>> = {
  workflow: "webhooks.workflow",
  sales: "webhooks.sales",
  purchases: "webhooks.purchasing",
  treasury: "webhooks.treasury",
  installments: "webhooks.instalments",
  cheques: "webhooks.cheques",
  pos: "webhooks.pointOfSale",
  inventory: "webhooks.stock",
  manufacturing: "webhooks.manufacturing",
  platform: "webhooks.platform",
};

function EventsChecklist({
  events: available,
  selected,
  onToggle,
}: {
  events: readonly DeliverableEvent[];
  selected: ReadonlySet<string>;
  onToggle: (code: string) => void;
}) {
  const { t, locale } = useAppTranslation();
  if (available.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-[20px] text-center text-[12.5px] text-ink-muted">
        {t("webhooks.noEventsCanBeSent")}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[14px]">
      {EVENT_CATEGORIES.map((category) => {
        const events = available.filter((e) => e.category === category);
        if (events.length === 0) return null;
        return (
          <div key={category}>
            <h4 className="mb-[8px] text-[11px] font-bold uppercase tracking-[0.4px] text-ink-faint">{t(CATEGORY_KEYS[category])}</h4>
            <div className="flex flex-wrap gap-[8px]">
              {events.map((e) => (
                <Chip key={e.code} type="button" active={selected.has(e.code)} onClick={() => onToggle(e.code)}>
                  {eventLabel(e, t)}
                </Chip>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CreatedWebhookBanner({ result, onDismiss }: { result: CreateWebhookResultDTO; onDismiss: () => void }) {
  const { t, locale } = useAppTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="mb-[18px] border-warning bg-warning-soft p-[18px_20px]">
      <p className="text-[13px] font-bold text-warning-ink">
        {t("webhooks.created", { name: result.name })}
      </p>
      <div className="mt-[10px] flex flex-wrap items-center gap-[10px]">
        <code className="mz-lat rounded-md border border-border bg-surface px-[12px] py-[8px] text-[13px] text-ink">{result.secret}</code>
        <Button size="sm" onClick={() => void copy()}>{copied ? t("webhooks.copied") : t("webhooks.copy")}</Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>{t("webhooks.close")}</Button>
      </div>
    </Card>
  );
}

function deliveryStatus(d: WebhookDeliveryDTO): { key: AppTranslationKey; tone: PillTone } {
  return d.success ? { key: "webhooks.succeeded", tone: "success" as PillTone } : { key: "webhooks.failed", tone: "danger" as PillTone };
}

function WebhookDetail({ webhook, onBack }: { webhook: WebhookDTO; onBack: () => void }) {
  const { t, locale } = useAppTranslation();
  const deliveriesQuery = useWebhookDeliveries(webhook.id);
  const deliveries = deliveriesQuery.data ?? [];

  return (
    <DocumentDetail
      title={webhook.name}
      subtitle={webhook.targetUrl}
      statusLabel={webhook.active ? t("webhooks.enabled") : t("webhooks.disabled")}
      statusTone={webhook.active ? "success" : "neutral"}
      actions={<Button onClick={onBack}>{t("webhooks.backToTheList")}</Button>}
      summary={[
        { label: t("webhooks.subscribedEvents"), value: <span className="mz-num">{webhook.events.length}</span> },
        { label: t("webhooks.createdOn"), value: formatDate(webhook.createdAt, { style: "long", locale }) },
      ]}
      tabs={[
        {
          key: "overview",
          label: t("common.overview"),
          content: (
            <SectionCard title={t("webhooks.subscribedEvents")}>
              <div className="col-span-full flex flex-wrap gap-[8px]">
                {webhook.events.map((code) => (
                  <Chip key={code} active>
                    {eventLabelByCode(code, t) ?? code}
                  </Chip>
                ))}
              </div>
            </SectionCard>
          ),
        },
        {
          key: "deliveries",
          label: t("webhooks.deliveryAttempts"),
          content:
            deliveries.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-[24px] text-center text-[12.5px] text-ink-muted">
                {t("webhooks.noDeliveryAttemptsHaveBeen")}
              </div>
            ) : (
              <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[680px] border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border text-ink-muted">
                      <th className="p-[10px] text-start font-semibold">{t("webhooks.event")}</th>
                      <th className="p-[10px] text-start font-semibold">{t("common.status")}</th>
                      <th className="p-[10px] text-start font-semibold">{t("webhooks.responseCode")}</th>
                      <th className="p-[10px] text-start font-semibold">{t("webhooks.details")}</th>
                      <th className="p-[10px] text-end font-semibold">{t("webhooks.attemptedAt")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.map((d) => {
                      const status = deliveryStatus(d);
                      return (
                        <tr key={d.id} className="border-b border-border last:border-b-0">
                          <td className="p-[10px] text-ink">{eventLabelByCode(d.eventCode, t) ?? d.eventCode}</td>
                          <td className="p-[10px]"><StatusPill label={t(status.key)} tone={status.tone} /></td>
                          <td className="mz-num p-[10px] text-ink-muted">{d.statusCode ?? "—"}</td>
                          <td className="mz-lat p-[10px] text-[11.5px] text-ink-muted">{d.errorMessage ?? "—"}</td>
                          <td className="mz-num p-[10px] text-end text-ink-muted">{formatDate(d.attemptedAt, { style: "long", locale })}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            ),
        },
      ]}
    />
  );
}

export function WebhooksPage() {
  const { t, locale } = useAppTranslation();
  const query = useWebhooks();
  const createWebhook = useCreateWebhook();
  const updateWebhook = useUpdateWebhook();
  const webhooks = query.data ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [name, setName] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [createdWebhook, setCreatedWebhook] = useState<CreateWebhookResultDTO | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const deliverableQuery = useDeliverableEvents();
  const deliverableEvents = useMemo(() => deliverableQuery.data?.events ?? [], [deliverableQuery.data]);

  const selected = webhooks.find((w) => w.id === selectedId) ?? null;

  function toggleEvent(code: string) {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function submitNewWebhook() {
    setFormError(null);
    if (name.trim() === "") {
      setFormError(t("webhooks.theWebhookNameIsRequired"));
      return;
    }
    if (targetUrl.trim() === "") {
      setFormError(t("webhooks.theDestinationUrlIsRequired"));
      return;
    }
    if (selectedEvents.size === 0) {
      setFormError(t("webhooks.pickAtLeastOneEvent"));
      return;
    }
    try {
      const result = await createWebhook.mutateAsync({
        name: name.trim(),
        targetUrl: targetUrl.trim(),
        events: Array.from(selectedEvents),
      });
      setPanelOpen(false);
      setName("");
      setTargetUrl("");
      setSelectedEvents(new Set());
      setCreatedWebhook(result);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("webhooks.couldNotCreateTheWebhook"));
    }
  }

  async function handleToggleActive(webhook: WebhookDTO) {
    if (togglingId !== null) return;
    setTogglingId(webhook.id);
    try {
      await updateWebhook.mutateAsync({ id: webhook.id, body: { active: !webhook.active } });
    } finally {
      setTogglingId(null);
    }
  }

  if (selected) {
    return <WebhookDetail webhook={selected} onBack={() => setSelectedId(null)} />;
  }

  const columns: DocumentListColumn<WebhookDTO>[] = [
    { key: "name", header: t("common.name"), render: (w) => <span className="font-semibold text-ink">{w.name}</span> },
    { key: "targetUrl", header: t("webhooks.destinationUrl"), render: (w) => <span className="mz-lat text-[12px] text-ink-muted">{w.targetUrl}</span> },
    { key: "events", header: t("webhooks.events"), render: (w) => <span className="mz-num">{w.events.length}</span> },
    { key: "createdAt", header: t("webhooks.createdOn"), render: (w) => formatDate(w.createdAt, { style: "long", locale }) },
    {
      key: "active",
      header: t("common.status"),
      render: (w) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); void handleToggleActive(w); }} disabled={togglingId === w.id}>
          <StatusPill label={togglingId === w.id ? "…" : w.active ? t("webhooks.enabled") : t("webhooks.disabled")} tone={w.active ? "success" : "neutral"} />
        </button>
      ),
    },
  ];

  const filtered = search.trim() === "" ? webhooks : webhooks.filter((w) => w.name.includes(search) || w.targetUrl.includes(search));

  return (
    <>
      {createdWebhook ? <CreatedWebhookBanner result={createdWebhook} onDismiss={() => setCreatedWebhook(null)} /> : null}

      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("webhooks.couldNotLoadTheWebhooks")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>{t("common.retry")}</Button>
        </Card>
      ) : null}

      <DocumentList<WebhookDTO>
        eyebrow="Settings · Webhooks"
        title={t("webhooks.webhooks")}
        description={t("webhooks.sendEventsToAnOutside")}
        actions={
          <Button variant="primary" onClick={() => setPanelOpen(true)}>
            {t("webhooks.newWebhook")}
          </Button>
        }
        stats={[
          { label: t("webhooks.totalWebhooks"), value: <span className="mz-num">{webhooks.length}</span> },
          { label: t("webhooks.enabled2"), value: <span className="mz-num">{webhooks.filter((w) => w.active).length}</span> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("webhooks.searchByNameOrUrl")}
        columns={columns}
        rows={filtered}
        rowKey={(w) => w.id}
        onRowClick={(w) => setSelectedId(w.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{webhooks.length}</span> {t("webhooks.webhook")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("webhooks.noWebhooksHaveBeenRegistered")}</div>}
      />

      <SidePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title={t("webhooks.newWebhook")}
        description={t("webhooks.aSignedHttpRequestGoes")}
        className="w-[620px]"
      >
        <div className="flex flex-col gap-[14px]">
          {formError ? <StatusPill label={formError} tone="danger" /> : null}
          <TextField label={t("common.name")} value={name} onChange={setName} placeholder={t("webhooks.eGTheExternalAccounting")} />
          <TextField label={t("webhooks.destinationUrl")} value={targetUrl} onChange={setTargetUrl} placeholder="https://example.com/webhooks/mezan" />
          <EventsChecklist events={deliverableEvents} selected={selectedEvents} onToggle={toggleEvent} />
          <div className="flex justify-end gap-[9px]">
            <Button onClick={() => setPanelOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={createWebhook.isPending} onClick={() => void submitNewWebhook()}>
              {createWebhook.isPending ? t("webhooks.creating") : t("webhooks.createTheWebhook")}
            </Button>
          </div>
        </div>
      </SidePanel>
    </>
  );
}
