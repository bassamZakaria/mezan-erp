import { useMemo } from "react";
import { Button, Card, Money, StatCard } from "@mezan/ui";
import { useGoodsReceipts, usePurchaseInvoices, usePurchaseOrders, useSuppliers } from "../../data/hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../App";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";

/**
 * المشتريات hub — KPI tiles + quick actions + recent activity over the real
 * purchase-chain endpoints (`/purchase-orders`, `/goods-receipts`,
 * `/purchase-invoices`, `/suppliers`) already wired in `data/hooks.ts`.
 */

const OPEN_PO_STATUSES = new Set(["sent", "partially_received"]);

const quickActions: { label: AppTranslationKey; screen: ScreenKey }[] = [
  { label: "purchasesHub.action.newOrder", screen: "purchase-orders" },
  { label: "purchasesHub.action.receipt", screen: "goods-receipts" },
  { label: "purchasesHub.action.newInvoice", screen: "purchase-invoices" },
  { label: "purchasesHub.action.rfq", screen: "rfqs" },
  { label: "purchasesHub.action.returns", screen: "purchase-returns" },
];

function num(value: string | undefined | null): number {
  return value ? Number(value) : 0;
}

export function PurchasesHubScreen() {
  const { t } = useAppTranslation();
  const { navigate } = useNavigation();
  const ordersQuery = usePurchaseOrders();
  const receiptsQuery = useGoodsReceipts();
  const invoicesQuery = usePurchaseInvoices();
  const suppliersQuery = useSuppliers();

  const orders = ordersQuery.data ?? [];
  const receipts = receiptsQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];
  const suppliers = suppliersQuery.data ?? [];

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
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">{t("purchasesHub.title")}</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("purchasesHub.description")}</p>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {quickActions.map((action, index) => (
            <Button key={action.screen} size="sm" variant={index === 0 ? "primary" : "default"} onClick={() => navigate(action.screen)}>
              {t(action.label)}
            </Button>
          ))}
        </div>
      </div>

      {isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("purchasesHub.loadFailed")}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label={t("purchasesHub.stat.openOrders")} value={isLoading ? "—" : openOrders} sub={t("purchasesHub.stat.openOrdersSub")} />
        <StatCard label={t("purchasesHub.stat.uninvoiced")} value={isLoading ? "—" : uninvoicedReceipts} sub={t("purchasesHub.stat.uninvoicedSub")} />
        <StatCard label={t("purchasesHub.stat.invoices")} value={isLoading ? "—" : invoices.length} sub={t("purchasesHub.stat.invoicesSub")} />
        <StatCard label={t("purchasesHub.stat.suppliers")} value={isLoading ? "—" : suppliers.length} sub={t("purchasesHub.stat.suppliersSub")} />
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">{t("purchasesHub.recent")}</h3>
        <div className="mb-[10px] mt-[2px] text-[11.5px] text-ink-faint">{t("purchasesHub.recentSub")}</div>
        {recentInvoices.length > 0 ? (
          <ul className="flex flex-col gap-[10px]">
            {recentInvoices.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-[10px]">
                <div>
                  <div className="text-[12.5px] text-ink">{supplierName(inv.supplierId)}</div>
                  <div className="mt-[1px] text-[11px] text-ink-faint">
                    <span className="mz-num">{inv.date}</span>
                    <span className="mz-lat"> · {inv.number}</span>
                  </div>
                </div>
                <Money value={num(inv.total)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-muted">{t("purchasesHub.empty")}</p>
        )}
      </Card>
    </div>
  );
}
