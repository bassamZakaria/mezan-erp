import { useCallback, useMemo, useState } from "react";
import { Button, Card, ConfirmDialog, StatusPill, useFormat } from "@mezan/ui";
import { ForeignResidueKind, Money, isRoundingResidue } from "@mezan/domain";
import { useAccounts } from "../data/hooks";
import { useFxResidueAccess, useFxResidues, useSweepFxResidues, type ForeignResidueDTO } from "../data/fx-residue-hooks";
import { errorMessage } from "../lib/error-message";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

const KIND_LABEL: Readonly<Record<ForeignResidueKind, AppTranslationKey>> = {
  [ForeignResidueKind.Account]: "fxResidue.kind.account",
  [ForeignResidueKind.Item]: "fxResidue.kind.item",
};

function isRounding(row: ForeignResidueDTO): boolean {
  return isRoundingResidue({ ...row, base: Money.fromMajor(row.base) });
}

function magnitude(base: string): string {
  return base.startsWith("-") ? base.slice(1) : base;
}

export function FxResidueCard({ date }: { date: string }) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const access = useFxResidueAccess();
  const residues = useFxResidues();
  const accounts = useAccounts();
  const sweep = useSweepFxResidues();
  const { mutate, isPending } = sweep;
  const [dialogOpen, setDialogOpen] = useState(false);

  const accountName = useMemo(() => {
    const byId = new Map((accounts.data ?? []).map((account) => [account.id, account.nameAr]));
    return (row: ForeignResidueDTO) => (row.kind === ForeignResidueKind.Account ? (byId.get(row.ref) ?? null) : null);
  }, [accounts.data]);

  const openDialog = useCallback(() => setDialogOpen(true), []);
  const closeDialog = useCallback(() => setDialogOpen(false), []);
  const confirm = useCallback(() => {
    if (isPending) return;
    setDialogOpen(false);
    mutate({ date });
  }, [date, isPending, mutate]);

  const rows = residues.data ?? [];
  const result = sweep.data ?? null;
  if (!access.mayView || (rows.length === 0 && result === null && sweep.error === null)) return null;

  const sweepable = rows.filter(isRounding).length;

  return (
    <Card className="mt-[18px] p-[16px_18px]">
      <div className="flex flex-wrap items-start justify-between gap-[12px]">
        <div>
          <h2 className="font-display text-[14px] font-bold text-ink">{t("fxResidue.title")}</h2>
          <p className="mt-[4px] max-w-[76ch] text-[12.5px] text-ink-muted">{t("fxResidue.subtitle")}</p>
        </div>
        {access.maySweep ? (
          <Button disabled={sweepable === 0 || isPending} onClick={openDialog}>
            {isPending ? t("fxResidue.sweeping") : t("fxResidue.sweep")}
          </Button>
        ) : null}
      </div>

      {sweep.error ? (
        <div role="alert" className="mt-[12px] rounded-md border border-danger bg-danger-soft px-[12px] py-[9px] text-[12.5px] text-danger-ink">
          {errorMessage(sweep.error, t("fxResidue.sweepFailed"))}
        </div>
      ) : null}

      {result ? (
        <div role="status" className="mt-[12px] rounded-md border border-border bg-surface-2 px-[12px] py-[9px] text-[12.5px] text-ink">
          <p>{t("fxResidue.sweptSummary", { count: fmt.number(result.sweptCount) })}</p>
          {result.refused.length > 0 ? <p className="mt-[4px] text-ink-muted">{t("fxResidue.refusedSummary", { count: fmt.number(result.refused.length) })}</p> : null}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-[12px] overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
            <thead className="bg-surface-2 text-[11px] font-semibold text-ink-faint">
              <tr>
                <th className="px-[13px] py-[8px] text-start">{t("fxResidue.col.where")}</th>
                <th className="px-[13px] py-[8px] text-start">{t("fxResidue.col.currency")}</th>
                <th className="px-[13px] py-[8px] text-end">{t("fxResidue.col.base")}</th>
                <th className="px-[13px] py-[8px] text-start">{t("fxResidue.col.treatment")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.kind}/${row.ref}/${row.currency}`} className="border-t border-border">
                  <td className="px-[13px] py-[9px] text-ink">
                    <span className="text-ink-muted">{t(KIND_LABEL[row.kind])} </span>
                    <span className="mz-num font-semibold">{row.ref}</span>
                    {accountName(row) ? <span className="text-ink-muted"> — {accountName(row)}</span> : null}
                  </td>
                  <td className="mz-num px-[13px] py-[9px]">{row.currency}</td>
                  <td className="mz-num px-[13px] py-[9px] text-end font-semibold">{isRounding(row) ? fmt.unitCost(magnitude(row.base)) : fmt.money(magnitude(row.base))}</td>
                  <td className="px-[13px] py-[9px]">
                    <StatusPill
                      label={t(isRounding(row) ? "fxResidue.treatment.rounding" : "fxResidue.treatment.atSource")}
                      tone={isRounding(row) ? "info" : "warning"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ConfirmDialog
        open={dialogOpen}
        title={t("fxResidue.confirmTitle")}
        consequence={
          <div className="flex flex-col gap-3">
            <p>{t("fxResidue.confirmBody", { date, count: fmt.number(sweepable) })}</p>
            <p>{t("fxResidue.confirmNotSwept")}</p>
          </div>
        }
        confirmLabel={t("fxResidue.confirm")}
        cancelLabel={t("common.cancel")}
        confirmDisabled={isPending}
        onCancel={closeDialog}
        onConfirm={confirm}
      />
    </Card>
  );
}
