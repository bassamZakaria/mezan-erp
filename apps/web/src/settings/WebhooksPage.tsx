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
import { DOMAIN_EVENT_CATALOG, EVENT_CATEGORIES, type EventCategory } from "@mezan/domain";
import type { WebhookDTO, CreateWebhookResultDTO, WebhookDeliveryDTO } from "@mezan/contracts";
import { useWebhooks, useCreateWebhook, useUpdateWebhook, useWebhookDeliveries } from "../data/account-hooks";
import { useApi } from "../data/ApiContext";
import { TextField, SectionCard } from "./form-controls";

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
  const { request, session } = useApi();
  return useQuery<{ events: DeliverableEvent[]; enforced: boolean }>({
    queryKey: ["webhooks", "events"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/webhooks/events");
      if (!res.ok) throw new Error("تعذّر تحميل الأحداث المتاحة.");
      return res.json<{ events: DeliverableEvent[]; enforced: boolean }>();
    },
  });
}

const CATEGORY_LABELS: Readonly<Record<EventCategory, string>> = {
  workflow: "سير العمل",
  sales: "المبيعات",
  purchases: "المشتريات",
  treasury: "الخزينة",
  installments: "الأقساط",
  cheques: "الأوراق المالية",
  pos: "نقطة البيع",
  inventory: "المخزون",
  manufacturing: "التصنيع",
  platform: "المنصة",
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
  if (available.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-[20px] text-center text-[12.5px] text-ink-muted">
        لا توجد أحداث قابلة للإرسال في هذه النسخة بعد.
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
            <h4 className="mb-[8px] text-[11px] font-bold uppercase tracking-[0.4px] text-ink-faint">{CATEGORY_LABELS[category]}</h4>
            <div className="flex flex-wrap gap-[8px]">
              {events.map((e) => (
                <Chip key={e.code} type="button" active={selected.has(e.code)} onClick={() => onToggle(e.code)}>
                  {e.labelAr}
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
        تم إنشاء الويب هوك "{result.name}" — انسخ مفتاح التوقيع الآن، لن يُعرض مرة أخرى.
      </p>
      <div className="mt-[10px] flex flex-wrap items-center gap-[10px]">
        <code className="mz-lat rounded-md border border-border bg-surface px-[12px] py-[8px] text-[13px] text-ink">{result.secret}</code>
        <Button size="sm" onClick={() => void copy()}>{copied ? "تم النسخ" : "نسخ"}</Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>إغلاق</Button>
      </div>
    </Card>
  );
}

function deliveryStatus(d: WebhookDeliveryDTO): { label: string; tone: PillTone } {
  return d.success ? { label: "نجحت", tone: "success" as PillTone } : { label: "فشلت", tone: "danger" as PillTone };
}

function WebhookDetail({ webhook, onBack }: { webhook: WebhookDTO; onBack: () => void }) {
  const deliveriesQuery = useWebhookDeliveries(webhook.id);
  const deliveries = deliveriesQuery.data ?? [];

  return (
    <DocumentDetail
      title={webhook.name}
      subtitle={webhook.targetUrl}
      statusLabel={webhook.active ? "مفعّل" : "معطّل"}
      statusTone={webhook.active ? "success" : "neutral"}
      actions={<Button onClick={onBack}>رجوع للقائمة</Button>}
      summary={[
        { label: "الأحداث المشترك بها", value: <span className="mz-num">{webhook.events.length}</span> },
        { label: "تاريخ الإنشاء", value: formatDate(webhook.createdAt, { style: "long" }) },
      ]}
      tabs={[
        {
          key: "overview",
          label: "نظرة عامة",
          content: (
            <SectionCard title="الأحداث المشترك بها">
              <div className="col-span-full flex flex-wrap gap-[8px]">
                {webhook.events.map((code) => {
                  const def = DOMAIN_EVENT_CATALOG.find((e) => e.code === code);
                  return (
                    <Chip key={code} active>
                      {def?.labelAr ?? code}
                    </Chip>
                  );
                })}
              </div>
            </SectionCard>
          ),
        },
        {
          key: "deliveries",
          label: "محاولات التسليم",
          content:
            deliveries.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-[24px] text-center text-[12.5px] text-ink-muted">
                لا توجد محاولات تسليم مسجّلة بعد.
              </div>
            ) : (
              <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[680px] border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border text-ink-muted">
                      <th className="p-[10px] text-start font-semibold">الحدث</th>
                      <th className="p-[10px] text-start font-semibold">الحالة</th>
                      <th className="p-[10px] text-start font-semibold">رمز الاستجابة</th>
                      <th className="p-[10px] text-start font-semibold">التفاصيل</th>
                      <th className="p-[10px] text-end font-semibold">وقت المحاولة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.map((d) => {
                      const status = deliveryStatus(d);
                      return (
                        <tr key={d.id} className="border-b border-border last:border-b-0">
                          <td className="p-[10px] text-ink">{DOMAIN_EVENT_CATALOG.find((e) => e.code === d.eventCode)?.labelAr ?? d.eventCode}</td>
                          <td className="p-[10px]"><StatusPill label={status.label} tone={status.tone} /></td>
                          <td className="mz-num p-[10px] text-ink-muted">{d.statusCode ?? "—"}</td>
                          <td className="mz-lat p-[10px] text-[11.5px] text-ink-muted">{d.errorMessage ?? "—"}</td>
                          <td className="mz-num p-[10px] text-end text-ink-muted">{formatDate(d.attemptedAt, { style: "long" })}</td>
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
      setFormError("اسم الويب هوك مطلوب");
      return;
    }
    if (targetUrl.trim() === "") {
      setFormError("رابط الوجهة مطلوب");
      return;
    }
    if (selectedEvents.size === 0) {
      setFormError("اختر حدثًا واحدًا على الأقل");
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
      setFormError(err instanceof Error ? err.message : "تعذر إنشاء الويب هوك");
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
    { key: "name", header: "الاسم", render: (w) => <span className="font-semibold text-ink">{w.name}</span> },
    { key: "targetUrl", header: "رابط الوجهة", render: (w) => <span className="mz-lat text-[12px] text-ink-muted">{w.targetUrl}</span> },
    { key: "events", header: "الأحداث", render: (w) => <span className="mz-num">{w.events.length}</span> },
    { key: "createdAt", header: "تاريخ الإنشاء", render: (w) => formatDate(w.createdAt, { style: "long" }) },
    {
      key: "active",
      header: "الحالة",
      render: (w) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); void handleToggleActive(w); }} disabled={togglingId === w.id}>
          <StatusPill label={togglingId === w.id ? "…" : w.active ? "مفعّل" : "معطّل"} tone={w.active ? "success" : "neutral"} />
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
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل الويب هوك.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>إعادة المحاولة</Button>
        </Card>
      ) : null}

      <DocumentList<WebhookDTO>
        eyebrow="Settings · Webhooks"
        title="الويب هوك"
        description="أرسل الأحداث إلى نظام خارجي عبر رابط ويب هوك موقّع."
        actions={
          <Button variant="primary" onClick={() => setPanelOpen(true)}>
            ويب هوك جديد
          </Button>
        }
        stats={[
          { label: "إجمالي الويب هوك", value: <span className="mz-num">{webhooks.length}</span> },
          { label: "مفعّلة", value: <span className="mz-num">{webhooks.filter((w) => w.active).length}</span> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالاسم أو الرابط…"
        columns={columns}
        rows={filtered}
        rowKey={(w) => w.id}
        onRowClick={(w) => setSelectedId(w.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{webhooks.length}</span> ويب هوك
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد ويب هوك مسجّلة بعد</div>}
      />

      <SidePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title="ويب هوك جديد"
        description="سيُرسل طلب HTTP موقّع إلى الرابط عند وقوع أي من الأحداث المحددة."
        className="w-[620px]"
      >
        <div className="flex flex-col gap-[14px]">
          {formError ? <StatusPill label={formError} tone="danger" /> : null}
          <TextField label="الاسم" value={name} onChange={setName} placeholder="مثال: نظام المحاسبة الخارجي" />
          <TextField label="رابط الوجهة" value={targetUrl} onChange={setTargetUrl} placeholder="https://example.com/webhooks/mezan" />
          <EventsChecklist events={deliverableEvents} selected={selectedEvents} onToggle={toggleEvent} />
          <div className="flex justify-end gap-[9px]">
            <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
            <Button variant="primary" disabled={createWebhook.isPending} onClick={() => void submitNewWebhook()}>
              {createWebhook.isPending ? "جارٍ الإنشاء…" : "إنشاء الويب هوك"}
            </Button>
          </div>
        </div>
      </SidePanel>
    </>
  );
}
