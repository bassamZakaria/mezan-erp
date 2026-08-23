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
  vatNetPayable,
  type AccountLedgerRow,
  type BalanceSheetRow,
  type CashFlowRow,
  type GeneralLedgerRow,
  type IncomeStatementRow,
  type ReportColumn,
  type ReportParamField,
  type TrialBalanceRow,
  type VatReturnRow,
} from "@mezan/domain";
import type { AccountDTO } from "@mezan/contracts";
import { useAccounts } from "../data/hooks";
import { useFinancialReport } from "../data/financial-reports-hooks";

/**
 * التقارير المالية (docs/catalog/08-reports.md) — the seven financial
 * statements as tabs on one page (`/accounting/reports`), each backed by its
 * own `GET /financial-reports/*` query over the live posted general ledger
 * (`packages/api/src/financial-reports-routes.ts`). The `@mezan/domain`
 * `ReportDefinition`s (`createTrialBalanceReport` etc.) only contribute UI
 * metadata here — title, param fields, columns — shared with the server so
 * the two can never drift; the server runs the actual aggregation. Every tab
 * renders through the same `<ReportRunner>`, and every one exports (XLSX/CSV).
 */

const TODAY = new Date().toISOString().slice(0, 10);
const YEAR_START = `${TODAY.slice(0, 4)}-01-01`;

const trialBalance = createTrialBalanceReport(TODAY);
const incomeStatement = createIncomeStatementReport({ periodFrom: YEAR_START, periodTo: TODAY });
const balanceSheet = createBalanceSheetReport(TODAY);
const cashFlow = createCashFlowReport({ periodFrom: YEAR_START, periodTo: TODAY });
const vatReturn = createVatReturnReport({ periodFrom: YEAR_START, periodTo: TODAY });
const generalLedger = createGeneralLedgerReport({ periodFrom: YEAR_START, periodTo: TODAY });

function paramsToRecord(params: object): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v ?? "")]));
}

interface ReportTabDefinition<Row> {
  readonly id: string;
  readonly titleAr: string;
  readonly descriptionAr?: string;
  readonly paramFields: readonly ReportParamField[];
  readonly defaultParams: object;
  readonly columns: readonly ReportColumn<Row>[];
  readonly rowKey: (row: Row) => string;
  readonly showGrandTotal?: boolean;
}

interface ReportTabProps<Row> {
  readonly definition: ReportTabDefinition<Row>;
  readonly apiPath: string;
  readonly exportBaseFilename: string;
  /**
   * Whether this tab waits for an explicit عرض التقرير click. The two ledger
   * dumps are on-demand (docs/catalog/08-reports.md); the four core statements
   * + VAT auto-run on the selected period like the catalog page does.
   */
  readonly onDemand: boolean;
  readonly renderSummary?: (rows: readonly Row[]) => ReactNode;
}

function ReportTab<Row>({ definition, apiPath, exportBaseFilename, onDemand, renderSummary }: ReportTabProps<Row>) {
  const [params, setParams] = useState<Record<string, string>>(() => paramsToRecord(definition.defaultParams));
  const [hasRun, setHasRun] = useState<boolean>(!onDemand);

  const query = useFinancialReport<Row>(definition.id, apiPath, params, { enabled: hasRun });

  const fieldErrors =
    query.error && "status" in query.error && query.error.status === 400 ? { _root: query.error.message } : undefined;
  const result = query.data ?? null;

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
      onRun={() => setHasRun(true)}
      loading={query.isFetching}
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

/** دفتر حساب needs the live chart of accounts for its account picker — the only tab whose definition depends on more than a date/period. */
function AccountLedgerTab() {
  const accountsQuery = useAccounts();
  const accounts: readonly AccountDTO[] = accountsQuery.data ?? [];
  const firstPostable = accounts.find((a) => !a.isHeader);

  const definition = useMemo(
    () =>
      createAccountLedgerReport(accounts, {
        accountId: firstPostable?.id ?? "",
        periodFrom: YEAR_START,
        periodTo: TODAY,
      }),
    [accounts, firstPostable?.id],
  );

  if (accountsQuery.isLoading) {
    return <div className="rounded-lg border border-border bg-surface p-[16px] text-[12.5px] text-ink-muted">جارٍ تحميل دليل الحسابات…</div>;
  }
  if (accountsQuery.isError) {
    return <div className="rounded-lg border border-danger bg-surface p-[16px] text-[12.5px] text-danger-ink">تعذّر تحميل دليل الحسابات.</div>;
  }

  return (
    <ReportTab<AccountLedgerRow>
      key={firstPostable?.id ?? "empty"}
      definition={definition}
      apiPath="/account-ledger"
      exportBaseFilename="account-ledger"
      onDemand
    />
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
    render: () => (
      <ReportTab<TrialBalanceRow> definition={trialBalance} apiPath="/trial-balance" exportBaseFilename="trial-balance" onDemand={false} />
    ),
  },
  {
    id: "income-statement",
    label: "قائمة الدخل",
    render: () => (
      <ReportTab<IncomeStatementRow>
        definition={incomeStatement}
        apiPath="/income-statement"
        exportBaseFilename="income-statement"
        onDemand={false}
      />
    ),
  },
  {
    id: "balance-sheet",
    label: "الميزانية العمومية",
    render: () => (
      <ReportTab<BalanceSheetRow> definition={balanceSheet} apiPath="/balance-sheet" exportBaseFilename="balance-sheet" onDemand={false} />
    ),
  },
  {
    id: "cash-flow",
    label: "التدفقات النقدية",
    render: () => <ReportTab<CashFlowRow> definition={cashFlow} apiPath="/cash-flow" exportBaseFilename="cash-flow" onDemand={false} />,
  },
  {
    id: "vat-return",
    label: "إقرار ضريبة القيمة المضافة",
    render: () => (
      <ReportTab<VatReturnRow>
        definition={vatReturn}
        apiPath="/vat-return"
        exportBaseFilename="vat-return"
        onDemand={false}
        renderSummary={(rows) => <VatNetSummary rows={rows} />}
      />
    ),
  },
  {
    id: "general-ledger",
    label: "دفتر الأستاذ العام",
    render: () => (
      <ReportTab<GeneralLedgerRow> definition={generalLedger} apiPath="/general-ledger" exportBaseFilename="general-ledger" onDemand />
    ),
  },
  {
    id: "account-ledger",
    label: "دفتر حساب",
    render: () => <AccountLedgerTab />,
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
