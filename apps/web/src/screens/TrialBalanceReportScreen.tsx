import { useState } from "react";
import { ReportRunner } from "@mezan/ui";
import { createTrialBalanceReport, type TrialBalanceRow } from "@mezan/domain";
import { useFinancialReport } from "../data/financial-reports-hooks";
import { localizeReportDefinition } from "../report-labels";
import { useAppTranslation } from "../i18n";

/**
 * ميزان المراجعة (docs/catalog/08-reports.md), wired to `GET
 * /financial-reports/trial-balance` — the report engine's `ReportDefinition`
 * (`createTrialBalanceReport`) only supplies the UI metadata (title, param
 * fields, columns); the rows/groups/totals/reconciliation all come from the
 * live posted general ledger via `useFinancialReport`, never a fixture.
 */

const TODAY = new Date().toISOString().slice(0, 10);
const rawDefinition = createTrialBalanceReport(TODAY);

function toStringParams(defaults: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, value === null || value === undefined ? "" : String(value)]),
  );
}

export function TrialBalanceReportScreen() {
  const { t } = useAppTranslation();
  const definition = localizeReportDefinition(rawDefinition, t);
  const [params, setParams] = useState<Record<string, string>>(() => toStringParams(rawDefinition.defaultParams));
  const [hasRun, setHasRun] = useState<boolean>(!rawDefinition.onDemand);

  const query = useFinancialReport<TrialBalanceRow>("trial-balance", "/trial-balance", params, { enabled: hasRun });

  const fieldErrors = query.error?.fieldErrors;
  const result = query.data ?? null;

  return (
    <ReportRunner
      title={definition.titleAr}
      description={definition.descriptionAr}
      paramFields={definition.paramFields}
      params={params}
      onParamsChange={setParams}
      fieldErrors={fieldErrors}
      onDemand={definition.onDemand}
      onRun={() => setHasRun(true)}
      loading={query.isFetching}
      result={result}
      columns={definition.columns}
      rowKey={definition.rowKey}
      exportBaseFilename="trial-balance"
    />
  );
}
