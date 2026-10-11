import { useState, type FormEvent } from "react";
import { Button, Card, EmptyState, Money as MoneyDisplay, MoneyInput, SidePanel, StatusPill, type PillTone } from "@mezan/ui";
import type { EmployeeAdvanceStatusDTO } from "@mezan/contracts";
import { useRequestSelfAdvance, useSelfAdvances } from "../data/hr-self-hooks";
import { NumberField, TextField } from "../settings/form-controls";
import { majorOf, sumMajor } from "../lib/money";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/** سلفي — the caller's own advances, their recovery, and a request form. The employee is never named in the body; the server reads it from the login. */

const STATUS_KEY: Record<EmployeeAdvanceStatusDTO, AppTranslationKey> = {
  pending: "advances.status.pending",
  approved: "advances.status.approved",
  disbursed: "advances.status.disbursed",
  repaid: "advances.status.repaid",
  rejected: "advances.status.rejected",
  cancelled: "advances.status.cancelled",
};

const STATUS_TONE: Record<EmployeeAdvanceStatusDTO, PillTone> = {
  pending: "warning",
  approved: "info",
  disbursed: "success",
  repaid: "neutral",
  rejected: "danger",
  cancelled: "neutral",
};

interface Draft {
  amount: number | null;
  installmentCount: number;
  firstDeductionDate: string;
  reason: string;
}

function blankDraft(): Draft {
  return { amount: null, installmentCount: 3, firstDeductionDate: "", reason: "" };
}

export function MyAdvancesScreen() {
  const { t } = useAppTranslation();
  const query = useSelfAdvances();
  const requestAdvance = useRequestSelfAdvance();
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [formError, setFormError] = useState<string | null>(null);

  const advances = query.data?.advances ?? [];
  const linked = query.data?.employeeId != null;
  const outstanding = sumMajor(advances.filter((a) => a.status === "disbursed").map((a) => a.outstanding));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (requestAdvance.isPending) return;
    if (draft.amount === null || draft.amount <= 0 || draft.firstDeductionDate.trim() === "") {
      setFormError(t("self.advanceFormRequired"));
      return;
    }
    setFormError(null);
    try {
      await requestAdvance.mutateAsync({
        amount: draft.amount.toFixed(2),
        installmentCount: draft.installmentCount,
        firstDeductionDate: draft.firstDeductionDate.trim(),
        reason: draft.reason.trim() === "" ? null : draft.reason.trim(),
      });
      setFormOpen(false);
      setDraft(blankDraft());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("self.advanceCouldNotRequest"));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-[16px]">
      <div className="flex flex-wrap items-start justify-between gap-[12px]">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-ink-faint">{t("self.eyebrow")}</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">{t("self.myAdvances")}</h1>
        </div>
        {linked ? (
          <Button
            variant="primary"
            onClick={() => {
              setFormError(null);
              setFormOpen(true);
            }}
          >
            {t("self.requestAdvance")}
          </Button>
        ) : null}
      </div>

      {query.isError ? (
        <Card className="p-[16px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("self.advancesCouldNotLoad")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      {!query.isLoading && !query.isError && !linked ? (
        <Card className="p-[16px]">
          <p className="text-[13px] font-semibold text-ink">{t("self.notLinkedTitle")}</p>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("self.notLinkedBody")}</p>
        </Card>
      ) : null}

      {linked ? (
        <Card className="p-[14px]">
          <div className="text-[11px] font-semibold text-ink-faint">{t("self.totalOutstanding")}</div>
          <MoneyDisplay value={outstanding} className="mt-[4px] text-[20px] font-bold" />
        </Card>
      ) : null}

      {linked && advances.length === 0 && !query.isLoading ? (
        <Card>
          <EmptyState title={t("self.noAdvances")} />
        </Card>
      ) : null}

      {advances.map((advance) => {
        const repaidInstalments = advance.installments.filter((i) => majorOf(i.recovered) >= majorOf(i.amount)).length;
        return (
          <Card key={advance.id} className="flex flex-col gap-[10px] p-[14px]">
            <div className="flex items-center justify-between gap-[8px]">
              <span className="mz-num text-[14px] font-bold text-ink">{advance.number}</span>
              <StatusPill label={t(STATUS_KEY[advance.status])} tone={STATUS_TONE[advance.status]} />
            </div>
            <dl className="grid grid-cols-2 gap-[8px] text-[12px]">
              <div>
                <dt className="text-ink-faint">{t("self.advanceAmount")}</dt>
                <dd>
                  <MoneyDisplay value={majorOf(advance.amount)} />
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint">{t("self.outstanding")}</dt>
                <dd className="font-bold">
                  <MoneyDisplay value={majorOf(advance.outstanding)} />
                </dd>
              </div>
            </dl>
            <div className="mz-num text-[12px] text-ink-muted">{t("self.recoveredOf", { done: String(repaidInstalments), total: String(advance.installmentCount) })}</div>
            {advance.reason ? <div className="text-[12.5px] text-ink">{advance.reason}</div> : null}
            {(advance.repayments ?? []).length > 0 ? (
              <div className="rounded-md border border-border p-[10px]">
                <div className="mb-[6px] text-[11.5px] font-semibold text-ink-faint">{t("self.repaymentsHeading")}</div>
                <ul className="flex flex-col gap-[4px] text-[12px]">
                  {(advance.repayments ?? []).map((r) => (
                    <li key={r.id} className="mz-num flex justify-between gap-[8px]">
                      <span>{r.date}</span>
                      <MoneyDisplay value={majorOf(r.amount)} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        );
      })}

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("self.requestAdvance")}>
        <form onSubmit={submit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("self.advanceAmount")}</div>
            <MoneyInput aria-label={t("self.advanceAmount")} value={draft.amount} onChange={(v) => setDraft((d) => ({ ...d, amount: v }))} />
          </div>
          <NumberField
            label={t("self.instalments")}
            value={draft.installmentCount}
            min={1}
            max={60}
            onChange={(v) => setDraft((d) => ({ ...d, installmentCount: Number.isNaN(v) || v < 1 ? 1 : Math.floor(v) }))}
            hint={t("self.instalmentsHint")}
          />
          <TextField label={t("self.firstDeduction")} type="date" value={draft.firstDeductionDate} onChange={(v) => setDraft((d) => ({ ...d, firstDeductionDate: v }))} />
          <TextField label={t("self.reason")} value={draft.reason} onChange={(v) => setDraft((d) => ({ ...d, reason: v }))} />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={requestAdvance.isPending}>
              {requestAdvance.isPending ? t("self.working") : t("self.submit")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
