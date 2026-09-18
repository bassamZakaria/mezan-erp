import { useMemo, useState } from "react";
import { Button, Card, EntityPicker, Money as MoneyDisplay, StatusPill, type EntityPickerOption } from "@mezan/ui";
import type { AccountDTO, FiscalPeriodDTO } from "@mezan/contracts";
import { TextField } from "../settings/form-controls";
import { useAccounts, useCloseFiscalYear, useYearEndCloseEntry, useYearEndClosePreview } from "../data/hooks";
import { useAppTranslation } from "../i18n";

/**
 * إقفال السنة المالية — the fifth close step, and until now the only one with
 * no screen: the engine, the route and the posting were all in place and
 * nothing in the UI ever called them, so the year-end entry could only be
 * posted from outside the product (D34's tail).
 *
 * The card shows what the entry WOULD post before it posts it — the same
 * `planYearEndClose` the close itself runs, so the preview cannot disagree
 * with the entry — and once posted it shows the entry instead of the button,
 * because the close is idempotent by `YEAR-CLOSE:<year>` and that entry's
 * existence IS the year's closed flag.
 */

const RETAINED_EARNINGS_CODE = "3900";

function isRetainedEarningsCandidate(account: AccountDTO): boolean {
  return account.type === "equity" && !account.isHeader && account.status === "active";
}

export function YearEndCloseCard({ year, periodsInYear }: { year: number; periodsInYear: readonly FiscalPeriodDTO[] }) {
  const { t } = useAppTranslation();
  const accountsQuery = useAccounts();
  const postedEntry = useYearEndCloseEntry(year);
  const preview = useYearEndClosePreview(year, postedEntry.data === null);
  const closeYear = useCloseFiscalYear();

  const [accountId, setAccountId] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const equityOptions: EntityPickerOption[] = useMemo(
    () =>
      (accountsQuery.data ?? [])
        .filter(isRetainedEarningsCandidate)
        .map((account) => ({ id: account.id, label: account.nameAr, sublabel: account.code })),
    [accountsQuery.data],
  );

  // 3900 الأرباح المرحلة is where the standard chart puts the year's result, so
  // it is the default — but it stays a picked account, never an assumed one:
  // a tenant that renamed or renumbered its equity section still chooses.
  const defaultAccountId = useMemo(
    () => (accountsQuery.data ?? []).find((a) => isRetainedEarningsCandidate(a) && a.code === RETAINED_EARNINGS_CODE)?.id ?? null,
    [accountsQuery.data],
  );
  const selectedId = accountId ?? defaultAccountId;
  const selected = equityOptions.find((option) => option.id === selectedId) ?? null;

  const openPeriods = periodsInYear.filter((p) => p.status === "open");
  const plan = preview.data ?? null;
  const netResult = plan === null ? 0 : Number(plan.netResult);

  async function post() {
    if (selectedId === null || closeYear.isPending) return;
    setError(null);
    try {
      await closeYear.mutateAsync({
        year,
        retainedEarningsAccountId: selectedId,
        memo: memo.trim() === "" ? undefined : memo.trim(),
      });
      setConfirming(false);
      setMemo("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("yearEndClose.failed", { year: String(year) }));
    }
  }

  return (
    <Card className="mb-[18px] p-[16px_18px]">
      <div className="flex flex-wrap items-start justify-between gap-[12px]">
        <div>
          <h2 className="font-display text-[15px] font-bold text-ink">{t("yearEndClose.title", { year: String(year) })}</h2>
          <p className="mt-[4px] max-w-[68ch] text-[12.5px] text-ink-muted">{t("yearEndClose.subtitle")}</p>
        </div>
        {postedEntry.data ? <StatusPill label={t("yearEndClose.closed")} tone="neutral" /> : null}
      </div>

      {postedEntry.isLoading || preview.isLoading ? (
        <p className="mt-[12px] text-[12.5px] text-ink-muted">{t("common.loading")}</p>
      ) : postedEntry.error ? (
        <p role="alert" className="mt-[12px] text-[12.5px] text-danger-ink">
          {postedEntry.error.message}
        </p>
      ) : postedEntry.data ? (
        <div className="mt-[12px] rounded-lg border border-border bg-surface-2 p-[12px_14px] text-[12.5px]">
          <div className="flex flex-wrap items-center gap-[10px]">
            <span className="text-ink-muted">{t("yearEndClose.entry")}</span>
            <span className="mz-num font-semibold text-ink">{postedEntry.data.entryNo ?? postedEntry.data.id}</span>
            <span className="mz-num text-ink-faint">{postedEntry.data.date}</span>
          </div>
          <p className="mt-[8px] text-ink-muted">{t("yearEndClose.correctByReversal")}</p>
        </div>
      ) : plan === null ? (
        <p className="mt-[12px] text-[12.5px] text-ink-muted">{t("yearEndClose.nothingToClose", { year: String(year) })}</p>
      ) : (
        <>
          <div className="mt-[14px] grid grid-cols-2 gap-[12px] lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-surface p-[12px_14px]">
              <div className="text-[11px] font-semibold text-ink-faint">{t("yearEndClose.revenueClosed")}</div>
              <div className="mt-[6px] text-[15px] font-bold text-ink">
                <MoneyDisplay value={Number(plan.revenueClosed)} />
              </div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-[12px_14px]">
              <div className="text-[11px] font-semibold text-ink-faint">{t("yearEndClose.expensesClosed")}</div>
              <div className="mt-[6px] text-[15px] font-bold text-ink">
                <MoneyDisplay value={Number(plan.expensesClosed)} />
              </div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-[12px_14px]">
              <div className="text-[11px] font-semibold text-ink-faint">
                {netResult < 0 ? t("yearEndClose.netLoss") : t("yearEndClose.netProfit")}
              </div>
              <div className={`mt-[6px] text-[15px] font-bold ${netResult < 0 ? "text-danger-ink" : "text-success-ink"}`}>
                <MoneyDisplay value={Math.abs(netResult)} />
              </div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-[12px_14px]">
              <div className="text-[11px] font-semibold text-ink-faint">{t("yearEndClose.accountsToClose")}</div>
              <div className="mz-num mt-[6px] text-[15px] font-bold text-ink">{plan.lines.length}</div>
            </div>
          </div>

          <p className="mt-[10px] text-[12px] text-ink-muted">{t("yearEndClose.willPostOn", { date: plan.date })}</p>

          {openPeriods.length > 0 ? (
            <div className="mt-[10px] rounded-md border border-warning bg-warning-soft px-[12px] py-[9px] text-[12.5px] text-warning-ink">
              {t("yearEndClose.openPeriodsWarning", { count: String(openPeriods.length), year: String(year) })}
            </div>
          ) : null}

          <div className="mt-[14px] grid gap-[12px] lg:grid-cols-2">
            <EntityPicker
              label={t("yearEndClose.retainedEarningsAccount")}
              value={selected}
              onChange={(option) => setAccountId(option?.id ?? null)}
              options={equityOptions}
              placeholder={t("yearEndClose.chooseAnEquityAccount")}
              emptyMessage={t("yearEndClose.noEquityAccounts")}
            />
            <TextField label={t("yearEndClose.memo")} value={memo} onChange={setMemo} />
          </div>

          {error ? (
            <div role="alert" className="mt-[12px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {error}
            </div>
          ) : null}

          <div className="mt-[14px] flex flex-wrap items-center gap-[9px]">
            {confirming ? (
              <>
                <span className="text-[12.5px] font-semibold text-ink">{t("yearEndClose.confirmQuestion", { year: String(year) })}</span>
                <Button variant="primary" disabled={selectedId === null || closeYear.isPending} onClick={post}>
                  {t("yearEndClose.confirm")}
                </Button>
                <Button onClick={() => setConfirming(false)}>{t("common.cancel")}</Button>
              </>
            ) : (
              <Button variant="primary" disabled={selectedId === null} onClick={() => setConfirming(true)}>
                {t("yearEndClose.action")}
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
