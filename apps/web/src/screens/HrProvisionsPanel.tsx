import { useState } from "react";
import { Button, Card, formatMoney, Money as MoneyDisplay, StatusPill } from "@mezan/ui";
import { TextField } from "../settings/form-controls";
import { ApiError } from "../data/hooks";
import { usePostProvision, useProvisionPreview, type HrProvisionKindDTO } from "../data/hr-payroll-hooks";
import { useAppTranslation } from "../i18n";
import { useConfirmAction } from "../lib/use-confirm-action";
import { ReversalDocumentType } from "@mezan/contracts";
import { ReverseDocumentAction } from "../reversal/ReverseDocumentAction";
import { useHrProvisionPostings } from "../reversal/posted-runs-hooks";
import { todayIso } from "../lib/dates";

/**
 * ترحيل مخصص الإجازات — puts the payable-leave obligation into the books. It
 * shows what is owed, what is already booked, and the difference, because only
 * the difference is posted.
 */

function ProvisionRow({ kind, asOfDate }: { kind: HrProvisionKindDTO; asOfDate: string }) {
  const { t } = useAppTranslation();
  const preview = useProvisionPreview(kind, asOfDate);
  const post = usePostProvision();
  const postings = useHrProvisionPostings(kind);
  const confirm = useConfirmAction();
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<string | null>(null);

  const data = preview.data;
  const movement = data ? Number(data.movement) : 0;
  const nothingToPost = data !== undefined && movement === 0;

  function ask() {
    if (!data) return;
    confirm.ask({
      title: t("provisions.confirmTitle"),
      consequence: t("provisions.confirmBody", {
        label: t(`provisions.${kind}`),
        movement: formatMoney(Number(data.movement)),
        expense: data.expenseAccountId,
        liability: data.liabilityAccountId,
      }),
      confirmLabel: t("provisions.post"),
      onConfirm: async () => {
        setError(null);
        try {
          const result = await post.mutateAsync({ kind, asOfDate });
          setPosted(result.journalEntryId);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : t("provisions.couldNotPost"));
        }
      },
    });
  }

  return (
    <div className="border-b border-border py-[12px] last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <div>
          <h3 className="font-display text-[13px] font-bold text-ink">{t(`provisions.${kind}`)}</h3>
          {data ? (
            <p className="mz-num mt-[2px] text-[11.5px] text-ink-faint">
              {data.expenseAccountId} → {data.liabilityAccountId}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-[10px]">
          {nothingToPost ? <StatusPill label={t("provisions.upToDate")} tone="success" /> : null}
          <Button variant="primary" disabled={!data || nothingToPost || post.isPending} onClick={ask}>
            {t("provisions.post")}
          </Button>
        </div>
      </div>

      {data ? (
        <div className="mt-[8px] flex flex-wrap gap-x-[20px] gap-y-[4px] text-[12px]">
          <span className="flex items-center gap-[5px] text-ink-muted">
            {t("provisions.owed")} <MoneyDisplay value={Number(data.computedTotal)} />
          </span>
          <span className="flex items-center gap-[5px] text-ink-muted">
            {t("provisions.booked")} <MoneyDisplay value={Number(data.postedBalance)} />
          </span>
          <span className="flex items-center gap-[5px] font-semibold text-ink">
            {t("provisions.movement")} <MoneyDisplay value={movement} />
          </span>
        </div>
      ) : null}

      {posted ? (
        <p className="mz-num mt-[8px] text-[12px] text-success-ink">{t("provisions.postedAs", { id: posted })}</p>
      ) : null}
      {error ? (
        <div role="alert" className="mt-[8px] rounded-md border border-danger bg-danger-soft px-[10px] py-[8px] text-[12px] text-danger-ink">
          {error}
        </div>
      ) : null}
      {postings.data && postings.data.length > 0 ? (
        <div className="mt-[12px]">
          <h4 className="text-[12px] font-bold text-ink-muted">{t("reversal.provisionPostings.title")}</h4>
          <ul className="mt-[6px] flex flex-col gap-[6px]">
            {postings.data.map((posting) => (
              <li key={posting.journalEntryId} className="flex flex-wrap items-center justify-between gap-[10px] rounded-md border border-border px-[10px] py-[8px] text-[12px]">
                <span className="flex flex-wrap items-center gap-x-[12px] gap-y-[2px]">
                  <span className="mz-num font-semibold text-ink">{posting.asOfDate}</span>
                  <span className="mz-num text-ink-muted">{posting.journalEntryNo ?? posting.journalEntryId}</span>
                  <MoneyDisplay value={posting.movement} />
                  {posting.reversalEntryId ? (
                    <span className="text-ink-faint">{t("reversal.reversedBy", { entry: posting.reversalEntryNo ?? posting.reversalEntryId, date: posting.reversalDate ?? "" })}</span>
                  ) : null}
                </span>
                {posting.reversible ? (
                  <ReverseDocumentAction
                    type={ReversalDocumentType.HrLeaveProvision}
                    target={{ id: posting.journalEntryId, params: { kind, asOfDate: posting.asOfDate }, subject: `${t(`provisions.${kind}`)} ${posting.asOfDate}` }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {confirm.dialog}
    </div>
  );
}

export function HrProvisionsPanel() {
  const { t } = useAppTranslation();
  const [asOfDate, setAsOfDate] = useState(() => todayIso());

  return (
    <Card className="p-[18px_20px]">
      <h2 className="font-display text-[14px] font-bold text-ink">{t("provisions.title")}</h2>
      <p className="mt-[4px] text-[12.5px] leading-relaxed text-ink-muted">{t("provisions.description")}</p>
      <div className="mt-[12px] max-w-[220px]">
        <TextField label={t("provisions.asOfDate")} type="date" value={asOfDate} onChange={setAsOfDate} />
      </div>
      <div className="mt-[6px]">
        <ProvisionRow kind="leave" asOfDate={asOfDate} />
      </div>
    </Card>
  );
}
