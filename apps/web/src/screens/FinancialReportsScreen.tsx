import { useMemo, useState, type ReactNode } from "react";
import { ReportRunner } from "@mezan/ui";
import {
  createAccountLedgerReport,
  createBalanceSheetReport,
  createCashFlowReport,
  createGeneralLedgerReport,
  createIncomeStatementReport,
  createTrialBalanceReport,
  createVatReturnReport,
  financialStatementAccounts,
  financialStatementEntries,
  runReport,
  vatNetPayable,
  INPUT_VAT_ACCOUNT_ID,
  OUTPUT_VAT_ACCOUNT_ID,
  type GlReportContext,
  type ReportDefinition,
  type RunReportOutcome,
  type VatReturnContext,
  type VatReturnRow,
} from "@mezan/domain";

/**
 * التقارير المالية (docs/catalog/08-reports.md) — the seven financial
 * statements as tabs on one page (`/accounting/reports`), each a
 * `ReportDefinition` run over the shared tenant ledger through the report
 * engine. Nothing here is statement-specific except the tab list and the VAT
 * net-payable summary; every tab renders through the same `<ReportRunner>` +
 * `runReport` pipeline, and every one exports (XLSX/CSV).
 */

const TODAY = "2026-08-22";
const YEAR_START = "2026-01-01";

const glContext: GlReportContext = {
  accounts: financialStatementAccounts,
  journalEntries: financialStatementEntries,
};
const vatContext: VatReturnContext = {
  ...glContext,
  outputVatAccountId: OUTPUT_VAT_ACCOUNT_ID,
  inputVatAccountId: INPUT_VAT_ACCOUNT_ID,
};

const firstPostable = financialStatementAccounts.find((a) => !a.isHeader);

const trialBalance = createTrialBalanceReport(TODAY);
const incomeStatement = createIncomeStatementReport({ periodFrom: YEAR_START, periodTo: TODAY });
const balanceSheet = createBalanceSheetReport(TODAY);
const cashFlow = createCashFlowReport({ periodFrom: YEAR_START, periodTo: TODAY });
const vatReturn = createVatReturnReport({ periodFrom: YEAR_START, periodTo: TODAY });
const generalLedger = createGeneralLedgerReport({ periodFrom: YEAR_START, periodTo: TODAY });
const accountLedger = createAccountLedgerReport(financialStatementAccounts, {
  accountId: firstPostable?.id ?? "",
  periodFrom: YEAR_START,
  periodTo: TODAY,
});

function paramsToRecord(params: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(params as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]));
}

interface ReportTabProps<TParams, Row, Ctx> {
  readonly definition: ReportDefinition<TParams, Row, Ctx>;
  readonly context: Ctx;
  readonly exportBaseFilename: string;
  /**
   * Whether this tab waits for an explicit عرض التقرير click. The two ledger
   * dumps are on-demand (docs/catalog/08-reports.md); the four core statements
   * + VAT auto-run on the selected period like the catalog page does.
   */
  readonly onDemand: boolean;
  readonly renderSummary?: (rows: readonly Row[]) => ReactNode;
}

function ReportTab<TParams, Row, Ctx>({
  definition,
  context,
  exportBaseFilename,
  onDemand,
  renderSummary,
}: ReportTabProps<TParams, Row, Ctx>) {
  const [params, setParams] = useState<Record<string, string>>(() => paramsToRecord(definition.defaultParams));
  const [ranOutcome, setRanOutcome] = useState<RunReportOutcome<TParams, Row> | null>(null);

  // Auto-run reports recompute on every param change; on-demand reports wait
  // for the "عرض التقرير" click (tracked in `ranOutcome`).
  const autoOutcome = useMemo(
    () => (onDemand ? null : runReport(definition, params, context)),
    [onDemand, definition, params, context],
  );
  const outcome = onDemand ? ranOutcome : autoOutcome;

  const fieldErrors =
    outcome && !outcome.ok ? Object.fromEntries(outcome.errors.map((e) => [e.field, e.message])) : undefined;
  const result = outcome && outcome.ok ? outcome : null;

  return (
    <ReportRunner
      eyebrow="المحاسبة · القوائم المالية"
      title={definition.titleAr}
      description={definition.descriptionAr}
      paramFields={definition.paramFields}
      params={params}
      onParamsChange={setParams}
      fieldErrors={fieldErrors}
      onDemand={onDemand}
      onRun={() => setRanOutcome(runReport(definition, params, context))}
      result={result}
      columns={definition.columns}
      rowKey={definition.rowKey}
      chart={result && renderSummary ? renderSummary(result.rows) : undefined}
      showGrandTotal={definition.showGrandTotal ?? true}
      exportBaseFilename={exportBaseFilename}
    />
  );
}

function VatNetSummary({ rows }: { rows: readonly VatReturnRow[] }) {
  const net = vatNetPayable(rows);
  const label = net >= 0 ? "صافي الضريبة المستحقة الدفع" : "صافي الضريبة القابلة للاسترداد";
  const amount = Math.abs(net).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-[13px_16px] text-[12.5px]">
      <span className="font-semibold text-ink">ضريبة المخرجات − ضريبة المدخلات = {label}: </span>
      <span className="mz-num font-bold text-ink">{amount} ج.م</span>
    </div>
  );
}

interface TabDef {
  readonly id: string;
  readonly label: string;
  readonly render: () => ReactNode;
}

const TABS: readonly TabDef[] = [
  {
    id: "trial-balance",
    label: "ميزان المراجعة",
    render: () => <ReportTab definition={trialBalance} context={glContext} exportBaseFilename="trial-balance" onDemand={false} />,
  },
  {
    id: "income-statement",
    label: "قائمة الدخل",
    render: () => <ReportTab definition={incomeStatement} context={glContext} exportBaseFilename="income-statement" onDemand={false} />,
  },
  {
    id: "balance-sheet",
    label: "الميزانية العمومية",
    render: () => <ReportTab definition={balanceSheet} context={glContext} exportBaseFilename="balance-sheet" onDemand={false} />,
  },
  {
    id: "cash-flow",
    label: "التدفقات النقدية",
    render: () => <ReportTab definition={cashFlow} context={glContext} exportBaseFilename="cash-flow" onDemand={false} />,
  },
  {
    id: "vat-return",
    label: "إقرار ضريبة القيمة المضافة",
    render: () => (
      <ReportTab
        definition={vatReturn}
        context={vatContext}
        exportBaseFilename="vat-return"
        onDemand={false}
        renderSummary={(rows) => <VatNetSummary rows={rows} />}
      />
    ),
  },
  {
    id: "general-ledger",
    label: "دفتر الأستاذ العام",
    render: () => <ReportTab definition={generalLedger} context={glContext} exportBaseFilename="general-ledger" onDemand />,
  },
  {
    id: "account-ledger",
    label: "دفتر حساب",
    render: () => <ReportTab definition={accountLedger} context={glContext} exportBaseFilename="account-ledger" onDemand />,
  },
];

export function FinancialReportsScreen() {
  const [activeTab, setActiveTab] = useState<string>(TABS[0]?.id ?? "trial-balance");
  const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  return (
    <div className="w-full">
      <div className="mb-[18px] flex flex-wrap gap-[6px]" role="tablist" aria-label="القوائم المالية">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === activeTab}
            onClick={() => setActiveTab(t.id)}
            className={
              t.id === activeTab
                ? "rounded-md bg-brand px-[13px] py-[7px] text-[12.5px] font-semibold text-on-brand"
                : "rounded-md border border-border bg-surface px-[13px] py-[7px] text-[12.5px] font-semibold text-ink-muted hover:text-ink"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab ? <div key={tab.id}>{tab.render()}</div> : null}
    </div>
  );
}
