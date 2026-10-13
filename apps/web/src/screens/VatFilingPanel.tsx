import { useCallback, useMemo, useState } from "react";
import { Button, Card, ConfirmDialog, StatusPill, useFormat } from "@mezan/ui";
import { VatFilingState, type VatFilingDTO } from "@mezan/contracts";
import { vatNetPayable, type VatReturnRow } from "@mezan/domain";
import { TextAreaField, TextField } from "../settings/form-controls";
import { useUsers } from "../data/hooks";
import { useAmendVatFiling, useRecordVatFiling, useVatFilingAccess, useVatFilings } from "../data/vat-filing-hooks";
import { displayName } from "../display-name";
import { errorMessage } from "../lib/error-message";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONEY_DECIMALS = 2;

const STATE_LABEL: Readonly<Record<VatFilingState, AppTranslationKey>> = {
  [VatFilingState.Filed]: "vatFiling.state.filed",
  [VatFilingState.Amended]: "vatFiling.state.amended",
};

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isWholeMonthWindow(periodFrom: string, periodTo: string): boolean {
  const from = ISO_DAY.exec(periodFrom);
  const to = ISO_DAY.exec(periodTo);
  if (!from || !to || periodFrom > periodTo) return false;
  return Number(from[3]) === 1 && Number(to[3]) === lastDayOfMonth(Number(to[1]), Number(to[2]));
}

function covers(filing: VatFilingDTO, periodFrom: string, periodTo: string): boolean {
  return filing.status === VatFilingState.Filed && filing.periodFrom <= periodFrom && filing.periodTo >= periodTo;
}

function overlaps(filing: VatFilingDTO, periodFrom: string, periodTo: string): boolean {
  return filing.status === VatFilingState.Filed && filing.periodFrom <= periodTo && filing.periodTo >= periodFrom;
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-[12px] border-t border-border py-[7px] first:border-t-0">
      <span className="text-ink-muted">{label}</span>
      <span className="mz-num font-bold text-ink">{value}</span>
    </div>
  );
}

export interface VatFilingActionProps {
  readonly rows: readonly VatReturnRow[];
  readonly periodFrom: string;
  readonly periodTo: string;
}

export function VatFilingAction({ rows, periodFrom, periodTo }: VatFilingActionProps) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const access = useVatFilingAccess();
  const filings = useVatFilings();
  const { mutateAsync, isPending } = useRecordVatFiling();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [referenceNo, setReferenceNo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const figures = useMemo(() => {
    const outputTax = vatNetPayable(rows.filter((row) => row.side === "output"));
    const inputTax = Math.abs(vatNetPayable(rows.filter((row) => row.side === "input")));
    return { outputTax, inputTax, net: vatNetPayable(rows) };
  }, [rows]);

  const openDialog = useCallback(() => {
    setError(null);
    setDialogOpen(true);
  }, []);
  const closeDialog = useCallback(() => setDialogOpen(false), []);

  const file = useCallback(async () => {
    if (isPending) return;
    setDialogOpen(false);
    try {
      const reference = referenceNo.trim();
      await mutateAsync({
        id: crypto.randomUUID(),
        periodFrom,
        periodTo,
        netAmount: figures.net.toFixed(MONEY_DECIMALS),
        referenceNo: reference === "" ? null : reference,
      });
      setReferenceNo("");
    } catch (err) {
      setError(errorMessage(err, t("vatFiling.fileFailed")));
    }
  }, [figures.net, isPending, mutateAsync, periodFrom, periodTo, referenceNo, t]);
  const onConfirm = useCallback(() => void file(), [file]);

  if (!access.mayView || !filings.data) return null;

  const filed = filings.data.some((filing) => covers(filing, periodFrom, periodTo));
  const partlyFiled = !filed && filings.data.some((filing) => overlaps(filing, periodFrom, periodTo));
  const wholeMonths = isWholeMonthWindow(periodFrom, periodTo);
  const period = { from: periodFrom, to: periodTo };

  return (
    <div className="mt-[10px] rounded-lg border border-border bg-surface p-[13px_16px] text-[12.5px]">
      {filed ? (
        <div className="flex flex-wrap items-center gap-[10px]">
          <StatusPill label={t("vatFiling.periodFiled")} tone="success" />
          <span className="text-ink-muted">{t("vatFiling.periodFiledNote")}</span>
        </div>
      ) : partlyFiled ? (
        <span className="text-ink-muted">{t("vatFiling.periodPartlyFiled")}</span>
      ) : access.mayFile ? (
        <div className="flex flex-wrap items-center gap-[10px]">
          <Button variant="primary" disabled={!wholeMonths || isPending} onClick={openDialog}>
            {isPending ? t("vatFiling.filing") : t("vatFiling.action")}
          </Button>
          <span className="max-w-[68ch] text-ink-muted">{t(wholeMonths ? "vatFiling.actionHint" : "vatFiling.wholeMonthsOnly")}</span>
        </div>
      ) : (
        <span className="text-ink-muted">{t("vatFiling.periodOpen")}</span>
      )}

      {error ? (
        <div role="alert" className="mt-[10px] rounded-md border border-danger bg-danger-soft px-[12px] py-[9px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <ConfirmDialog
        open={dialogOpen}
        tone="danger"
        title={t("vatFiling.confirmTitle", period)}
        consequence={
          <div className="flex flex-col gap-3">
            <p>{t("vatFiling.locks")}</p>
            <div className="rounded-md border border-border bg-surface-2 px-[12px] py-[4px]">
              <Figure label={t("vatFiling.outputTax")} value={fmt.money(figures.outputTax)} />
              <Figure label={t("vatFiling.inputTax")} value={fmt.money(figures.inputTax)} />
              <Figure
                label={t(figures.net >= 0 ? "finReports.netTaxPayable" : "finReports.netTaxRecoverable")}
                value={fmt.money(Math.abs(figures.net))}
              />
            </div>
            <TextField label={t("vatFiling.referenceNo")} value={referenceNo} onChange={setReferenceNo} />
          </div>
        }
        confirmLabel={t("vatFiling.confirm")}
        cancelLabel={t("common.cancel")}
        confirmDisabled={isPending}
        onCancel={closeDialog}
        onConfirm={onConfirm}
      />
    </div>
  );
}

export function VatFilingsList() {
  const { t, locale } = useAppTranslation();
  const fmt = useFormat();
  const access = useVatFilingAccess();
  const filings = useVatFilings();
  const users = useUsers();
  const { mutate } = useAmendVatFiling();
  const [amending, setAmending] = useState<VatFilingDTO | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const nameOf = useMemo(() => {
    const byId = new Map((users.data ?? []).map((user) => [user.id, displayName(user, locale)]));
    return (userId: string) => byId.get(userId) ?? userId;
  }, [users.data, locale]);

  const closeDialog = useCallback(() => setAmending(null), []);

  const onConfirm = useCallback(() => {
    if (amending === null || pendingId !== null) return;
    const target = amending;
    setAmending(null);
    setPendingId(target.id);
    setError(null);
    mutate(
      { id: target.id, reason: reason.trim() },
      {
        onSuccess: () => setReason(""),
        onError: (err) => setError(errorMessage(err, t("vatFiling.amendFailed"))),
        onSettled: () => setPendingId(null),
      },
    );
  }, [amending, mutate, pendingId, reason, t]);

  if (!access.mayView) return null;

  const rows = [...(filings.data ?? [])].sort((a, b) => b.periodFrom.localeCompare(a.periodFrom));

  return (
    <Card className="mt-[18px] p-[16px_18px]">
      <h2 className="font-display text-[15px] font-bold text-ink">{t("vatFiling.listTitle")}</h2>
      <p className="mt-[4px] max-w-[72ch] text-[12.5px] text-ink-muted">{t("vatFiling.listSubtitle")}</p>

      {error ? (
        <div role="alert" className="mt-[12px] rounded-md border border-danger bg-danger-soft px-[12px] py-[9px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      {filings.isLoading ? (
        <p className="mt-[12px] text-[12.5px] text-ink-muted">{t("common.loading")}</p>
      ) : filings.error ? (
        <p role="alert" className="mt-[12px] text-[12.5px] text-danger-ink">
          {filings.error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-[12px] text-[12.5px] text-ink-muted">{t("vatFiling.empty")}</p>
      ) : (
        <div className="mt-[12px] overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
            <thead className="bg-surface-2 text-[11px] font-semibold text-ink-faint">
              <tr>
                <th className="px-[13px] py-[8px] text-start">{t("vatFiling.col.period")}</th>
                <th className="px-[13px] py-[8px] text-end">{t("vatFiling.col.net")}</th>
                <th className="px-[13px] py-[8px] text-start">{t("vatFiling.col.reference")}</th>
                <th className="px-[13px] py-[8px] text-start">{t("vatFiling.col.status")}</th>
                <th className="px-[13px] py-[8px] text-start">{t("vatFiling.col.filedBy")}</th>
                <th className="px-[13px] py-[8px] text-start">{t("vatFiling.col.filedAt")}</th>
                <th className="px-[13px] py-[8px] text-end" />
              </tr>
            </thead>
            <tbody>
              {rows.map((filing) => (
                <tr key={filing.id} className="border-t border-border align-top">
                  <td className="mz-num whitespace-nowrap px-[13px] py-[9px] text-ink">
                    {filing.periodFrom} — {filing.periodTo}
                  </td>
                  <td className="mz-num px-[13px] py-[9px] text-end font-semibold">{fmt.money(filing.netAmount)}</td>
                  <td className="mz-num px-[13px] py-[9px]">{filing.referenceNo ?? "—"}</td>
                  <td className="px-[13px] py-[9px]">
                    <StatusPill label={t(STATE_LABEL[filing.status])} tone={filing.status === VatFilingState.Filed ? "success" : "warning"} />
                    {filing.amendmentReason ? (
                      <div className="mt-[5px] max-w-[36ch] text-[12px] text-ink-muted">
                        {t("vatFiling.amendedBecause", { reason: filing.amendmentReason })}
                        {filing.amendedAt ? <span> · {fmt.dateTime(filing.amendedAt)}</span> : null}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-[13px] py-[9px]">{nameOf(filing.filedBy)}</td>
                  <td className="whitespace-nowrap px-[13px] py-[9px] tabular-nums">{fmt.dateTime(filing.filedAt)}</td>
                  <td className="px-[13px] py-[9px] text-end">
                    {access.mayFile && filing.status === VatFilingState.Filed ? (
                      <Button
                        variant="danger-outline"
                        disabled={pendingId === filing.id}
                        onClick={() => {
                          setReason("");
                          setAmending(filing);
                        }}
                      >
                        {pendingId === filing.id ? t("vatFiling.amending") : t("vatFiling.amend")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={amending !== null}
        tone="danger"
        title={t("vatFiling.amendTitle", { from: amending?.periodFrom ?? "", to: amending?.periodTo ?? "" })}
        consequence={
          <div className="flex flex-col gap-3">
            <p>{t("vatFiling.amendBody")}</p>
            <TextAreaField label={t("vatFiling.amendReason")} value={reason} onChange={setReason} rows={3} />
          </div>
        }
        confirmLabel={t("vatFiling.amend")}
        cancelLabel={t("common.cancel")}
        confirmDisabled={reason.trim() === ""}
        onCancel={closeDialog}
        onConfirm={onConfirm}
      />
    </Card>
  );
}
