import { useState } from "react";
import { Button, Card, Checkbox, EmptyState, Skeleton, StatCard, StatusPill, useFormat, type PillTone } from "@mezan/ui";
import { SequenceCoverageCode, SequenceGapExplanationCode, type EvidencePeriodDTO, type SequenceSeriesDTO } from "@mezan/contracts";
import { useAppTranslation } from "../../../i18n";
import { Notice, NoticeTone } from "../provisioning/Notice";
import { useSequenceGaps } from "./hooks";
import { EvidenceCode, PeriodFields, defaultPeriod, isValidPeriod, useGrants } from "./PeriodFields";
import { SEQUENCE_DEFINITIONS } from "@mezan/domain";
import { sequenceLabel } from "../../../domain-labels";

const SKELETON_LINES = 6;

const EXPLANATION_TONE: Readonly<Record<SequenceGapExplanationCode, PillTone>> = {
  [SequenceGapExplanationCode.CounterAdjusted]: "info",
  [SequenceGapExplanationCode.DraftDeleted]: "warning",
  [SequenceGapExplanationCode.Unexplained]: "danger",
};

function sequenceName(labelAr: string, t: ReturnType<typeof useAppTranslation>["t"]): string {
  const definition = SEQUENCE_DEFINITIONS.find((entry) => entry.labelAr === labelAr);
  return definition ? sequenceLabel(definition, t) : labelAr;
}

function SeriesCard({ series, onlyInPeriod }: { readonly series: SequenceSeriesDTO; readonly onlyInPeriod: boolean }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const gaps = series.gaps.filter((gap) => !onlyInPeriod || gap.inWindow);
  const voided = series.voided.filter((entry) => !onlyInPeriod || entry.inWindow);
  return (
    <Card className="flex flex-col gap-[8px] p-[14px]">
      <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
        <h3 className="text-[14px] font-bold text-ink">
          {sequenceName(series.labelAr, t)} <span className="font-mono text-[12px] text-ink-muted" dir="ltr">{series.series}</span>
        </h3>
        <dl className="flex flex-wrap gap-[12px] text-[12px] text-ink-muted">
          <div><dt className="inline">{t("sequenceGaps.col.issued")}: </dt><dd className="inline mz-num text-ink">{format.number(series.issued)}</dd></div>
          <div><dt className="inline">{t("sequenceGaps.col.found")}: </dt><dd className="inline mz-num text-ink">{format.number(series.documentsFound)}</dd></div>
          <div><dt className="inline">{t("sequenceGaps.col.voided")}: </dt><dd className="inline mz-num text-ink">{format.number(series.voidedCount)}</dd></div>
          <div><dt className="inline">{t("sequenceGaps.col.missing")}: </dt><dd className="inline mz-num text-ink">{format.number(series.missingCount)}</dd></div>
        </dl>
      </div>
      {series.coverage === SequenceCoverageCode.CounterOnly ? <p className="text-[12px] text-ink-muted">{t("sequenceGaps.counterOnly")}</p> : null}
      {gaps.length > 0 ? (
        <ul className="flex flex-col gap-[4px] text-[12.5px]">
          {gaps.map((gap) => (
            <li key={`${gap.firstNumber}-${gap.explanation}`} className="flex flex-wrap items-center gap-[8px]">
              <span className="font-mono" dir="ltr">{t("sequenceGaps.range", { first: gap.firstNumber, last: gap.lastNumber, count: format.number(gap.count) })}</span>
              <StatusPill tone={EXPLANATION_TONE[gap.explanation]} label={t(`sequenceGaps.explanation.${gap.explanation}`)} />
              {gap.reference ? <span className="text-[11.5px] text-ink-muted">{t("sequenceGaps.reference", { reference: gap.reference })}</span> : null}
              {gap.inWindow ? null : <span className="text-[11.5px] text-ink-muted">{t("sequenceGaps.outsidePeriod")}</span>}
            </li>
          ))}
        </ul>
      ) : null}
      {series.anomalies.length > 0 ? (
        <ul className="flex flex-col gap-[4px] text-[12.5px]">
          {series.anomalies.map((anomaly) => (
            <li key={`${anomaly.kind}-${anomaly.number}`} className="flex flex-wrap items-center gap-[8px] text-danger-ink">
              <span className="font-mono" dir="ltr">{anomaly.number}</span>
              <span>{t(`sequenceGaps.anomaly.${anomaly.kind}`)}</span>
              <span className="font-mono text-[11.5px] text-ink-muted" dir="ltr">{anomaly.sources.join(", ")}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {voided.length > 0 ? (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-ink-muted">{t("sequenceGaps.voidedList")} ({format.number(voided.length)})</summary>
          <p className="mt-[4px] font-mono leading-[1.8]" dir="ltr">{voided.map((entry) => entry.number).join("  ")}</p>
        </details>
      ) : null}
    </Card>
  );
}

function Report({ period }: { readonly period: EvidencePeriodDTO }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const report = useSequenceGaps(period);
  const [onlyInPeriod, setOnlyInPeriod] = useState(true);
  if (report.isPending) return <Skeleton lines={SKELETON_LINES} />;
  if (report.isError) return <Notice notice={{ tone: NoticeTone.Danger, message: report.error.message }} />;
  const { totals } = report.data;
  const flagged = report.data.series.filter((series) => series.coverage === SequenceCoverageCode.CounterOnly || series.anomalies.length > 0 || series.gaps.some((gap) => !onlyInPeriod || gap.inWindow) || series.voided.some((entry) => !onlyInPeriod || entry.inWindow));
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="grid grid-cols-2 gap-[10px] sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label={t("sequenceGaps.stat.sequences")} value={<span className="mz-num">{format.number(totals.sequences)}</span>} />
        <StatCard label={t("sequenceGaps.stat.issued")} value={<span className="mz-num">{format.number(totals.issued)}</span>} />
        <StatCard label={t("sequenceGaps.stat.voided")} value={<span className="mz-num">{format.number(totals.voided)}</span>} />
        <StatCard label={t("sequenceGaps.stat.missing")} value={<span className="mz-num">{format.number(totals.missing)}</span>} />
        <StatCard label={t("sequenceGaps.stat.unexplained")} value={<span className="mz-num">{format.number(totals.unexplained)}</span>} valueTone={totals.unexplained > 0 ? "danger" : "default"} />
        <StatCard label={t("sequenceGaps.stat.anomalies")} value={<span className="mz-num">{format.number(totals.anomalies)}</span>} valueTone={totals.anomalies > 0 ? "danger" : "default"} />
      </div>
      <Checkbox label={t("sequenceGaps.onlyInPeriod")} checked={onlyInPeriod} onChange={(e) => setOnlyInPeriod(e.target.checked)} />
      {totals.missing === 0 && totals.anomalies === 0 ? <p role="status" className="text-[12.5px] text-success-ink">{t("sequenceGaps.allClear")}</p> : null}
      <div className="flex flex-col gap-[10px]">
        {flagged.map((series) => (
          <SeriesCard key={`${series.code}-${series.period ?? ""}-${series.scope ?? ""}`} series={series} onlyInPeriod={onlyInPeriod} />
        ))}
      </div>
    </div>
  );
}

export function SequenceGapsScreen() {
  const { t } = useAppTranslation();
  const [mayView] = useGrants(EvidenceCode.SequenceGaps);
  const [draft, setDraft] = useState(defaultPeriod);
  const [period, setPeriod] = useState(defaultPeriod);
  if (!mayView) return <EmptyState title={t("sequenceGaps.noAccessTitle")} description={t("sequenceGaps.noAccessBody")} />;
  const valid = isValidPeriod(draft);
  return (
    <div className="flex w-full min-w-0 flex-col gap-[16px]">
      <div>
        <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("sequenceGaps.title")}</h1>
        <p className="mt-[5px] max-w-[80ch] text-[12.5px] text-ink-muted">{t("sequenceGaps.subtitle")}</p>
      </div>
      <Card className="flex flex-wrap items-end gap-[12px] p-[16px]">
        <PeriodFields value={draft} onChange={setDraft} />
        <Button variant="primary" disabled={!valid} onClick={() => setPeriod(draft)}>
          {t("sequenceGaps.run")}
        </Button>
        {valid ? null : <p className="text-[12px] text-danger-ink">{t("evidence.invalidPeriod")}</p>}
      </Card>
      <Report period={period} />
    </div>
  );
}
