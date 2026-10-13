import { useState } from "react";
import { ReportRunner, type ReportRunnerEntityRef } from "@mezan/ui";
import { createTrialBalanceReport, type TrialBalanceRow } from "@mezan/domain";
import { useFinancialReport } from "../data/financial-reports-hooks";
import { localizeReportDefinition } from "../report-labels";
import { useAppTranslation } from "../i18n";
import { todayIso } from "../lib/dates";
import { ReportDrillDownPanel } from "./reports/ReportDrillDownPanel";
import { useBranchParam } from "./reports/branch-param";

/**
 * ميزان المراجعة (docs/archive/catalog/08-reports.md), wired to `GET
 * /financial-reports/trial-balance` — the report engine's `ReportDefinition`
 * (`createTrialBalanceReport`) only supplies the UI metadata (title, param
 * fields, columns); the rows/groups/totals/reconciliation all come from the
 * live posted general ledger via `useFinancialReport`, never a fixture.
 */

const TODAY = todayIso();
const rawDefinition = createTrialBalanceReport(TODAY);

function toStringParams(defaults: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, value === null || value === undefined ? "" : String(value)]),
  );
}

export function TrialBalanceReportScreen() {
  const { t } = useAppTranslation();
  const definition = localizeReportDefinition(rawDefinition, t);
  const { paramFields, caveat } = useBranchParam(definition.paramFields);
  const [params, setParams] = useState<Record<string, string>>(() => toStringParams(rawDefinition.defaultParams));
  const [hasRun, setHasRun] = useState<boolean>(!rawDefinition.onDemand);
  const [drillEntity, setDrillEntity] = useState<ReportRunnerEntityRef | null>(null);

  const query = useFinancialReport<TrialBalanceRow>("trial-balance", "/trial-balance", params, { enabled: hasRun });

  const fieldErrors = query.error?.fieldErrors;
  const raw = query.data ?? null;

  /**
   * The trial balance's whole claim is that it balances (R21.10). Making the
   * reader add two columns to find out is the report failing at its one job,
   * so it is stated as a banner — derived from the reconciliation the report
   * already computes, never asserted separately.
   */
  const result =
    raw === null
      ? null
      : {
          ...raw,
          balanceCheck: raw.reconciliation
            ? {
                label: raw.reconciliation.withinTolerance ? t("trialBalance.balanced") : t("trialBalance.unbalanced"),
                balanced: raw.reconciliation.withinTolerance,
              }
            : null,
        };

  return (
    <ReportRunner
      title={definition.titleAr}
      description={caveat ? [definition.descriptionAr, caveat].filter(Boolean).join(" ") : definition.descriptionAr}
      paramFields={paramFields}
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
      onEntityClick={setDrillEntity}
      footer={<ReportDrillDownPanel entity={drillEntity} reportParams={raw?.params ?? null} onClose={() => setDrillEntity(null)} />}
    />
  );
}
