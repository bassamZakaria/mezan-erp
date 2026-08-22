import { useMemo, useState } from "react";
import { DocumentList, StatusPill, Chip, Button, type DocumentListColumn, type PillTone } from "@mezan/ui";
import type { ExchangeRateDTO, ExchangeRateStatusDTO } from "@mezan/contracts";
import type { ExchangeRate } from "@mezan/domain";
import { createAccountingDepthStore } from "../store/accounting-depth-store";

const STATUS_LABEL: Record<ExchangeRateStatusDTO, string> = { pending: "بانتظار الاعتماد", approved: "معتمد", locked: "مقفل" };
const STATUS_TONE: Record<ExchangeRateStatusDTO, PillTone> = { pending: "warning", approved: "success", locked: "neutral" };

const CURRENCIES = ["USD", "EUR", "GBP", "SAR", "AED", "QAR", "KWD"];

function toDTO(r: ExchangeRate): ExchangeRateDTO {
  return { id: r.id, currency: r.currency, rate: r.rate, effectiveDate: r.effectiveDate, rateType: r.rateType, source: r.source, status: r.status };
}

/**
 * أسعار الصرف — Exchange Rates (docs/catalog/04). Master data feeding FX
 * revaluation, with the بانتظار الاعتماد → معتمد → مقفل approval lifecycle.
 * Base currency is EGP; every rate is quoted foreign→EGP.
 */
export function ExchangeRatesScreen() {
  const store = useMemo(() => createAccountingDepthStore(), []);
  const [rates, setRates] = useState<ExchangeRateDTO[]>(() => store.listExchangeRates().map(toDTO));
  const [statusFilter, setStatusFilter] = useState<ExchangeRateStatusDTO | "all">("all");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ currency: "USD", rate: "", effectiveDate: "2026-08-31" });

  const filtered = statusFilter === "all" ? rates : rates.filter((r) => r.status === statusFilter);

  function refresh() {
    setRates(store.listExchangeRates().map(toDTO));
  }

  function approve(id: string) {
    store.approveExchangeRate(id);
    refresh();
  }

  function submitAdd() {
    if (draft.rate.trim() === "") return;
    store.addExchangeRate({ id: `r-${Date.now()}`, currency: draft.currency, rate: draft.rate, effectiveDate: draft.effectiveDate, rateType: "standard", source: "manual", status: "pending" });
    setAdding(false);
    setDraft({ currency: "USD", rate: "", effectiveDate: "2026-08-31" });
    refresh();
  }

  const columns: DocumentListColumn<ExchangeRateDTO>[] = [
    { key: "pair", header: "زوج العملات", render: (r) => <span className="font-semibold text-ink">{r.currency} / EGP</span> },
    { key: "rate", header: "سعر الصرف", render: (r) => <span className="mz-num text-ink">{Number(r.rate).toLocaleString("ar-EG", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}</span> },
    { key: "date", header: "تاريخ السريان", render: (r) => <span className="mz-num text-ink-muted">{r.effectiveDate}</span> },
    { key: "source", header: "المصدر", render: (r) => <span className="text-ink-muted">{r.source === "manual" ? "يدوي" : "تلقائي"}</span> },
    { key: "status", header: "الحالة", render: (r) => <StatusPill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} /> },
    { key: "actions", header: "", render: (r) => (r.status === "pending" ? <div className="flex justify-end"><Button size="sm" onClick={() => approve(r.id)}>اعتماد</Button></div> : null) },
  ];

  return (
    <div className="w-full">
      <div className="mb-[18px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">Accounting · Exchange Rates</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">أسعار الصرف</h1>
          <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">العملة الأساسية: EGP — جميع الأسعار محسوبة مقابل هذه العملة</p>
        </div>
        <Button variant="primary" onClick={() => setAdding((v) => !v)}>إضافة سعر صرف</Button>
      </div>

      {adding ? (
        <div className="mb-[16px] rounded-lg border border-border bg-surface p-[16px_18px]">
          <div className="flex flex-wrap items-end gap-[12px]">
            <label className="flex flex-col gap-[4px] text-[12px] text-ink-muted">العملة الأجنبية
              <select aria-label="العملة الأجنبية" value={draft.currency} onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))} className="rounded-md border border-border bg-surface px-[11px] py-[9px] text-[12.5px] text-ink">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-[4px] text-[12px] text-ink-muted">سعر الصرف
              <input aria-label="سعر الصرف" inputMode="decimal" value={draft.rate} onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value }))} placeholder="50.2500" className="rounded-md border border-border bg-surface px-[11px] py-[9px] text-[12.5px] text-ink" />
            </label>
            <label className="flex flex-col gap-[4px] text-[12px] text-ink-muted">تاريخ السريان
              <input type="date" aria-label="تاريخ السريان" value={draft.effectiveDate} onChange={(e) => setDraft((d) => ({ ...d, effectiveDate: e.target.value }))} className="rounded-md border border-border bg-surface px-[11px] py-[9px] text-[12.5px] text-ink" />
            </label>
            <Button variant="primary" onClick={submitAdd}>حفظ</Button>
            <Button onClick={() => setAdding(false)}>إلغاء</Button>
          </div>
        </div>
      ) : null}

      <DocumentList<ExchangeRateDTO>
        eyebrow="Accounting · Exchange Rates"
        title=""
        filterBarExtra={
          <div className="flex flex-wrap gap-[8px]">
            {([["all", "الكل"], ["pending", "بانتظار الاعتماد"], ["approved", "معتمد"], ["locked", "مقفل"]] as const).map(([value, label]) => (
              <Chip key={value} active={statusFilter === value} onClick={() => setStatusFilter(value)}>{label}</Chip>
            ))}
          </div>
        }
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        page={1}
        pageCount={1}
        pageSummary={<>عرض <span className="mz-num">{filtered.length}</span> سعر صرف</>}
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد أسعار صرف</div>}
      />
    </div>
  );
}
