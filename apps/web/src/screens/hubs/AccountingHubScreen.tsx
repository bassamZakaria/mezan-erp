import { useMemo } from "react";
import { Money, WorkspaceHub } from "@mezan/ui";
import { useAccounts, useDashboardSummary, useFiscalPeriods } from "../../data/hooks";
import { useAppTranslation } from "../../i18n";
import { DateAndDoc, HubActions, type HubAction } from "./hub-parts";
import { EMPTY } from "../../lib/empty";

/**
 * المحاسبة hub — reuses the SAME `/dashboard/summary` figures the main
 * dashboard shows (they are already GL-scoped and real), plus counts from
 * `/accounts` and `/fiscal-periods`. Recent activity is the dashboard's own
 * posted-journal-entries feed — already scoped to accounting, no re-derivation.
 */

function num(value: string | undefined): number {
  return value ? Number(value) : 0;
}

/**
 * Verbs only. A row of buttons that navigate to the same screens the bar one
 * pixel above already lists is a second copy of the navigation, not an action —
 * and each of these now opens the create flow rather than landing on the list.
 */
const quickActions: HubAction[] = [
  { label: "accountingHub.newJournalEntry", screen: "journals" },
];

export function AccountingHubScreen() {
  const { t } = useAppTranslation();
  const summaryQuery = useDashboardSummary({});
  const accountsQuery = useAccounts();
  const periodsQuery = useFiscalPeriods();

  const summary = summaryQuery.data;
  const accounts = accountsQuery.data ?? [];
  const periods = periodsQuery.data ?? EMPTY;
  const openPeriods = useMemo(() => periods.filter((p) => p.status === "open").length, [periods]);
  const netProfit = num(summary?.gl.netProfit);

  const isLoading = summaryQuery.isLoading || accountsQuery.isLoading || periodsQuery.isLoading;
  const isError = summaryQuery.isError || accountsQuery.isError || periodsQuery.isError;

  return (
    <WorkspaceHub
      title={t("accountingHub.accounting")}
      description={t("accountingHub.theChartOfAccountsJournal")}
      loading={isLoading}
      error={isError ? t("accountingHub.accountingDataCouldNotBe") : null}
      actions={<HubActions actions={quickActions} />}
      stats={[
        { key: "accounts", label: t("accountingHub.accounts"), value: accounts.length, sub: t("accountingHub.chartOfAccounts") },
        { key: "entries", label: t("accountingHub.journalEntries"), value: summary?.counts.journalEntries ?? 0, sub: t("accountingHub.allEntriesOnRecord") },
        {
          key: "profit",
          label: t("accountingHub.netProfit"),
          value: <Money value={netProfit} />,
          sub: t("accountingHub.revenueExpenses"),
          subTone: netProfit < 0 ? "down" : "up",
          valueTone: netProfit < 0 ? "danger" : "default",
        },
        { key: "periods", label: t("accountingHub.openFinancialPeriods"), value: openPeriods, sub: t("accountingHub.ofPeriods", { count: periods.length }) },
      ]}
      list={{
        title: t("accountingHub.latestPostedEntries"),
        sub: t("accountingHub.fromTheSameDataAs"),
        empty: t("accountingHub.noActivityYetPostedEntries"),
        rows: (summary?.recentActivity ?? []).map((entry) => ({
          key: entry.id,
          primary: entry.memo || entry.entryNo || entry.id,
          secondary: <DateAndDoc date={entry.date} docNo={entry.entryNo} />,
        })),
      }}
    />
  );
}
