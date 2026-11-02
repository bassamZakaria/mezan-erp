import { useMemo } from "react";
import { Money, WorkspaceHub } from "@mezan/ui";
import { ScreenRequest } from "@mezan/domain";
import { useGoodsReceipts, useHoldsScreenRequest, usePurchaseInvoiceCounts, usePurchaseInvoices, usePurchaseOrders, useSuppliers } from "../../data/hooks";
import { useAppTranslation } from "../../i18n";
import { DateAndDoc, HubActions, type HubAction } from "./hub-parts";
import { EMPTY } from "../../lib/empty";
import { errorMessage } from "../../lib/error-message";

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

const RECENT_INVOICES = { page: 1, pageSize: 5 } as const;

export function PurchasesHubScreen() {
  const { t } = useAppTranslation();
  const ordersQuery = usePurchaseOrders();
  const receiptsQuery = useGoodsReceipts();
  const invoiceCountsQuery = usePurchaseInvoiceCounts();
  const invoicesQuery = usePurchaseInvoices(RECENT_INVOICES);
  const suppliersQuery = useSuppliers();
  const readsOrders = useHoldsScreenRequest(ScreenRequest.PurchaseOrders);
  const readsReceipts = useHoldsScreenRequest(ScreenRequest.GoodsReceipts);
  const readsSuppliers = useHoldsScreenRequest(ScreenRequest.Suppliers);

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
  const recentInvoices = invoices.slice(0, RECENT_INVOICES.pageSize);

  const isLoading = ordersQuery.isLoading || receiptsQuery.isLoading || invoicesQuery.isLoading || invoiceCountsQuery.isLoading || suppliersQuery.isLoading;
  const isError = ordersQuery.isError || receiptsQuery.isError || invoicesQuery.isError || invoiceCountsQuery.isError || suppliersQuery.isError;

  return (
    <WorkspaceHub
      title={t("purchasesHub.title")}
      description={t("purchasesHub.description")}
      loading={isLoading}
      error={isError ? errorMessage(ordersQuery.error ?? receiptsQuery.error ?? invoicesQuery.error ?? invoiceCountsQuery.error ?? suppliersQuery.error, t("purchasesHub.loadFailed")) : null}
      actions={<HubActions actions={quickActions} />}
      stats={[
        ...(readsOrders ? [{ key: "orders", label: t("purchasesHub.stat.openOrders"), value: openOrders, sub: t("purchasesHub.stat.openOrdersSub") }] : []),
        ...(readsReceipts ? [{ key: "uninvoiced", label: t("purchasesHub.stat.uninvoiced"), value: uninvoicedReceipts, sub: t("purchasesHub.stat.uninvoicedSub") }] : []),
        { key: "invoices", label: t("purchasesHub.stat.invoices"), value: invoiceCountsQuery.data?.all ?? 0, sub: t("purchasesHub.stat.invoicesSub") },
        ...(readsSuppliers ? [{ key: "suppliers", label: t("purchasesHub.stat.suppliers"), value: suppliers.length, sub: t("purchasesHub.stat.suppliersSub") }] : []),
      ]}
      list={{
        title: t("purchasesHub.recent"),
        sub: t("purchasesHub.recentSub"),
        empty: t("purchasesHub.empty"),
        rows: recentInvoices.map((inv) => ({
          key: inv.id,
          primary: supplierName(inv.supplierId),
          secondary: <DateAndDoc date={inv.date} docNo={inv.number} />,
          trailing: <Money value={inv.baseTotal ?? inv.total} />,
        })),
      }}
    />
  );
}
