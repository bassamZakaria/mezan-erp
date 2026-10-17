import { useState } from "react";
import { Button, StatusPill } from "@mezan/ui";
import { SalaryPaymentMethodDTO, type EmployeeDTO } from "@mezan/contracts";
import { EGYPT_IBAN_LENGTH, ibanProblemAr, ibanProblemEn, normalizeIban, validateEgyptianIban } from "@mezan/domain";
import { SelectField, TextField } from "../settings/form-controls";
import { useSetSalaryPayment } from "../data/hr-bank-hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { HrPermission, useMayDo } from "./hr-permissions";

export const SALARY_PAYMENT_METHOD_KEY: Record<SalaryPaymentMethodDTO, AppTranslationKey> = {
  [SalaryPaymentMethodDTO.BankTransfer]: "hrPages.salary.method.bank_transfer",
  [SalaryPaymentMethodDTO.Cash]: "hrPages.salary.method.cash",
  [SalaryPaymentMethodDTO.Cheque]: "hrPages.salary.method.cheque",
};

/** طريقة صرف الراتب — how and where this employee's net pay goes; what the payroll bank file reads. */
export function EmployeeSalaryPaymentTab({ employee }: { employee: EmployeeDTO }) {
  const { t, locale } = useAppTranslation();
  const maySeeSalary = useMayDo(HrPermission.ViewSalary);
  const mayEdit = useMayDo(HrPermission.EditEmployee) && maySeeSalary;
  const save = useSetSalaryPayment();
  const account = employee.bankAccount ?? null;
  const [method, setMethod] = useState<SalaryPaymentMethodDTO | "">(employee.salaryPaymentMethod ?? "");
  const [iban, setIban] = useState(account?.iban ?? "");
  const [accountName, setAccountName] = useState(account?.accountName ?? "");
  const [bankName, setBankName] = useState(account?.bankName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const ibanProblem = iban.trim() === "" ? null : validateEgyptianIban(iban);
  const ibanError = ibanProblem ? (locale === "en" ? ibanProblemEn(ibanProblem) : ibanProblemAr(ibanProblem)) : undefined;
  const needsIban = method === SalaryPaymentMethodDTO.BankTransfer && iban.trim() === "";

  async function submit() {
    if (method === "" || save.isPending || ibanProblem || needsIban) return;
    setError(null);
    setSaved(false);
    try {
      await save.mutateAsync({
        id: employee.id,
        body: { method, iban: iban.trim() === "" ? null : normalizeIban(iban), accountName: accountName.trim() || null, bankName: bankName.trim() || null },
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("hrPages.salaryPaymentCouldNotSave"));
    }
  }

  if (!mayEdit) {
    return (
      <dl className="grid grid-cols-1 gap-[12px] text-[12.5px] sm:grid-cols-3">
        <div>
          <dt className="text-ink-faint">{t("hrPages.salary.method")}</dt>
          <dd className="text-ink">{employee.salaryPaymentMethod ? t(SALARY_PAYMENT_METHOD_KEY[employee.salaryPaymentMethod]) : t("hrPages.salary.notRecorded")}</dd>
        </div>
        <div>
          <dt className="text-ink-faint">{t("hrPages.iban")}</dt>
          <dd className="mz-num text-ink" dir="ltr">
            {account?.ibanMasked ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-faint">{t("hrPages.salary.bankName")}</dt>
          <dd className="text-ink">{account?.bankName ?? "—"}</dd>
        </div>
        <p className="text-[11.5px] text-ink-faint sm:col-span-3">{t("hrPages.salary.readOnlyHint")}</p>
      </dl>
    );
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-[14px]">
      {employee.salaryPaymentMethod === null || employee.salaryPaymentMethod === undefined ? (
        <div role="status" className="rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
          {t("hrPages.salary.notRecordedWarning")}
        </div>
      ) : null}
      <div className="grid gap-[12px] sm:grid-cols-2">
        <SelectField
          label={t("hrPages.salary.method")}
          value={method}
          onChange={(v) => setMethod(v as SalaryPaymentMethodDTO)}
          options={[
            { value: "", label: t("employees.select") },
            ...Object.values(SalaryPaymentMethodDTO).map((m) => ({ value: m, label: t(SALARY_PAYMENT_METHOD_KEY[m]) })),
          ]}
        />
        <TextField
          label={t("hrPages.iban")}
          value={iban}
          onChange={setIban}
          placeholder={`EG${"0".repeat(EGYPT_IBAN_LENGTH - 2)}`}
          maxLength={40}
          error={ibanError ?? (needsIban ? t("hrPages.salary.ibanRequired") : undefined)}
          hint={ibanError ? undefined : t("hrPages.salary.ibanHint")}
        />
        <TextField label={t("hrPages.salary.accountName")} value={accountName} onChange={setAccountName} hint={t("hrPages.salary.accountNameHint")} />
        <TextField label={t("hrPages.salary.bankName")} value={bankName} onChange={setBankName} />
      </div>
      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-[10px]">
        {saved ? <StatusPill label={t("hrPages.salary.saved")} tone="success" /> : null}
        <Button variant="primary" disabled={method === "" || Boolean(ibanProblem) || needsIban || save.isPending} onClick={() => void submit()}>
          {t("common.save")}
        </Button>
      </div>
      <p className="text-[11.5px] leading-relaxed text-ink-faint">{t("hrPages.salary.auditHint")}</p>
    </div>
  );
}
