import { useState } from "react";
import { ReportRunner } from "@mezan/ui";
import {
  createTrialBalanceReport,
  runReport,
  sampleReportAccounts,
  sampleReportJournalEntries,
  type RunReportOutcome,
  type TrialBalanceContext,
  type TrialBalanceParams,
  type TrialBalanceRow,
} from "@mezan/domain";

/**
 * ميزان المراجعة (docs/catalog/08-reports.md) wired end to end over the
 * report engine's sample GL data (@mezan/domain/reports/sample-gl-data.ts) —
 * the one example report proving the `ReportDefinition` abstraction. The
 * other 32 catalog reports become thin `ReportDefinition`s later; nothing
 * about this screen is trial-balance-specific except the definition + the
 * data it aggregates over.
 */

const TODAY = "2026-08-22";
const definition = createTrialBalanceReport(TODAY);
const context: TrialBalanceContext = { accounts: sampleReportAccounts, journalEntries: sampleReportJournalEntries };

export function TrialBalanceReportScreen() {
  const [params, setParams] = useState<Record<string, string>>({ asOfDate: definition.defaultParams.asOfDate });
  const [outcome, setOutcome] = useState<RunReportOutcome<TrialBalanceParams, TrialBalanceRow> | null>(null);

  function handleRun() {
    setOutcome(runReport(definition, params, context));
  }

  const fieldErrors =
    outcome && !outcome.ok ? Object.fromEntries(outcome.errors.map((e) => [e.field, e.message])) : undefined;
  const result = outcome && outcome.ok ? { rows: outcome.rows, groups: outcome.groups, grandTotals: outcome.grandTotals, reconciliation: outcome.reconciliation } : null;

  return (
    <ReportRunner
      eyebrow="المحاسبة · التقارير المالية"
      title={definition.titleAr}
      description={definition.descriptionAr}
      paramFields={definition.paramFields}
      params={params}
      onParamsChange={setParams}
      fieldErrors={fieldErrors}
      onDemand={definition.onDemand}
      onRun={handleRun}
      result={result}
      columns={definition.columns}
      rowKey={definition.rowKey}
      exportBaseFilename="trial-balance"
    />
  );
}
