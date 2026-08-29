import { useMemo } from "react";
import { Money, WorkspaceHub } from "@mezan/ui";
import { useCustomers, useSalesInvoices, useSalesQuotes } from "../../data/hooks";
import { useAppTranslation } from "../../i18n";
import { DateAndDoc, HubActions, type HubAction } from "./hub-parts";
import { EMPTY } from "../../lib/empty";

/**
 * المبيعات hub — KPI tiles + quick actions + recent activity, all computed
 * from real endpoints already wired in `data/hooks.ts` (`/sales-invoices`,
 * `/sales-quotes`, `/customers`). No figure here is invented: every tile is a
 * count or a sum over the actual list responses.
 */

const OUTSTANDING_INVOICE_STATUSES = new Set(["confirmed", "partially_paid"]);

/**
 * Verbs only. A row of buttons that navigate to the same screens the bar one
 * pixel above already lists is a second copy of the navigation, not an action —
 * and each of these now opens the create flow rather than landing on the list.
 */
const quickActions: HubAction[] = [
  { label: "salesHub.action.newInvoice", screen: "sales-invoices" },
  { label: "salesHub.action.newQuote", screen: "quotes" },
];

function num(value: string | undefined | null): number {
  return value ? Number(value) : 0;
}

export function SalesHubScreen() {
  const { t } = useAppTranslation();
  const invoicesQuery = useSalesInvoices();
  const quotesQuery = useSalesQuotes();
  const customersQuery = useCustomers();

  const invoices = invoicesQuery.data ?? EMPTY;
  const quotes = quotesQuery.data ?? EMPTY;
  const customers = customersQuery.data ?? [];

  const outstandingReceivable = useMemo(
    () =>
      invoices
        .filter((inv) => OUTSTANDING_INVOICE_STATUSES.has(inv.status))
        .reduce((sum, inv) => sum + num(inv.remainingBalance), 0),
    [invoices],
  );
  const pendingQuotes = useMemo(() => quotes.filter((q) => q.status === "sent").length, [quotes]);
  const recentInvoices = useMemo(() => [...invoices].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5), [invoices]);

  const isLoading = invoicesQuery.isLoading || quotesQuery.isLoading || customersQuery.isLoading;
  const isError = invoicesQuery.isError || quotesQuery.isError || customersQuery.isError;

  return (
    <WorkspaceHub
      title={t("salesHub.title")}
      description={t("salesHub.description")}
      loading={isLoading}
      error={isError ? t("salesHub.loadFailed") : null}
      actions={<HubActions actions={quickActions} />}
      stats={[
        { key: "invoices", label: t("salesHub.stat.invoices"), value: invoices.length, sub: t("salesHub.stat.invoicesSub") },
        { key: "receivable", label: t("salesHub.stat.receivable"), value: <Money value={outstandingReceivable} />, sub: t("salesHub.stat.receivableSub") },
        { key: "quotes", label: t("salesHub.stat.pendingQuotes"), value: pendingQuotes, sub: t("salesHub.stat.pendingQuotesSub") },
        { key: "customers", label: t("salesHub.stat.customers"), value: customers.length, sub: t("salesHub.stat.customersSub") },
      ]}
      list={{
        title: t("salesHub.recent"),
        sub: t("salesHub.recentSub"),
        empty: t("salesHub.empty"),
        rows: recentInvoices.map((inv) => ({
          key: inv.id,
          primary: inv.customerNameAr,
          secondary: <DateAndDoc date={inv.date} docNo={inv.docNo} />,
          trailing: <Money value={num(inv.totals.grandTotal)} />,
        })),
      }}
    />
  );
}
