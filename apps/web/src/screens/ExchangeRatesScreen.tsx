import { useState } from "react";
import {
  Button,
  Card,
  Chip,
  DocumentList,
  FulcrumRule,
  Select,
  StatusPill,
  TextInput,
  formatNumber,
  type DocumentListColumn,
  type PillTone,
} from "@mezan/ui";
import type { ExchangeRateDTO, ExchangeRateStatusDTO } from "@mezan/contracts";
import { useApproveExchangeRate, useCreateExchangeRate, useExchangeRates } from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { TextField } from "../settings/form-controls";
import { todayIso } from "../lib/dates";

const STATUS_KEY: Record<ExchangeRateStatusDTO, AppTranslationKey> = { pending: "fxRates.status.pending", approved: "fxRates.status.approved", locked: "fxRates.status.locked" };
const STATUS_TONE: Record<ExchangeRateStatusDTO, PillTone> = { pending: "warning", approved: "success", locked: "neutral" };

const CURRENCIES = ["USD", "EUR", "GBP", "SAR", "AED", "QAR", "KWD"];

/**
 * أسعار الصرف — Exchange Rates (docs/catalog/04). Master data feeding FX
 * revaluation, with the بانتظار الاعتماد → معتمد → مقفل approval lifecycle.
 * Base currency is EGP; every rate is quoted foreign→EGP.
 */
export function ExchangeRatesScreen() {
  const { t } = useAppTranslation();
  const query = useExchangeRates();
  const createExchangeRate = useCreateExchangeRate();
  const approveExchangeRate = useApproveExchangeRate();
  const rates = query.data ?? [];
  const [statusFilter, setStatusFilter] = useState<ExchangeRateStatusDTO | "all">("all");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ currency: "USD", rate: "", effectiveDate: todayIso() });
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filtered = rates.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    // The effective date is what a rate is looked up by, so it is the one a
    // date range has to narrow.
    if (fromDate && r.effectiveDate < fromDate) return false;
    if (toDate && r.effectiveDate > toDate) return false;
    const term = search.trim().toUpperCase();
    return term === "" || r.currency.toUpperCase().includes(term);
  });

  async function approve(id: string) {
    try {
      await approveExchangeRate.mutateAsync(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fxRates.theExchangeRateCouldNot"));
    }
  }

  async function submitAdd() {
    if (draft.rate.trim() === "") return;
    setError(null);
    try {
      await createExchangeRate.mutateAsync({
        id: crypto.randomUUID(),
        currency: draft.currency,
        rate: draft.rate,
        effectiveDate: draft.effectiveDate,
        rateType: "standard",
        source: "manual",
        status: "pending",
      });
      setAdding(false);
      setDraft({ currency: "USD", rate: "", effectiveDate: todayIso() });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fxRates.theExchangeRateCouldNot2"));
    }
  }

  const columns: DocumentListColumn<ExchangeRateDTO>[] = [
    { key: "pair", header: t("fxRates.currencyPair"), render: (r) => <span className="font-semibold text-ink">{r.currency} / EGP</span> },
    { key: "rate", header: t("fxRates.rate"), render: (r) => <span className="mz-num text-ink">{formatNumber(Number(r.rate), { minimumFractionDigits: 4, maximumFractionDigits: 6 })}</span> },
    { key: "date", header: t("fxRates.effectiveFrom"), render: (r) => <span className="mz-num text-ink-muted">{r.effectiveDate}</span> },
    { key: "source", header: t("fxRates.source"), render: (r) => <span className="text-ink-muted">{r.source === "manual" ? t("fxRates.manual") : t("fxRates.automatic")}</span> },
    { key: "status", header: t("common.status"), render: (r) => <StatusPill label={t(STATUS_KEY[r.status])} tone={STATUS_TONE[r.status]} /> },
    { key: "actions", header: "", render: (r) => (r.status === "pending" ? <div className="flex justify-end"><Button size="sm" onClick={() => approve(r.id)}>{t("fxRates.approve")}</Button></div> : null) },
  ];

  if (query.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">{t("fxRates.exchangeRatesCouldNotBe")}</p>
        <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("fxRates.exchangeRates")}</h1>
          <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("fxRates.baseCurrencyEgpEveryRate")}</p>
        </div>
        <Button variant="primary" onClick={() => setAdding((v) => !v)}>{t("fxRates.addRate")}</Button>
      </div>
      <FulcrumRule />

      {error ? <div role="alert" className="mb-[14px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">{error}</div> : null}

      {adding ? (
        <div className="mb-[16px] rounded-lg border border-border bg-surface p-[16px_18px]">
          <div className="flex flex-wrap items-end gap-[12px]">
            <div className="flex flex-col gap-[4px] text-[12px] text-ink-muted">{t("fxRates.foreignCurrency")}
              <Select
                size="sm"
                className="w-[130px]"
                aria-label={t("fxRates.foreignCurrency")}
                value={draft.currency}
                onChange={(value) => setDraft((d) => ({ ...d, currency: value }))}
                options={CURRENCIES.map((c) => ({ value: c, label: c }))}
              />
            </div>
            <label className="flex flex-col gap-[4px] text-[12px] text-ink-muted">{t("fxRates.rate")}
              <TextInput size="sm" numeric aria-label={t("fxRates.rate")} inputMode="decimal" value={draft.rate} onChange={(e) => setDraft((d) => ({ ...d, rate: e.target.value }))} placeholder="50.2500" />
            </label>
            <label className="flex flex-col gap-[4px] text-[12px] text-ink-muted">{t("fxRates.effectiveFrom")}
              <TextInput size="sm" type="date" aria-label={t("fxRates.effectiveFrom")} value={draft.effectiveDate} onChange={(e) => setDraft((d) => ({ ...d, effectiveDate: e.target.value }))} />
            </label>
            <Button variant="primary" onClick={submitAdd}>{t("common.save")}</Button>
            <Button onClick={() => setAdding(false)}>{t("common.cancel")}</Button>
          </div>
        </div>
      ) : null}

      <DocumentList<ExchangeRateDTO>
        title=""
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("fxRates.searchPlaceholder")}
        filterBarExtra={
          <div className="flex w-full flex-col gap-[10px]">
            <div className="flex flex-wrap gap-[8px]">
              {([["all", t("common.all")], ["pending", t("fxRates.awaitingApproval")], ["approved", t("fxRates.approved")], ["locked", t("fxRates.locked")]] as const).map(([value, label]) => (
                <Chip key={value} active={statusFilter === value} onClick={() => setStatusFilter(value)}>{label}</Chip>
              ))}
            </div>
            <div className="grid w-full gap-2 sm:grid-cols-2">
              <TextField label={t("fxRates.filter.fromDate")} value={fromDate} onChange={setFromDate} type="date" />
              <TextField label={t("fxRates.filter.toDate")} value={toDate} onChange={setToDate} type="date" />
            </div>
          </div>
        }
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        page={1}
        pageCount={1}
        pageSummary={<>{t("common.show")} <span className="mz-num">{filtered.length}</span> {t("fxRates.rates")}</>}
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("fxRates.noExchangeRates")}</div>}
      />
    </div>
  );
}
