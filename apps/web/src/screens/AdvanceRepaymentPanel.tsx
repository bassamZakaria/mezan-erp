import { useState } from "react";
import { Button, Money as MoneyDisplay, MoneyInput } from "@mezan/ui";
import type { EmployeeAdvanceDTO } from "@mezan/contracts";
import { useAdvanceRepayable, useRepayEmployeeAdvance } from "../data/hr-self-hooks";
import { SelectField, TextField } from "../settings/form-controls";
import { majorOf, scaledOf } from "../lib/money";
import { useAppTranslation } from "../i18n";

interface Option {
  readonly value: string;
  readonly label: string;
}

function newRepaymentId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `RP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * سداد السلفة خارج الرواتب. The repayment id is minted once per attempt and kept
 * after a refusal, so a retry after a held voucher is approved reuses it and the
 * server applies the repayment once.
 */
export function AdvanceRepaymentPanel({ advance, treasuryAccounts, branches }: { advance: EmployeeAdvanceDTO; treasuryAccounts: readonly Option[]; branches: readonly Option[] }) {
  const { t } = useAppTranslation();
  const repayable = useAdvanceRepayable(advance.id);
  const repay = useRepayEmployeeAdvance();
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<"cash" | "bank">("cash");
  const [treasuryAccountId, setTreasuryAccountId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [repaymentId, setRepaymentId] = useState(newRepaymentId);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const pending = repayable.data ? scaledOf(repayable.data.pendingPayrollRecovery) : 0n;

  async function submit() {
    if (repay.isPending) return;
    if (amount === null || amount <= 0 || treasuryAccountId === "" || branchId === "") {
      setError(t("advances.repayRequired"));
      return;
    }
    setError(null);
    setDone(false);
    try {
      await repay.mutateAsync({
        id: advance.id,
        body: {
          repaymentId,
          amount: amount.toFixed(2),
          treasuryAccountId,
          branchId,
          paymentMethod: method,
          ...(date.trim() === "" ? {} : { date: date.trim() }),
          note: note.trim() === "" ? null : note.trim(),
        },
      });
      setDone(true);
      setAmount(null);
      setNote("");
      setRepaymentId(newRepaymentId());
      void repayable.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("advances.repayCouldNotRecord"));
    }
  }

  return (
    <div className="flex flex-col gap-[10px] rounded-lg border border-border p-[14px]">
      <h3 className="font-display text-[13px] font-bold text-ink">{t("advances.repayTitle")}</h3>
      <p className="text-[12px] text-ink-muted">{t("advances.repayHint")}</p>
      {repayable.data ? (
        <div className="flex flex-col gap-[2px] text-[12.5px]">
          <div className="flex items-center justify-between gap-[8px]">
            <span className="text-ink-faint">{t("advances.repayable")}</span>
            <MoneyDisplay value={majorOf(repayable.data.repayable)} className="font-bold" />
          </div>
          {pending > 0n ? <p className="text-[11.5px] text-warning-ink">{t("advances.pendingPayrollRecovery", { amount: majorOf(repayable.data.pendingPayrollRecovery).toFixed(2) })}</p> : null}
        </div>
      ) : null}
      <div>
        <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("advances.repayAmount")}</div>
        <MoneyInput aria-label={t("advances.repayAmount")} value={amount} onChange={setAmount} disabled={repay.isPending} />
      </div>
      <SelectField
        label={t("advances.repayMethod")}
        value={method}
        onChange={(v) => setMethod(v === "bank" ? "bank" : "cash")}
        options={[
          { value: "cash", label: t("advances.methodCash") },
          { value: "bank", label: t("advances.methodBank") },
        ]}
      />
      <SelectField label={t("advances.treasuryAccount")} value={treasuryAccountId} onChange={setTreasuryAccountId} options={[{ value: "", label: t("advances.choose") }, ...treasuryAccounts]} />
      <SelectField label={t("advances.branch")} value={branchId} onChange={setBranchId} options={[{ value: "", label: t("advances.choose") }, ...branches]} />
      <TextField label={t("advances.repayDate")} type="date" value={date} onChange={setDate} />
      <TextField label={t("advances.repayNote")} value={note} onChange={setNote} />
      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      {done ? (
        <div role="status" className="rounded-md border border-success bg-success-soft px-[12px] py-[10px] text-[12.5px] text-success-ink">
          {t("advances.repayRecorded")}
        </div>
      ) : null}
      <Button variant="primary" disabled={repay.isPending} onClick={() => void submit()}>
        {repay.isPending ? t("self.working") : t("advances.repaySubmit")}
      </Button>
    </div>
  );
}
