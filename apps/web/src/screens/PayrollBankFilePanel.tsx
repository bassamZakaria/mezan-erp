import { useState } from "react";
import { ENGLISH_LOCALE, Button, Card, Money as MoneyDisplay, StatusPill } from "@mezan/ui";
import { BankFileExceptionReasonDTO, BankFileFormatDTO, type PayrollRunDTO } from "@mezan/contracts";
import { Money } from "@mezan/domain";
import { SelectField, TextField } from "../settings/form-controls";
import { useTreasuryAccounts } from "../data/hooks";
import { downloadTextFile, useBankFileLayouts, useBankFilePreview, useExportBankFile } from "../data/hr-bank-hooks";
import { useEntityName } from "../lib/entity-names";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { todayIso } from "../lib/dates";
import { EMPTY } from "../lib/empty";
import { codedLabel } from "../domain-labels";

const EXCEPTION_REASON_KEY: Record<BankFileExceptionReasonDTO, AppTranslationKey> = {
  [BankFileExceptionReasonDTO.PaidInCash]: "hrPages.bankFile.reason.paid_in_cash",
  [BankFileExceptionReasonDTO.PaidByCheque]: "hrPages.bankFile.reason.paid_by_cheque",
  [BankFileExceptionReasonDTO.NoPaymentMethod]: "hrPages.bankFile.reason.no_payment_method",
  [BankFileExceptionReasonDTO.NoBankAccount]: "hrPages.bankFile.reason.no_bank_account",
  [BankFileExceptionReasonDTO.InvalidIban]: "hrPages.bankFile.reason.invalid_iban",
  [BankFileExceptionReasonDTO.NonPositiveNet]: "hrPages.bankFile.reason.non_positive_net",
  [BankFileExceptionReasonDTO.SubPiasterNet]: "hrPages.bankFile.reason.sub_piaster_net",
  [BankFileExceptionReasonDTO.EmployeeMissing]: "hrPages.bankFile.reason.employee_missing",
};

function Figure({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="border-b border-border p-[13px_15px] last:border-0 sm:border-b-0 sm:border-e">
      <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
      <div className={`mt-[5px] ${tone === "danger" ? "text-danger-ink" : ""}`}>
        <MoneyDisplay value={Number(value)} className="text-[14px] font-bold" />
      </div>
    </div>
  );
}

/** ملف تحويل الرواتب — the transfer file a treasurer uploads to the company's bank, from an approved or disbursed run. */
export function PayrollBankFilePanel({ run }: { run: PayrollRunDTO }) {
  const { t, locale } = useAppTranslation();
  const nameOf = useEntityName();
  const layouts = useBankFileLayouts().data ?? EMPTY;
  const bankAccounts = (useTreasuryAccounts().data ?? EMPTY).filter((account) => account.type === "bank");
  const [format, setFormat] = useState<BankFileFormatDTO>(BankFileFormatDTO.GenericCsv);
  const [valueDate, setValueDate] = useState(todayIso());
  const [treasuryAccountId, setTreasuryAccountId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const request = { format, valueDate: valueDate || undefined, treasuryAccountId: treasuryAccountId || null };
  const preview = useBankFilePreview(run.id, request, true);
  const exportFile = useExportBankFile();
  const layout = layouts.find((l) => l.format === format) ?? null;
  const data = preview.data ?? null;
  const ties = data ? Money.fromMajor(data.totals.bankTotal).add(Money.fromMajor(data.totals.exceptionsTotal)).equals(Money.fromMajor(data.totals.runNet)) : false;

  async function runExport() {
    if (exportFile.isPending) return;
    setNotice(null);
    try {
      const file = await exportFile.mutateAsync({ runId: run.id, body: request });
      downloadTextFile(file.fileName, file.mimeType, file.content);
      setNotice(t("hrPages.bankFile.exported", { fileName: file.fileName, count: file.totals.lineCount, hash: file.sha256.slice(0, 12) }));
    } catch {
      return;
    }
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="grid gap-[10px] sm:grid-cols-3">
        <SelectField
          label={t("hrPages.bankFile.format")}
          value={format}
          onChange={(value) => setFormat(value as BankFileFormatDTO)}
          options={layouts.map((l) => ({ value: l.format, label: `${locale === ENGLISH_LOCALE ? l.labelEn : l.labelAr}${l.verified ? "" : ` — ${t("statutory.unverified")}`}` }))}
        />
        <TextField label={t("hrPages.bankFile.valueDate")} type="date" value={valueDate} onChange={setValueDate} />
        <SelectField
          label={t("hrPages.bankFile.debitAccount")}
          value={treasuryAccountId}
          onChange={setTreasuryAccountId}
          options={[{ value: "", label: t("hrPages.bankFile.noDebitAccount") }, ...bankAccounts.map((a) => ({ value: a.id, label: `${a.code} — ${nameOf(a)}` }))]}
        />
      </div>

      {layout ? (
        <div className="flex flex-wrap items-start gap-[8px] text-[12px] text-ink-muted">
          {layout.verified ? null : <StatusPill label={t("statutory.unverified")} tone="warning" />}
          <p className="min-w-0 flex-1 leading-relaxed">{codedLabel("hrPages.bankFile.description", layout.format, layout.descriptionAr, t)}</p>
        </div>
      ) : null}
      {layout && !layout.verified ? (
        <div role="note" className="rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
          {t("hrPages.bankFile.unverifiedLayout")}
        </div>
      ) : null}

      {preview.isLoading ? <p className="text-[12.5px] text-ink-muted">{t("common.loading")}</p> : null}
      {preview.isError ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {preview.error.message}
        </div>
      ) : null}

      {data ? (
        <>
          <Card className="grid grid-cols-1 overflow-hidden sm:grid-cols-3">
            <Figure label={t("hrPages.bankFile.runNet")} value={data.totals.runNet} />
            <Figure label={t("hrPages.bankFile.bankTotal", { count: data.totals.lineCount })} value={data.totals.bankTotal} />
            <Figure label={t("hrPages.bankFile.exceptionsTotal", { count: data.totals.exceptionCount })} value={data.totals.exceptionsTotal} tone={data.totals.exceptionCount > 0 ? "danger" : undefined} />
          </Card>
          <p role="status" className={`text-[12px] font-semibold ${ties ? "text-success-ink" : "text-danger-ink"}`}>
            {ties ? t("hrPages.bankFile.ties") : t("hrPages.bankFile.doesNotTie")}
          </p>

          {data.exceptions.length > 0 ? (
            <div className="rounded-lg border border-warning p-[14px]">
              <h3 className="mb-[4px] font-display text-[13px] font-bold text-ink">{t("hrPages.bankFile.exceptionsTitle")}</h3>
              <p className="mb-[10px] text-[12px] text-ink-muted">{t("hrPages.bankFile.exceptionsHint")}</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border text-ink-faint">
                      <th className="px-[8px] py-[7px] text-start font-semibold">{t("hrPages.bankFile.employee")}</th>
                      <th className="px-[8px] py-[7px] text-start font-semibold">{t("hrPages.bankFile.reason")}</th>
                      <th className="px-[8px] py-[7px] text-end font-semibold">{t("hrPages.bankFile.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.exceptions.map((e) => (
                      <tr key={e.employeeId} className="border-b border-border last:border-0">
                        <td className="px-[8px] py-[7px]">
                          <div className="font-semibold text-ink">{e.nameAr ?? e.employeeId}</div>
                          {e.employeeCode ? <div className="mz-num text-[11px] text-ink-faint">{e.employeeCode}</div> : null}
                        </td>
                        <td className="px-[8px] py-[7px] text-ink">{t(EXCEPTION_REASON_KEY[e.reason])}</td>
                        <td className="px-[8px] py-[7px] text-end">
                          <MoneyDisplay value={Number(e.amount)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("hrPages.bankFile.linesTitle", { count: data.lines.length })}</h3>
            {data.lines.length === 0 ? (
              <p className="text-[12.5px] text-ink-muted">{t("hrPages.bankFile.noLines")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border text-ink-faint">
                      <th className="px-[8px] py-[7px] text-start font-semibold">#</th>
                      <th className="px-[8px] py-[7px] text-start font-semibold">{t("hrPages.bankFile.employee")}</th>
                      <th className="px-[8px] py-[7px] text-start font-semibold">{t("hrPages.iban")}</th>
                      <th className="px-[8px] py-[7px] text-start font-semibold">{t("hrPages.bankFile.reference")}</th>
                      <th className="px-[8px] py-[7px] text-end font-semibold">{t("hrPages.bankFile.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.employeeId} className="border-b border-border last:border-0">
                        <td className="mz-num px-[8px] py-[7px] text-ink-faint">{l.sequence}</td>
                        <td className="px-[8px] py-[7px]">
                          <div className="font-semibold text-ink">{locale === ENGLISH_LOCALE ? l.nameLatin : l.nameAr}</div>
                          <div className="mz-num text-[11px] text-ink-faint">{l.employeeCode}</div>
                        </td>
                        <td className="mz-num px-[8px] py-[7px] text-ink" dir="ltr">
                          {l.ibanMasked}
                        </td>
                        <td className="mz-num px-[8px] py-[7px] text-ink-muted" dir="ltr">
                          {l.reference}
                        </td>
                        <td className="px-[8px] py-[7px] text-end">
                          <MoneyDisplay value={Number(l.amount)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}

      {exportFile.isError ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {exportFile.error.message}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="rounded-md border border-success bg-success-soft px-[12px] py-[10px] text-[12.5px] text-success-ink">
          {notice}
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button variant="primary" disabled={!data || data.lines.length === 0 || !ties || exportFile.isPending} onClick={() => void runExport()}>
          {exportFile.isPending ? t("common.loading") : t("hrPages.bankFile.export")}
        </Button>
      </div>
    </div>
  );
}
