import { useMemo } from "react";
import { Money, WorkspaceHub } from "@mezan/ui";
import { useGoodsReceipts, usePurchaseInvoices, usePurchaseOrders, useSuppliers } from "../../data/hooks";
import { useAppTranslation } from "../../i18n";
import { DateAndDoc, HubActions, type HubAction } from "./hub-parts";
import { EMPTY } from "../../lib/empty";

/**
 * المشتريات hub — KPI tiles + quick actions + recent activity over the real
 * purchase-chain endpoints (`/purchase-orders`, `/goods-receipts`,
 * `/purchase-invoices`, `/suppliers`) already wired in `data/hooks.ts`.
 */

const OPEN_PO_STATUSES = new Set(["sent", "partially_received"]);

/**
 * Verbs only. A row of buttons that navigate to the same screens the bar one
 * pixel above already lists is a second copy of the navigation, not an action —
 * and each of these now opens the create flow rather than landing on the list.
 */
const quickActions: HubAction[] = [
  { label: "purchasesHub.action.newOrder", screen: "purchase-orders" },
  { label: "purchasesHub.action.receipt", screen: "goods-receipts" },
  { label: "purchasesHub.action.newInvoice", screen: "purchase-invoices" },
];

function num(value: string | undefined | null): number {
  return value ? Number(value) : 0;
}

export function PurchasesHubScreen() {
  const { t } = useAppTranslation();
  const ordersQuery = usePurchaseOrders();
  const receiptsQuery = useGoodsReceipts();
  const invoicesQuery = usePurchaseInvoices();
  const suppliersQuery = useSuppliers();

  const orders = ordersQuery.data ?? EMPTY;
  const receipts = receiptsQuery.data ?? EMPTY;
  const invoices = invoicesQuery.data ?? EMPTY;
  const suppliers = suppliersQuery.data ?? EMPTY;

  const supplierName = useMemo(() => {
    const byId = new Map(suppliers.map((s) => [s.id, s.nameAr]));
    return (id: string) => byId.get(id) ?? id;
  }, [suppliers]);

  const openOrders = useMemo(() => orders.filter((o) => OPEN_PO_STATUSES.has(o.status)).length, [orders]);
  const uninvoicedReceipts = useMemo(
    () => receipts.filter((r) => r.status === "confirmed" && !r.invoiced).length,
    [receipts],
  );
  const recentInvoices = useMemo(() => [...invoices].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5), [invoices]);

  const isLoading = ordersQuery.isLoading || receiptsQuery.isLoading || invoicesQuery.isLoading || suppliersQuery.isLoading;
  const isError = ordersQuery.isError || receiptsQuery.isError || invoicesQuery.isError || suppliersQuery.isError;

  return (
    <WorkspaceHub
      title={t("purchasesHub.title")}
      description={t("purchasesHub.description")}
      loading={isLoading}
      error={isError ? t("purchasesHub.loadFailed") : null}
      actions={<HubActions actions={quickActions} />}
      stats={[
        { key: "orders", label: t("purchasesHub.stat.openOrders"), value: openOrders, sub: t("purchasesHub.stat.openOrdersSub") },
        { key: "uninvoiced", label: t("purchasesHub.stat.uninvoiced"), value: uninvoicedReceipts, sub: t("purchasesHub.stat.uninvoicedSub") },
        { key: "invoices", label: t("purchasesHub.stat.invoices"), value: invoices.length, sub: t("purchasesHub.stat.invoicesSub") },
        { key: "suppliers", label: t("purchasesHub.stat.suppliers"), value: suppliers.length, sub: t("purchasesHub.stat.suppliersSub") },
      ]}
      list={{
        title: t("purchasesHub.recent"),
        sub: t("purchasesHub.recentSub"),
        empty: t("purchasesHub.empty"),
        rows: recentInvoices.map((inv) => ({
          key: inv.id,
          primary: supplierName(inv.supplierId),
          secondary: <DateAndDoc date={inv.date} docNo={inv.number} />,
          trailing: <Money value={num(inv.baseTotal ?? inv.total)} />,
        })),
      }}
    />
  );
}
