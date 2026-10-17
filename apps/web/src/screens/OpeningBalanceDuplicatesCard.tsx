import { useCallback, useState } from "react";
import { Button, Card, ConfirmDialog, useFormat } from "@mezan/ui";
import {
  OpeningBalancePartyKind,
  useOpeningBalanceDuplicates,
  useOpeningBalanceDuplicatesAccess,
  useRepairOpeningBalanceDuplicate,
  type OpeningBalanceDuplicateDTO,
} from "../data/opening-balance-duplicates-hooks";
import { errorMessage } from "../lib/error-message";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

const KIND_LABEL: Readonly<Record<OpeningBalancePartyKind, AppTranslationKey>> = {
  [OpeningBalancePartyKind.Customer]: "openingDuplicates.kind.customer",
  [OpeningBalancePartyKind.Supplier]: "openingDuplicates.kind.supplier",
};

const CONTROL_ACCOUNT_LABEL: Readonly<Record<OpeningBalancePartyKind, AppTranslationKey>> = {
  [OpeningBalancePartyKind.Customer]: "openingDuplicates.control.customer",
  [OpeningBalancePartyKind.Supplier]: "openingDuplicates.control.supplier",
};

export function OpeningBalanceDuplicatesCard() {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const access = useOpeningBalanceDuplicatesAccess();
  const duplicates = useOpeningBalanceDuplicates();
  const { mutate } = useRepairOpeningBalanceDuplicate();
  const [confirming, setConfirming] = useState<OpeningBalanceDuplicateDTO | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nothingToReverse, setNothingToReverse] = useState(false);

  const closeDialog = useCallback(() => setConfirming(null), []);

  const repair = useCallback(() => {
    if (confirming === null || pendingKey !== null) return;
    const target = confirming;
    setConfirming(null);
    setError(null);
    setNothingToReverse(false);
    setPendingKey(target.key);
    mutate(
      { kind: target.kind, partyId: target.partyId },
      {
        onSuccess: (result) => setNothingToReverse(!result.repaired),
        onError: (err) => setError(errorMessage(err, t("openingDuplicates.repairFailed"))),
        onSettled: () => setPendingKey(null),
      },
    );
  }, [confirming, mutate, pendingKey, t]);

  const rows = duplicates.data ?? [];
  if (!access.mayView || (rows.length === 0 && error === null && !nothingToReverse)) return null;

  return (
    <Card className="mb-[16px] border-danger p-[16px_18px]">
      <h2 className="font-display text-[15px] font-bold text-ink">{t("openingDuplicates.title")}</h2>
      <p className="mt-[4px] max-w-[76ch] text-[12.5px] text-ink-muted">{t("openingDuplicates.subtitle")}</p>

      {error ? (
        <div role="alert" className="mt-[12px] rounded-md border border-danger bg-danger-soft px-[12px] py-[9px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      {nothingToReverse ? (
        <div role="status" className="mt-[12px] rounded-md border border-border bg-surface-2 px-[12px] py-[9px] text-[12.5px] text-ink-muted">
          {t("openingDuplicates.nothingToReverse")}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-[12px] overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
            <thead className="bg-surface-2 text-[11px] font-semibold text-ink-faint">
              <tr>
                <th className="px-[13px] py-[8px] text-start">{t("openingDuplicates.col.kind")}</th>
                <th className="px-[13px] py-[8px] text-start">{t("openingDuplicates.col.code")}</th>
                <th className="px-[13px] py-[8px] text-start">{t("openingDuplicates.col.name")}</th>
                <th className="px-[13px] py-[8px] text-end">{t("openingDuplicates.col.wanted")}</th>
                <th className="px-[13px] py-[8px] text-end">{t("openingDuplicates.col.posted")}</th>
                <th className="px-[13px] py-[8px] text-end">{t("openingDuplicates.col.excess")}</th>
                <th className="px-[13px] py-[8px] text-end">{t("openingDuplicates.col.entries")}</th>
                <th className="px-[13px] py-[8px] text-end" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-border">
                  <td className="px-[13px] py-[9px]">{t(KIND_LABEL[row.kind])}</td>
                  <td className="mz-num px-[13px] py-[9px]">{row.code}</td>
                  <td className="px-[13px] py-[9px] font-semibold text-ink">{row.nameAr}</td>
                  <td className="mz-num px-[13px] py-[9px] text-end">{fmt.money(Math.abs(row.wanted))}</td>
                  <td className="mz-num px-[13px] py-[9px] text-end">{fmt.money(Math.abs(row.totalPosted))}</td>
                  <td className="mz-num px-[13px] py-[9px] text-end font-bold text-danger-ink">{fmt.money(Math.abs(row.excess))}</td>
                  <td className="mz-num px-[13px] py-[9px] text-end">{fmt.number(row.entryCount)}</td>
                  <td className="px-[13px] py-[9px] text-end">
                    {access.mayRepair ? (
                      <Button size="sm" variant="danger-outline" disabled={pendingKey === row.key} onClick={() => setConfirming(row)}>
                        {pendingKey === row.key ? t("openingDuplicates.repairing") : t("openingDuplicates.repair")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming !== null}
        tone="danger"
        title={t("openingDuplicates.confirmTitle", { name: confirming?.nameAr ?? "" })}
        consequence={
          confirming ? (
            <div className="flex flex-col gap-3">
              <p>
                {t("openingDuplicates.confirmBody", {
                  excess: fmt.money(Math.abs(confirming.excess)),
                  account: t(CONTROL_ACCOUNT_LABEL[confirming.kind]),
                  wanted: fmt.money(Math.abs(confirming.wanted)),
                })}
              </p>
              <p>{t("openingDuplicates.confirmNeverEdited")}</p>
            </div>
          ) : null
        }
        confirmLabel={t("openingDuplicates.confirm")}
        cancelLabel={t("common.cancel")}
        onCancel={closeDialog}
        onConfirm={repair}
      />
    </Card>
  );
}
