import { FulcrumRule, Button, Card, Money, StatusPill } from "@mezan/ui";
import { useManufacturingDashboard, type ProductionBucketOrderDTO } from "../../data/hub-hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../App";

/**
 * لوحة الإنتاج (docs/catalog/07 §"لوحة الإنتاج") — the reference app's
 * `/manufacturing/dashboard` screen. `GET /manufacturing/dashboard` already
 * exists (packages/api/src/manufacturing-routes.ts ~line 662) and computes
 * every figure below server-side from the real work-order repository; this
 * screen is purely a render of that response.
 */

const PRIORITY_LABEL: Record<string, string> = { low: "منخفضة", normal: "عادية", high: "عالية" };
const NEXT_ACTION_LABEL: Record<string, string> = {
  start: "بدء التنفيذ",
  issue: "صرف المواد",
  receive: "استلام المنتج",
  complete: "إنهاء الأمر",
};

function num(value: string | undefined): number {
  return value ? Number(value) : 0;
}

function BucketList({ title, orders }: { title: string; orders: readonly ProductionBucketOrderDTO[] }) {
  return (
    <Card className="p-[16px_18px]">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-ink">{title}</h3>
        <span className="mz-num rounded-pill bg-surface-3 px-[9px] py-[2px] text-[11px] font-bold text-ink-muted">{orders.length}</span>
      </div>
      {orders.length > 0 ? (
        <ul className="mt-[10px] flex flex-col gap-[8px]">
          {orders.map((o) => (
            <li key={o.id} className="rounded-md border border-border bg-surface-2 p-[9px_11px]">
              <div className="flex items-center justify-between gap-[8px]">
                <span className="mz-lat text-[12px] font-semibold text-ink">{o.number}</span>
                {o.overdue ? <StatusPill label="متأخر" tone="danger" /> : null}
              </div>
              <div className="mt-[3px] text-[11px] text-ink-faint">
                <span className="mz-num">{num(o.producedQty)}</span>/<span className="mz-num">{num(o.plannedQty)}</span> · أولوية {PRIORITY_LABEL[o.priority] ?? o.priority}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-[10px] text-[12px] text-ink-muted">لا توجد أوامر في هذه المرحلة.</p>
      )}
    </Card>
  );
}

export function ProductionDashboardScreen() {
  const { navigate } = useNavigation();
  const query = useManufacturingDashboard();
  const dashboard = query.data;

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <div className="mz-eyebrow">Manufacturing · Production</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">لوحة الإنتاج</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">حالة أوامر التصنيع الحية — محسوبة من نفس مستودع أوامر التصنيع الفعلي</p>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          <Button size="sm" variant="primary" onClick={() => navigate("work-orders")}>
            أوامر التصنيع
          </Button>
          <Button size="sm" onClick={() => navigate("boms")}>
            قوائم المواد
          </Button>
        </div>
      </div>
      <div className="-mt-[18px] -mb-[22px]">
        <FulcrumRule />
      </div>

      {query.isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل لوحة الإنتاج.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">أوامر نشطة</div>
          <div className="mt-2 font-display text-[25px] font-bold text-ink mz-num">{query.isLoading ? "—" : dashboard?.kpis.activeWorkOrders}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">قيمة الإنتاج تحت التشغيل</div>
          <div className="mt-2 font-display text-[25px] font-bold text-ink"><Money value={num(dashboard?.kpis.wipValue)} /></div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">الوحدات المنتجة هذا الشهر</div>
          <div className="mt-2 font-display text-[25px] font-bold text-ink mz-num">{query.isLoading ? "—" : num(dashboard?.kpis.unitsProducedThisMonth)}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">أوامر متأخرة</div>
          <div className={`mt-2 font-display text-[25px] font-bold mz-num ${dashboard && dashboard.overdueCount > 0 ? "text-danger-ink" : "text-ink"}`}>
            {query.isLoading ? "—" : dashboard?.overdueCount}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-3">
        <BucketList title="بانتظار صرف المواد" orders={dashboard?.buckets.awaitingMaterialIssue ?? []} />
        <BucketList title="بانتظار استلام المنتج" orders={dashboard?.buckets.awaitingProductReceipt ?? []} />
        <BucketList title="جاهزة للإنهاء" orders={dashboard?.buckets.readyToComplete ?? []} />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border p-[16px_18px]">
          <h3 className="font-display text-[14.5px] font-bold text-ink">جميع الأوامر النشطة</h3>
        </div>
        {dashboard && dashboard.activeOrders.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-start text-[11px] text-ink-faint">
                  <th className="p-[10px_16px] text-start font-semibold">الأمر</th>
                  <th className="p-[10px_16px] text-start font-semibold">التقدّم</th>
                  <th className="p-[10px_16px] text-start font-semibold">الأولوية</th>
                  <th className="p-[10px_16px] text-start font-semibold">الموعد المجدول</th>
                  <th className="p-[10px_16px] text-start font-semibold">الإجراء التالي</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.activeOrders.map((o) => (
                  <tr key={o.id} className="border-b border-border last:border-b-0">
                    <td className="p-[10px_16px]">
                      <span className="mz-lat font-semibold text-ink">{o.number}</span>
                      {o.overdue ? <span className="ms-[8px]"><StatusPill label="متأخر" tone="danger" /></span> : null}
                    </td>
                    <td className="p-[10px_16px]">
                      <span className="mz-num">{Math.round(o.progress * 100)}%</span>
                      <span className="mz-num text-ink-faint"> ({num(o.producedQty)}/{num(o.plannedQty)})</span>
                    </td>
                    <td className="p-[10px_16px] text-ink-muted">{PRIORITY_LABEL[o.priority] ?? o.priority}</td>
                    <td className="p-[10px_16px] mz-num text-ink-muted">{o.scheduledEndDate ?? "—"}</td>
                    <td className="p-[10px_16px]">
                      {o.nextAction ? (
                        <Button size="sm" onClick={() => navigate("work-orders")}>
                          {NEXT_ACTION_LABEL[o.nextAction]}
                        </Button>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-[18px_20px] text-[12.5px] text-ink-muted">لا توجد أوامر تصنيع نشطة حالياً.</p>
        )}
      </Card>
    </div>
  );
}
