import { memo, useCallback, useMemo } from "react";
import { Button, Card, StatusPill, useFormat } from "@mezan/ui";
import type { PeriodCloseCheckDTO, PeriodCloseFindingDTO, PeriodCloseFixTargetDTO } from "@mezan/contracts";
import { useAppTranslation } from "../../../i18n";
import {
  CHECK_STATUS_KEY,
  CHECK_STATUS_TONE,
  CHECK_TITLE_KEY,
  checkHeadline,
  findingFigure,
  findingStateLabel,
  findingTitle,
  fixScreenLabelKey,
  type FindingFormatters,
} from "./findings";

interface FindingRowProps {
  readonly finding: PeriodCloseFindingDTO;
  readonly format: FindingFormatters;
  readonly onFix: (target: PeriodCloseFixTargetDTO) => void;
}

const FindingRow = memo(function FindingRow({ finding, format, onFix }: FindingRowProps) {
  const { t } = useAppTranslation();
  const { fix } = finding;
  const figure = findingFigure(finding, t, format);
  const openFix = useCallback(() => {
    if (fix) onFix(fix);
  }, [fix, onFix]);

  return (
    <li className="flex flex-wrap items-center justify-between gap-[10px] py-[9px]">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-ink">{findingTitle(finding, t)}</div>
        {figure ? <div className="mz-num mt-[2px] text-[12px] text-ink-muted">{figure}</div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-[9px]">
        <StatusPill label={findingStateLabel(finding, t)} tone={finding.passed ? "success" : "danger"} />
        {fix && !finding.passed ? (
          <Button size="sm" onClick={openFix}>
            {t("periodClose.fix", { screen: t(fixScreenLabelKey(fix)) })}
          </Button>
        ) : null}
      </div>
    </li>
  );
});

interface CheckRowProps {
  readonly check: PeriodCloseCheckDTO;
  readonly format: FindingFormatters;
  readonly onFix: (target: PeriodCloseFixTargetDTO) => void;
}

const CheckRow = memo(function CheckRow({ check, format, onFix }: CheckRowProps) {
  const { t } = useAppTranslation();
  const title = t(CHECK_TITLE_KEY[check.code]);
  return (
    <section aria-label={title} data-check={check.code} data-status={check.status} className="p-[14px_16px]">
      <div className="flex flex-wrap items-start justify-between gap-[10px]">
        <div className="min-w-0">
          <h2 className="font-display text-[14px] font-bold text-ink">{title}</h2>
          <p className="mt-[3px] max-w-[70ch] text-[12.5px] text-ink-muted">{checkHeadline(check, t, format)}</p>
        </div>
        <StatusPill label={t(CHECK_STATUS_KEY[check.status])} tone={CHECK_STATUS_TONE[check.status]} />
      </div>
      {check.findings.length > 0 ? (
        <ul className="mt-[8px] divide-y divide-border border-t border-border">
          {check.findings.map((finding) => (
            <FindingRow key={`${finding.kind}:${finding.ref}`} finding={finding} format={format} onFix={onFix} />
          ))}
        </ul>
      ) : null}
    </section>
  );
});

export interface CheckListProps {
  readonly checks: readonly PeriodCloseCheckDTO[];
  readonly onFix: (target: PeriodCloseFixTargetDTO) => void;
}

export function CheckList({ checks, onFix }: CheckListProps) {
  const fmt = useFormat();
  const format = useMemo<FindingFormatters>(() => ({ money: fmt.money, number: fmt.number, date: fmt.date }), [fmt.money, fmt.number, fmt.date]);
  return (
    <Card className="divide-y divide-border overflow-hidden">
      {checks.map((check) => (
        <CheckRow key={check.code} check={check} format={format} onFix={onFix} />
      ))}
    </Card>
  );
}
