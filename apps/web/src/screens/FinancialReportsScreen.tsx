import { useMemo, useState, type ReactNode } from "react";
import {
  createAccountLedgerReport,
  createBalanceSheetReport,
  createCashFlowReport,
  createGeneralLedgerReport,
  createIncomeStatementReport,
  createTrialBalanceReport,
  createVatReturnReport,
  createWithholdingTaxReport,
  vatNetPayable,
  type Account,
  type VatReturnRow,
} from "@mezan/domain";
import { ReportScreen } from "./reports/ReportScreen";
import { useAccounts } from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/**
 * التقارير المالية (docs/catalog/08-reports.md) — the seven financial
 * statements as tabs on one page (`/accounting/reports`). Every tab is the SAME
 * generic `<ReportScreen>` the operational reports use: it renders a
 * `ReportDefinition`'s metadata (title/params/columns) locally and fetches the
 * computed rows/totals/reconciliation from the live `/reports/accounting/*` API
 * over the shared session transport. Nothing here reads a fixture ledger — the
 * statements compute from the REAL posted GL (packages/api reports-routes.ts),
 * the same posted journal entries the journal/dashboard screens show.
 */

const EYEBROW = "eyebrow.reports.statements" as const;
const TODAY = "2026-08-22";
const YEAR_START = "2026-01-01";

const trialBalance = createTrialBalanceReport(TODAY);
const incomeStatement = createIncomeStatementReport({ periodFrom: YEAR_START, periodTo: TODAY });
const balanceSheet = createBalanceSheetReport(TODAY);
const cashFlow = createCashFlowReport({ periodFrom: YEAR_START, periodTo: TODAY });
const vatReturn = createVatReturnReport({ periodFrom: YEAR_START, periodTo: TODAY });
const withholdingTax = createWithholdingTaxReport(YEAR_START, TODAY);
const generalLedger = createGeneralLedgerReport({ periodFrom: YEAR_START, periodTo: TODAY });

function VatNetSummary({ rows }: { rows: readonly VatReturnRow[] }) {
  const { t } = useAppTranslation();
  const net = vatNetPayable(rows);
  const label = net >= 0 ? t("finReports.netTaxPayable") : t("finReports.netTaxRecoverable");
  const amount = Math.abs(net).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-[13px_16px] text-[12.5px]">
      <span className="font-semibold text-ink">{t("finReports.outputTaxInputTax")} {label}: </span>
      <span className="mz-num font-bold text-ink">{amount} {t("ui.currency")}</span>
    </div>
  );
}

/**
 * دفتر حساب — the account picker's options come from the REAL chart of accounts
 * (`useAccounts`), so the select lists exactly the tenant's postable accounts.
 * The definition is rebuilt when the accounts load; the server validates the
 * chosen account against the same real chart.
 */
function AccountLedgerTab() {
  const { t } = useAppTranslation();
  const accountsQuery = useAccounts();
  const accounts = useMemo<readonly Account[]>(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const definition = useMemo(() => {
    const firstPostable = accounts.find((a) => !a.isHeader);
    return createAccountLedgerReport(accounts, {
      accountId: firstPostable?.id ?? "",
      periodFrom: YEAR_START,
      periodTo: TODAY,
    });
  }, [accounts]);

  if (accountsQuery.isLoading) {
    return <div className="rounded-lg border border-border bg-surface p-[28px] text-center text-[13px] text-ink-muted">{t("finReports.loadingTheChartOfAccounts")}</div>;
  }

  return <ReportScreen definition={definition} apiPath="/accounting/account-ledger" />;
}

interface TabDef {
  readonly id: string;
  readonly labelKey: AppTranslationKey;
  readonly render: () => ReactNode;
}

const TABS: readonly TabDef[] = [
  {
    id: "trial-balance",
    labelKey: "finReports.trialBalance",
    // The four core statements + VAT auto-run on the selected period; only the
    // two ledger dumps (general/account ledger) gate behind عرض التقرير. The
    // trial-balance definition is marked on-demand as a demo, overridden here.
    render: () => <ReportScreen definition={trialBalance} apiPath="/accounting/trial-balance" onDemand={false} />,
  },
  {
    id: "income-statement",
    labelKey: "finReports.incomeStatement",
    render: () => <ReportScreen definition={incomeStatement} apiPath="/accounting/income-statement" />,
  },
  {
    id: "balance-sheet",
    labelKey: "finReports.balanceSheet",
    render: () => <ReportScreen definition={balanceSheet} apiPath="/accounting/balance-sheet" />,
  },
  {
    id: "cash-flow",
    labelKey: "finReports.cashFlow",
    render: () => <ReportScreen definition={cashFlow} apiPath="/accounting/cash-flow" />,
  },
  {
    id: "vat-return",
    labelKey: "finReports.vatReturn",
    render: () => (
      <ReportScreen
        definition={vatReturn}
        apiPath="/accounting/vat-return"
        renderSummary={(rows) => <VatNetSummary rows={rows} />}
      />
    ),
  },
  {
    id: "withholding-tax",
    labelKey: "finReports.withholdingTax",
    render: () => <ReportScreen definition={withholdingTax} apiPath="/tax/withholding" />,
  },
  {
    id: "general-ledger",
    labelKey: "finReports.generalLedger",
    render: () => <ReportScreen definition={generalLedger} apiPath="/accounting/general-ledger" />,
  },
  {
    id: "account-ledger",
    labelKey: "finReports.accountLedger",
    render: () => <AccountLedgerTab />,
  },
];

export function FinancialReportsScreen() {
  const { t } = useAppTranslation();
  const [activeTab, setActiveTab] = useState<string>(TABS[0]?.id ?? "trial-balance");
  const tab = TABS.find((entry) => entry.id === activeTab) ?? TABS[0];

  return (
    <div className="w-full">
      <div className="mb-[18px] flex flex-wrap gap-[6px]" role="tablist" aria-label={t("finReports.financialStatements")}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={entry.id === activeTab}
            onClick={() => setActiveTab(entry.id)}
            className={
              entry.id === activeTab
                ? "rounded-md bg-brand px-[13px] py-[7px] text-[12.5px] font-semibold text-brand-ink"
                : "rounded-md border border-border bg-surface px-[13px] py-[7px] text-[12.5px] font-semibold text-ink-muted hover:text-ink"
            }
          >
            {t(entry.labelKey)}
          </button>
        ))}
      </div>

      {tab ? <div key={tab.id}>{tab.render()}</div> : null}
    </div>
  );
}
