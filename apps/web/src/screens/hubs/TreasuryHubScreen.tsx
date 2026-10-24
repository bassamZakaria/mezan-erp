import { useMemo } from "react";
import { Money, WorkspaceHub } from "@mezan/ui";
import { ScreenRequest } from "@mezan/domain";
import { useCheques, useDashboardSummary, useHoldsScreenRequest, useMayAskScreen, useTreasuryAccounts, useVoucherCounts, useVouchers } from "../../data/hooks";
import { useAppTranslation } from "../../i18n";
import { storedMemoLabel } from "../../domain-labels";
import { DateAndDoc, HubActions, type HubAction } from "./hub-parts";
import { EMPTY } from "../../lib/empty";

/**
 * الخزينة hub — treasury accounts + vouchers + cheques over the real
 * `/treasury-accounts`, `/vouchers`, `/cheques` endpoints, plus the cash
 * figure reused from `/dashboard/summary` (same GL-derived value shown on
 * the main dashboard — real, not re-derived client-side).
 */

const PENDING_CHEQUE_STATUSES = new Set(["pending", "deposited"]);

const RECENT_VOUCHERS = { page: 1, pageSize: 5 } as const;

/**
 * Verbs only. A row of buttons that navigate to the same screens the bar one
 * pixel above already lists is a second copy of the navigation, not an action —
 * and each of these now opens the create flow rather than landing on the list.
 */
const quickActions: HubAction[] = [
  { label: "treasuryHub.newCashVoucher", screen: "treasury-vouchers" },
];

export function TreasuryHubScreen() {
  const { t, locale } = useAppTranslation();
  const accountsQuery = useTreasuryAccounts();
  const readsVouchers = useMayAskScreen(ScreenRequest.Vouchers);
  const voucherCountsQuery = useVoucherCounts({}, { enabled: readsVouchers });
  const vouchersQuery = useVouchers(RECENT_VOUCHERS);
  const chequesQuery = useCheques();
  const readsCheques = useHoldsScreenRequest(ScreenRequest.Cheques);
  const summaryQuery = useDashboardSummary({});

  const accounts = accountsQuery.data ?? EMPTY;
  const vouchers = vouchersQuery.data ?? EMPTY;
  const cheques = chequesQuery.data ?? EMPTY;
  const activeAccounts = useMemo(() => accounts.filter((a) => a.status === "active").length, [accounts]);
  const pendingCheques = useMemo(() => cheques.filter((c) => PENDING_CHEQUE_STATUSES.has(c.status)).length, [cheques]);
  const recentVouchers = vouchers.slice(0, RECENT_VOUCHERS.pageSize);
  const cash = summaryQuery.data?.gl.cash ?? "0";

  const isLoading = accountsQuery.isLoading || vouchersQuery.isLoading || voucherCountsQuery.isLoading || chequesQuery.isLoading || summaryQuery.isLoading;
  const isError = accountsQuery.isError || vouchersQuery.isError || voucherCountsQuery.isError || chequesQuery.isError || summaryQuery.isError;

  return (
    <WorkspaceHub
      title={t("treasuryHub.treasury")}
      description={t("treasuryHub.cashBoxesBanksCashVouchers")}
      loading={isLoading}
      error={isError ? t("treasuryHub.treasuryDataCouldNotBe") : null}
      actions={<HubActions actions={quickActions} />}
      stats={[
        { key: "accounts", label: t("treasuryHub.activeTreasuryAccounts"), value: activeAccounts, sub: t("treasuryHub.ofAccounts", { count: accounts.length }) },
        { key: "cash", label: t("treasuryHub.cashOnHand"), value: <Money value={cash} />, sub: t("treasuryHub.cashBoxAndBankBalances") },
        { key: "vouchers", label: t("treasuryHub.vouchersRecorded"), value: voucherCountsQuery.data?.all ?? 0, sub: t("treasuryHub.allVouchers") },
        ...(readsCheques ? [{ key: "cheques", label: t("treasuryHub.chequesInCollection"), value: pendingCheques, sub: t("treasuryHub.awaitingDepositOrCollection") }] : []),
      ]}
      list={{
        title: t("treasuryHub.latestVouchers"),
        sub: t("treasuryHub.theLast5VouchersRecorded"),
        empty: t("treasuryHub.noVouchersYetTheFirst"),
        rows: recentVouchers.map((v) => ({
          key: v.id,
          primary: storedMemoLabel(v.memo, locale) || v.docNo || v.id,
          secondary: <DateAndDoc date={v.date} docNo={v.docNo} />,
          trailing: <Money value={v.amount} />,
        })),
      }}
    />
  );
}
