import { useMemo } from "react";
import { Button, Card, Money, StatCard } from "@mezan/ui";
import { useCustomers, useSalesInvoices, useSalesQuotes } from "../../data/hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../App";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";

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
const quickActions: { label: AppTranslationKey; screen: ScreenKey }[] = [
  { label: "salesHub.action.newInvoice", screen: "sales-invoices" },
  { label: "salesHub.action.newQuote", screen: "quotes" },
];

function num(value: string | undefined | null): number {
  return value ? Number(value) : 0;
}

export function SalesHubScreen() {
  const { t } = useAppTranslation();
  const { navigate } = useNavigation();
  const invoicesQuery = useSalesInvoices();
  const quotesQuery = useSalesQuotes();
  const customersQuery = useCustomers();

  const invoices = invoicesQuery.data ?? [];
  const quotes = quotesQuery.data ?? [];
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
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">{t("salesHub.title")}</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("salesHub.description")}</p>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {quickActions.map((action, index) => (
            <Button key={action.screen} size="sm" variant={index === 0 ? "primary" : "default"} onClick={() => navigate(action.screen, "create")}>
              {t(action.label)}
            </Button>
          ))}
        </div>
      </div>

      {isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("salesHub.loadFailed")}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label={t("salesHub.stat.invoices")} value={isLoading ? "—" : invoices.length} sub={t("salesHub.stat.invoicesSub")} />
        <StatCard label={t("salesHub.stat.receivable")} value={<Money value={outstandingReceivable} />} sub={t("salesHub.stat.receivableSub")} />
        <StatCard label={t("salesHub.stat.pendingQuotes")} value={isLoading ? "—" : pendingQuotes} sub={t("salesHub.stat.pendingQuotesSub")} />
        <StatCard label={t("salesHub.stat.customers")} value={isLoading ? "—" : customers.length} sub={t("salesHub.stat.customersSub")} />
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">{t("salesHub.recent")}</h3>
        <div className="mb-[10px] mt-[2px] text-[11.5px] text-ink-faint">{t("salesHub.recentSub")}</div>
        {recentInvoices.length > 0 ? (
          <ul className="flex flex-col gap-[10px]">
            {recentInvoices.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-[10px]">
                <div>
                  <div className="text-[12.5px] text-ink">{inv.customerNameAr}</div>
                  <div className="mt-[1px] text-[11px] text-ink-faint">
                    <span className="mz-num">{inv.date}</span>
                    {inv.docNo ? <span className="mz-lat"> · {inv.docNo}</span> : null}
                  </div>
                </div>
                <Money value={num(inv.totals.grandTotal)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-muted">{t("salesHub.empty")}</p>
        )}
      </Card>
    </div>
  );
}
