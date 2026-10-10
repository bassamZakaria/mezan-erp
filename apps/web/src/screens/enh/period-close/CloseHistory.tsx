import { useMemo } from "react";
import { Card, Skeleton, StatusPill, useFormat } from "@mezan/ui";
import { useUsers } from "../../../data/hooks";
import { useEntityName } from "../../../lib/entity-names";
import { EMPTY } from "../../../lib/empty";
import { useAppTranslation } from "../../../i18n";
import { usePeriodCloseSummaries } from "./hooks";

const HASH_PREVIEW_LENGTH = 16;
const LOADING_LINES = 2;

export interface CloseHistoryProps {
  readonly periodId: string;
}

export function CloseHistory({ periodId }: CloseHistoryProps) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const entityName = useEntityName();
  const summariesQuery = usePeriodCloseSummaries(periodId);
  const users = useUsers().data ?? EMPTY;
  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const summaries = summariesQuery.data ?? EMPTY;

  return (
    <section aria-label={t("periodClose.history")} className="mt-[18px]">
      <h2 className="mb-[8px] font-display text-[14px] font-bold text-ink">{t("periodClose.history")}</h2>
      {summariesQuery.isLoading ? (
        <Skeleton lines={LOADING_LINES} />
      ) : summariesQuery.isError ? (
        <p role="alert" className="text-[12.5px] text-danger-ink">
          {summariesQuery.error.message}
        </p>
      ) : summaries.length === 0 ? (
        <p className="text-[12.5px] text-ink-muted">{t("periodClose.historyEmpty")}</p>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {summaries.map((summary) => (
            <dl key={summary.id} data-seal-valid={summary.sealValid} className="grid gap-[8px_18px] p-[12px_16px] text-[12.5px] sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <dt className="text-ink-faint">{t("periodClose.history.closedAt")}</dt>
                <dd className="mz-num text-ink">{fmt.dateTime(summary.closedAt)}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">{t("periodClose.history.closedBy")}</dt>
                <dd className="text-ink">{entityName(userById.get(summary.closedBy), summary.closedBy)}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">{t("periodClose.history.override")}</dt>
                <dd className={summary.overrideReason ? "text-warning-ink" : "text-ink"}>{summary.overrideReason ?? t("periodClose.history.noOverride")}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">{t("periodClose.history.totals")}</dt>
                <dd className="mz-num text-ink">{fmt.money(summary.closingDebit)}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">{t("periodClose.history.hash")}</dt>
                <dd className="flex flex-wrap items-center gap-[8px]">
                  <span className="mz-num text-ink" dir="ltr" title={summary.sha256}>
                    {summary.sha256.slice(0, HASH_PREVIEW_LENGTH)}…
                  </span>
                  <StatusPill
                    label={t(summary.sealValid ? "periodClose.history.sealValid" : "periodClose.history.sealBroken")}
                    tone={summary.sealValid ? "success" : "danger"}
                  />
                </dd>
              </div>
            </dl>
          ))}
        </Card>
      )}
    </section>
  );
}
