import { useMemo } from "react";
import { Button, Card, Money, StatCard } from "@mezan/ui";
import { useGoodsReceipts, usePurchaseInvoices, usePurchaseOrders, useSuppliers } from "../../data/hooks";
import { useNavigate } from "../../navigation";

/**
 * المشتريات hub — KPI tiles + quick actions + recent activity over the real
 * purchase-chain endpoints (`/purchase-orders`, `/goods-receipts`,
 * `/purchase-invoices`, `/suppliers`) already wired in `data/hooks.ts`.
 */

const OPEN_PO_STATUSES = new Set(["sent", "partially_received"]);

const quickActions: { label: string; screen: string }[] = [
  { label: "أمر شراء جديد", screen: "purchase-orders" },
  { label: "استلام بضاعة", screen: "goods-receipts" },
  { label: "فاتورة مشتريات جديدة", screen: "purchase-invoices" },
  { label: "طلب عرض سعر", screen: "rfqs" },
  { label: "مرتجعات المشتريات", screen: "purchase-returns" },
];

function num(value: string | undefined | null): number {
  return value ? Number(value) : 0;
}

export function PurchasesHubScreen() {
  const navigate = useNavigate();
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
          <div className="mz-lat text-[11px] font-bold uppercase tracking-[1.2px] text-ink-faint">Purchases</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">المشتريات</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">سلسلة الشراء الكاملة — أوامر الشراء والاستلام والفواتير</p>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {quickActions.map((action, index) => (
            <Button key={action.screen} size="sm" variant={index === 0 ? "primary" : "default"} onClick={() => navigate(action.screen)}>
              {action.label}
            </Button>
          ))}
        </div>
      </div>

      {isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل بيانات المشتريات.</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label="أوامر شراء مفتوحة" value={isLoading ? "—" : openOrders} sub="مرسلة أو مستلمة جزئياً" />
        <StatCard label="استلامات غير مفوترة" value={isLoading ? "—" : uninvoicedReceipts} sub="بانتظار فاتورة المورد" />
        <StatCard label="فواتير المشتريات" value={isLoading ? "—" : invoices.length} sub="إجمالي الفواتير المسجّلة" />
        <StatCard label="عدد الموردين" value={isLoading ? "—" : suppliers.length} sub="موردون مسجّلون" />
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">أحدث فواتير المشتريات</h3>
        <div className="mb-[10px] mt-[2px] text-[11.5px] text-ink-faint">آخر 5 فواتير مسجّلة</div>
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
          <p className="text-[12.5px] text-ink-muted">لا توجد فواتير مشتريات بعد — ستظهر هنا فور إنشاء أول فاتورة.</p>
        )}
      </Card>
    </div>
  );
}
