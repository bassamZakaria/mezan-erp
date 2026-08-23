import { useMemo } from "react";
import { Button, Card, Money, StatusPill } from "@mezan/ui";
import { useManufacturingDashboard } from "../../data/hub-hooks";
import { useNavigate } from "../../navigation";

/**
 * التصنيع hub — the manufacturing-domain landing page. Its KPI tiles reuse
 * the SAME `GET /manufacturing/dashboard` figures the production dashboard
 * (لوحة الإنتاج) computes server-side; this screen is the lighter entry
 * point that then links into that fuller داشبورد, work orders and BOMs.
 */

const PRIORITY_LABEL: Record<string, string> = { low: "منخفضة", normal: "عادية", high: "عالية" };

function num(value: string | undefined): number {
  return value ? Number(value) : 0;
}

const quickActions: { label: string; screen: string }[] = [
  { label: "أمر تصنيع جديد", screen: "work-orders" },
  { label: "لوحة الإنتاج", screen: "production-dashboard" },
  { label: "قوائم المواد", screen: "boms" },
  { label: "التصنيع المخصص", screen: "custom-manufacturing" },
];

export function ManufacturingHubScreen() {
  const navigate = useNavigate();
  const dashboardQuery = useManufacturingDashboard();
  const dashboard = dashboardQuery.data;

  const activeOrders = useMemo(() => dashboard?.activeOrders.slice(0, 5) ?? [], [dashboard]);

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <div className="mz-lat text-[11px] font-bold uppercase tracking-[1.2px] text-ink-faint">Manufacturing</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">التصنيع</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">أوامر التصنيع وقوائم المواد — من لوحة الإنتاج الفعلية</p>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {quickActions.map((action, index) => (
            <Button key={action.screen} size="sm" variant={index === 0 ? "primary" : "default"} onClick={() => navigate(action.screen)}>
              {action.label}
            </Button>
          ))}
        </div>
      </div>

      {dashboardQuery.isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل بيانات التصنيع.</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">أوامر تصنيع نشطة</div>
          <div className="mt-2 font-display text-[25px] font-bold text-ink">{dashboardQuery.isLoading ? "—" : dashboard?.kpis.activeWorkOrders}</div>
          <div className="mt-[6px] text-[11px] text-ink-faint">قيد التنفيذ الآن</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">قيمة الإنتاج تحت التشغيل</div>
          <div className="mt-2 font-display text-[25px] font-bold text-ink"><Money value={num(dashboard?.kpis.wipValue)} /></div>
          <div className="mt-[6px] text-[11px] text-ink-faint">WIP</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">الوحدات المنتجة هذا الشهر</div>
          <div className="mt-2 font-display text-[25px] font-bold text-ink mz-num">{dashboardQuery.isLoading ? "—" : num(dashboard?.kpis.unitsProducedThisMonth)}</div>
          <div className="mt-[6px] text-[11px] text-ink-faint">أوامر مكتملة هذا الشهر</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">متوسط تكلفة الوحدة</div>
          <div className="mt-2 font-display text-[25px] font-bold text-ink"><Money value={num(dashboard?.kpis.avgCostPerUnit)} /></div>
          <div className="mt-[6px] text-[11px] text-ink-faint">هذا الشهر</div>
        </div>
      </div>

      <Card className="p-[18px_20px]">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-[14.5px] font-bold text-ink">أوامر التصنيع النشطة</h3>
            <div className="mt-[2px] text-[11.5px] text-ink-faint">
              {dashboard ? `${dashboard.overdueCount} أمر متأخر عن الموعد المجدول` : "—"}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => navigate("production-dashboard")}>
            عرض لوحة الإنتاج الكاملة
          </Button>
        </div>
        <div className="mt-[14px]">
          {activeOrders.length > 0 ? (
            <ul className="flex flex-col gap-[10px]">
              {activeOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-[10px]">
                  <div>
                    <div className="mz-lat text-[12.5px] font-semibold text-ink">{o.number}</div>
                    <div className="mt-[1px] text-[11px] text-ink-faint">
                      أولوية {PRIORITY_LABEL[o.priority] ?? o.priority} · <span className="mz-num">{num(o.producedQty)}</span>/<span className="mz-num">{num(o.plannedQty)}</span>
                    </div>
                  </div>
                  {o.overdue ? <StatusPill label="متأخر" tone="danger" /> : <StatusPill label={`${Math.round(o.progress * 100)}%`} tone="info" />}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-muted">لا توجد أوامر تصنيع نشطة حالياً.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
