import { useState } from "react";
import { FulcrumRule, DocumentList, StatCard, Chip, Button, VarianceBeam, type DocumentListColumn } from "@mezan/ui";
import type { FxRevaluationDetailDTO } from "@mezan/contracts";
import { nextDay } from "@mezan/domain";
import { useFxRevaluationPost, useFxRevaluationPreview } from "../data/hooks";
import { useAppTranslation } from "../i18n";

function fmt(value: string, digits = 2): string {
  return Number(value).toLocaleString("ar-EG", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const CURRENCIES = ["USD", "EUR", "SAR", "AED", "QAR", "KWD", "GBP"];

/**
 * إعادة تقييم العملات الأجنبية — FX Revaluation (docs/catalog/04). Revalues open
 * foreign-currency balances at the approved closing rate and posts the FX
 * gain/loss — auto-reversing the next day by default. Runs the REAL
 * `computeFxRevaluation` / `postFxRevaluation` domain services server-side
 * via `POST /revaluation/preview` and `/revaluation/post`.
 */
export function FxRevaluationScreen() {
  const { t } = useAppTranslation();
  const previewMutation = useFxRevaluationPreview();
  const postMutation = useFxRevaluationPost();
  const [toDate, setToDate] = useState("2026-08-31");
  const [autoReverse, setAutoReverse] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ entryNo: string | null; reversalNo: string | null } | null>(null);

  function toggleCurrency(c: string) {
    setSelected((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function runPreview() {
    setError(null);
    setPosted(null);
    try {
      await previewMutation.mutateAsync({ date: toDate, currencies: selected, autoReverse });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fx.theRevaluationCouldNotBe"));
    }
  }

  async function runPost() {
    setError(null);
    try {
      const result = await postMutation.mutateAsync({ date: toDate, currencies: selected, autoReverse });
      setPosted({ entryNo: result.entryNo, reversalNo: result.reversalNo });
      await runPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fx.theRevaluationCouldNotBe2"));
    }
  }

  const columns: DocumentListColumn<FxRevaluationDetailDTO>[] = [
    { key: "account", header: t("fx.account"), render: (d) => <span className="font-semibold text-ink">{d.label ?? d.accountId}</span> },
    { key: "currency", header: t("fx.currency"), render: (d) => <span className="mz-num text-ink-muted">{d.currency}</span> },
    { key: "foreign", header: t("fx.foreignBalance"), render: (d) => <span className="mz-num">{fmt(d.foreignAmount)}</span> },
    { key: "rate", header: t("fx.closingRate"), render: (d) => <span className="mz-num">{fmt(d.closingRate, 4)}</span> },
    { key: "booked", header: t("fx.carryingValue"), render: (d) => <span className="mz-num">{fmt(d.bookedBase)}</span> },
    { key: "revalued", header: t("fx.afterRevaluation"), render: (d) => <span className="mz-num">{fmt(d.revaluedBase)}</span> },
    {
      key: "gl",
      header: t("fx.differenceGainLoss"),
      align: "end",
      render: (d) => (
        <VarianceBeam value={Number(d.gainLoss)} className="font-bold">
          <span className="mz-num">{fmt(d.gainLoss)}</span>
        </VarianceBeam>
      ),
    },
  ];

  const p = previewMutation.data ?? null;

  return (
    <div className="w-full">
      <div className="mb-[16px]">
        <div className="mz-eyebrow">Accounting · FX Revaluation</div>
        <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("fx.foreignCurrencyRevaluation")}</h1>
        <p className="mt-[5px] max-w-[70ch] text-[12.5px] text-ink-muted">{t("fx.thisPostsAnEntryRestating")}</p>
      </div>
      <FulcrumRule />

      <div className="mb-[18px] rounded-lg border border-border bg-surface p-[16px_18px]">
        <div className="flex flex-wrap items-end gap-[16px]">
          <label className="flex flex-col gap-[4px] text-[12px] text-ink-muted">{t("fx.asOfEntryDate")}
            <input type="date" aria-label={t("fx.asOf")} value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-md border border-border bg-surface px-[11px] py-[9px] text-[12.5px] text-ink" />
          </label>
          <label className="flex items-center gap-[8px] text-[12.5px] text-ink">
            <input type="checkbox" checked={autoReverse} onChange={(e) => setAutoReverse(e.target.checked)} />
            {t("fx.reversesAutomaticallyReversingEntryOn")} {nextDay(toDate)})
          </label>
          <div className="flex-1" />
          <Button variant="primary" onClick={runPreview}>{t("fx.preview")}</Button>
          <Button onClick={runPost}>{t("fx.postRevaluation")}</Button>
        </div>
        <div className="mt-[12px] flex flex-wrap items-center gap-[8px]">
          <span className="text-[12px] text-ink-muted">{t("fx.currencies")}</span>
          <Chip active={selected.length === 0} onClick={() => setSelected([])}>{t("common.all")}</Chip>
          {CURRENCIES.map((c) => (
            <Chip key={c} active={selected.includes(c)} onClick={() => toggleCurrency(c)}>{c}</Chip>
          ))}
        </div>
      </div>

      {error ? <div role="alert" className="mb-[14px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">{error}</div> : null}
      {posted ? (
        <div role="status" className="mb-[14px] rounded-md border border-success bg-success-soft px-[12px] py-[10px] text-[12.5px] text-success-ink">
          {t("fx.theRevaluationEntryHasBeen")} {posted.entryNo ?? ""}{posted.reversalNo ? ` مع قيد عكسي ${posted.reversalNo}` : ""}.
        </div>
      ) : null}

      {p ? (
        <>
          <div className="mb-[16px] grid grid-cols-1 gap-[14px] sm:grid-cols-3">
            <StatCard label={t("fx.totalGains")} value={<span className="mz-num">{fmt(p.totalGain)}</span>} />
            <StatCard label={t("fx.totalLosses")} value={<span className="mz-num">{fmt(p.totalLoss)}</span>} />
            <StatCard label={t("fx.reversalDate")} value={<span className="mz-num">{p.autoReverse ? p.reversalDate : "—"}</span>} />
          </div>
          <DocumentList<FxRevaluationDetailDTO>
            eyebrow="Accounting · FX Revaluation"
            title=""
            columns={columns}
            rows={p.details}
            rowKey={(d) => `${d.accountId}-${d.currency}`}
            page={1}
            pageCount={1}
            pageSummary={<>{t("common.show")} <span className="mz-num">{p.details.length}</span> {t("fx.balancesToRevalue")}</>}
            emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("fx.noOpenForeignCurrencyBalances")}</div>}
          />
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-ink-muted">{t("fx.pressPreviewToListThe")}</div>
      )}
    </div>
  );
}
