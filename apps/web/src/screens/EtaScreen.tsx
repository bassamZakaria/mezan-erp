import { useState } from "react";
import { DocumentList, StatusPill, Chip, Button, Card, type DocumentListColumn, type PillTone } from "@mezan/ui";
import type { EtaSubmissionDTO, EtaSubmissionStatusDTO } from "@mezan/contracts";
import { getEtaStatusLabel, getEtaDocumentTypeLabel } from "@mezan/domain";
import { useEtaConfig, useEtaSubmissions, useExcludeEtaSubmission, useSubmitAllReadyEta, useSubmitEtaSubmission } from "../data/hooks";

const STATUS_TONE: Record<EtaSubmissionStatusDTO, PillTone> = {
  ready: "info",
  pending_signature: "warning",
  submitted: "info",
  accepted: "success",
  error: "danger",
  excluded: "neutral",
};

const STATUS_TABS: Array<EtaSubmissionStatusDTO | "all"> = ["all", "ready", "pending_signature", "submitted", "accepted", "error", "excluded"];

/**
 * الفاتورة الإلكترونية (ETA) — e-invoicing (docs/catalog/04). Config readiness +
 * the submission queue lifecycle (جاهز → بانتظار التوقيع → مرسل → مقبول, plus
 * أخطاء/مستبعد), on the real `/eta/*` routes (packages/api/src/eta-routes.ts).
 * The online transmit is STUBBED server-side (online-only): submitting an
 * offline document keeps it queued (202) and surfaces a notice.
 */
export function EtaScreen() {
  const configQuery = useEtaConfig();
  const submissionsQuery = useEtaSubmissions();
  const [statusFilter, setStatusFilter] = useState<EtaSubmissionStatusDTO | "all">("all");
  const submitOneMutation = useSubmitEtaSubmission();
  const submitAllMutation = useSubmitAllReadyEta();
  const excludeMutation = useExcludeEtaSubmission();
  const [notice, setNotice] = useState<string | null>(null);
  const [excludingId, setExcludingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const config = configQuery.data?.config ?? null;
  const readiness = configQuery.data?.readiness ?? null;
  const allSubs = submissionsQuery.data ?? [];
  const filtered = statusFilter === "all" ? allSubs : allSubs.filter((s) => s.status === statusFilter);
  const countBy = (status: EtaSubmissionStatusDTO) => allSubs.filter((s) => s.status === status).length;

  async function submitOne(id: string) {
    setNotice(null);
    const result = await submitOneMutation.mutateAsync(id);
    if (result.queuedOffline) {
      setNotice("الإرسال الفعلي متاح فقط عند الاتصال بالمصلحة (موقوف في هذه النسخة) — بقي المستند في قائمة الإرسال.");
    }
  }

  async function submitAll() {
    setNotice(null);
    const result = await submitAllMutation.mutateAsync();
    if (result.queued.length > 0) setNotice(`تعذر الإرسال الفعلي (متاح فقط عند الاتصال) — ${result.queued.length} مستند بقي في قائمة الإرسال.`);
  }

  async function confirmExclude() {
    if (!excludingId || reason.trim() === "") return;
    await excludeMutation.mutateAsync({ id: excludingId, body: { reason: reason.trim() } });
    setExcludingId(null);
    setReason("");
  }

  const columns: DocumentListColumn<EtaSubmissionDTO>[] = [
    { key: "internal", header: "المعرف الداخلي", render: (s) => <span className="mz-num font-semibold text-ink">{s.internalId}</span> },
    { key: "type", header: "النوع", render: (s) => <span className="text-ink-muted">{getEtaDocumentTypeLabel(s.documentType)}</span> },
    { key: "status", header: "الحالة", render: (s) => <StatusPill label={getEtaStatusLabel(s.status)} tone={STATUS_TONE[s.status]} /> },
    { key: "uuid", header: "المعرف لدى المصلحة", render: (s) => <span className="mz-num text-ink-muted">{s.etaUuid ?? "—"}</span> },
    { key: "errors", header: "الأخطاء", render: (s) => <span className="text-danger-ink">{s.errors.length > 0 ? s.errors.join("، ") : "—"}</span> },
    {
      key: "actions",
      header: "",
      render: (s) => (
        <div className="flex justify-end gap-[6px]">
          {(s.status === "ready" || s.status === "pending_signature" || s.status === "error") ? <Button size="sm" onClick={() => submitOne(s.id)}>إرسال</Button> : null}
          {(s.status === "ready" || s.status === "pending_signature" || s.status === "error") ? <Button size="sm" onClick={() => { setExcludingId(s.id); setReason(""); }}>استبعاد</Button> : null}
        </div>
      ),
    },
  ];

  if (configQuery.isError || submissionsQuery.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل بيانات الفاتورة الإلكترونية.</p>
        <Button size="sm" className="mt-[10px]" onClick={() => { void configQuery.refetch(); void submissionsQuery.refetch(); }}>
          إعادة المحاولة
        </Button>
      </Card>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-[18px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">Accounting · ETA e-Invoicing</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">الفاتورة الإلكترونية</h1>
          <p className="mt-[5px] max-w-[70ch] text-[12.5px] text-ink-muted">قائمة إرسال المستندات المؤكدة إلى مصلحة الضرائب المصرية. الإرسال الفعلي متاح فقط عند الاتصال (موقوف في هذه النسخة) — تُبنى الحمولة وتُدرج في قائمة الإرسال دون اتصال.</p>
        </div>
        <Button variant="primary" onClick={submitAll}>إرسال كل الجاهز</Button>
      </div>

      {readiness ? (
        <Card className="mb-[16px] p-[16px_18px]">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-semibold text-ink">الجاهزية: <span className="mz-num">{readiness.percent}%</span></div>
            {config ? <StatusPill label={config.environment === "production" ? "بيئة الإنتاج" : "بيئة الاختبار"} tone={config.environment === "production" ? "success" : "warning"} /> : null}
          </div>
          <div className="mt-[10px] flex flex-wrap gap-[8px]">
            {readiness.items.map((i) => (
              <StatusPill key={i.key} label={i.labelAr} tone={i.complete ? "success" : "neutral"} />
            ))}
          </div>
        </Card>
      ) : null}

      {notice ? <div role="status" className="mb-[14px] rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">{notice}</div> : null}

      {excludingId ? (
        <div className="mb-[14px] rounded-lg border border-border bg-surface p-[14px_16px]">
          <div className="mb-[8px] text-[12.5px] font-semibold text-ink">سبب الاستبعاد (إلزامي)</div>
          <div className="flex flex-wrap items-center gap-[8px]">
            <input aria-label="سبب الاستبعاد" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="اذكر سبب الاستبعاد..." className="min-w-[260px] flex-1 rounded-md border border-border bg-surface px-[11px] py-[9px] text-[12.5px] text-ink" />
            <Button variant="primary" onClick={confirmExclude}>تأكيد الاستبعاد</Button>
            <Button onClick={() => setExcludingId(null)}>إلغاء</Button>
          </div>
        </div>
      ) : null}

      <DocumentList<EtaSubmissionDTO>
        eyebrow="Accounting · ETA e-Invoicing"
        title=""
        filterBarExtra={
          <div className="flex flex-wrap gap-[8px]">
            {STATUS_TABS.map((tab) => (
              <Chip key={tab} active={statusFilter === tab} onClick={() => setStatusFilter(tab)}>
                {tab === "all" ? `الكل (${allSubs.length})` : `${getEtaStatusLabel(tab)} (${countBy(tab)})`}
              </Chip>
            ))}
          </div>
        }
        columns={columns}
        rows={filtered}
        rowKey={(s) => s.id}
        page={1}
        pageCount={1}
        pageSummary={<>عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{allSubs.length}</span> مستند</>}
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد مستندات في هذه الحالة</div>}
      />
    </div>
  );
}
