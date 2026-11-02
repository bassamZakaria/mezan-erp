import { SalesInvoiceDerivedFilter } from "@mezan/contracts";
import { Money, WorkspaceHub } from "@mezan/ui";
import { ScreenRequest } from "@mezan/domain";
import { useCustomerCounts, useHoldsScreenRequest, useSalesInvoiceCounts, useSalesInvoices, useSalesInvoiceStats, useSalesQuoteCounts } from "../../data/hooks";
import { useApi } from "../../data/ApiContext";
import { DocumentReadPermission, sessionMayRead } from "../../data/document-read-permissions";
import { useAppTranslation } from "../../i18n";
import { DateAndDoc, HubActions, type HubAction } from "./hub-parts";
import { EMPTY } from "../../lib/empty";
import { errorMessage } from "../../lib/error-message";

/**
 * المبيعات hub — KPI tiles + quick actions + recent activity, all computed
 * from real endpoints already wired in `data/hooks.ts` (`/sales-invoices`,
 * `/sales-quotes`, `/customers`). No figure here is invented: counts and the
 * receivable come from the server's own counts/stats over the whole set.
 */

/**
 * Verbs only. A row of buttons that navigate to the same screens the bar one
 * pixel above already lists is a second copy of the navigation, not an action —
 * and each of these now opens the create flow rather than landing on the list.
 */
const quickActions: HubAction[] = [
  { label: "salesHub.action.newInvoice", screen: "sales-invoices" },
  { label: "salesHub.action.newQuote", screen: "quotes" },
];

const RECENT_INVOICES = { page: 1, pageSize: 5, sort: "docNo", sortDir: "desc" } as const;

export function SalesHubScreen() {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const countsQuery = useSalesInvoiceCounts();
  const statsQuery = useSalesInvoiceStats({ status: SalesInvoiceDerivedFilter.Open });
  const recentQuery = useSalesInvoices(RECENT_INVOICES);
  const readsQuotes = useHoldsScreenRequest(ScreenRequest.SalesQuotes);
  const quotesQuery = useSalesQuoteCounts({}, { enabled: readsQuotes });
  const readsCustomers = sessionMayRead(session, DocumentReadPermission.Customers);
  const customerCountsQuery = useCustomerCounts({}, { enabled: readsCustomers });

  const recentInvoices = recentQuery.data ?? EMPTY;
  const pendingQuotes = quotesQuery.data?.sent ?? 0;

  const isLoading = countsQuery.isLoading || statsQuery.isLoading || recentQuery.isLoading || (readsQuotes && quotesQuery.isLoading) || (readsCustomers && customerCountsQuery.isLoading);
  const isError = countsQuery.isError || statsQuery.isError || recentQuery.isError || (readsQuotes && quotesQuery.isError) || (readsCustomers && customerCountsQuery.isError);

  return (
    <WorkspaceHub
      title={t("salesHub.title")}
      description={t("salesHub.description")}
      loading={isLoading}
      error={isError ? errorMessage(countsQuery.error ?? statsQuery.error ?? recentQuery.error ?? quotesQuery.error ?? customerCountsQuery.error, t("salesHub.loadFailed")) : null}
      actions={<HubActions actions={quickActions} />}
      stats={[
        { key: "invoices", label: t("salesHub.stat.invoices"), value: countsQuery.data?.all ?? 0, sub: t("salesHub.stat.invoicesSub") },
        { key: "receivable", label: t("salesHub.stat.receivable"), value: <Money value={statsQuery.data?.remaining ?? "0"} />, sub: t("salesHub.stat.receivableSub") },
        ...(readsQuotes ? [{ key: "quotes", label: t("salesHub.stat.pendingQuotes"), value: pendingQuotes, sub: t("salesHub.stat.pendingQuotesSub") }] : []),
        ...(readsCustomers ? [{ key: "customers", label: t("salesHub.stat.customers"), value: customerCountsQuery.data?.all ?? 0, sub: t("salesHub.stat.customersSub") }] : []),
      ]}
      list={{
        title: t("salesHub.recent"),
        sub: t("salesHub.recentSub"),
        empty: t("salesHub.empty"),
        rows: recentInvoices.map((inv) => ({
          key: inv.id,
          primary: inv.customerNameAr,
          secondary: <DateAndDoc date={inv.date} docNo={inv.docNo} />,
          trailing: <Money value={inv.baseGrandTotal ?? inv.totals.grandTotal} />,
        })),
      }}
    />
  );
}
