import { useMemo } from "react";
import { Button, Card, Money, StatusPill } from "@mezan/ui";
import { useManufacturingDashboard } from "../../data/hub-hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../App";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";

/**
 * التصنيع hub — the manufacturing-domain landing page. Its KPI tiles reuse
 * the SAME `GET /manufacturing/dashboard` figures the production dashboard
 * (لوحة الإنتاج) computes server-side; this screen is the lighter entry
 * point that then links into that fuller داشبورد, work orders and BOMs.
 */

/** An unknown priority shows its own code rather than a humanized key. */
function priorityLabel(priority: string, t: (key: AppTranslationKey) => string): string {
  const key = PRIORITY_KEY[priority];
  return key ? t(key) : priority;
}

const PRIORITY_KEY: Record<string, AppTranslationKey> = {
  low: "manufacturingHub.priority.low",
  normal: "manufacturingHub.priority.normal",
  high: "manufacturingHub.priority.high",
};

function num(value: string | undefined): number {
  return value ? Number(value) : 0;
}

/**
 * NO QUICK ACTIONS. Every destination this overview used to repeat is on the
 * bar above it — لوحة الإنتاج، أوامر التصنيع، التصنيع المخصص — and a button
 * that duplicates a chip two centimetres away is a second name for one place.
 * قوائم المواد moved to the ORDERS screen instead: that is where a recipe is
 * actually needed, because it is where «أمر تصنيع جديد» asks for one.
 */
const quickActions: { label: AppTranslationKey; screen: ScreenKey }[] = [];

export function ManufacturingHubScreen() {
  const { t } = useAppTranslation();
  const { navigate } = useNavigation();
  const dashboardQuery = useManufacturingDashboard();
  const dashboard = dashboardQuery.data;

  const activeOrders = useMemo(() => dashboard?.activeOrders.slice(0, 5) ?? [], [dashboard]);

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">{t("manufacturingHub.title")}</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("manufacturingHub.description")}</p>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {quickActions.map((action, index) => (
            <Button key={action.screen} size="sm" variant={index === 0 ? "primary" : "default"} onClick={() => navigate(action.screen)}>
              {t(action.label)}
            </Button>
          ))}
        </div>
      </div>

      {dashboardQuery.isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("manufacturingHub.loadFailed")}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">{t("manufacturingHub.stat.activeOrders")}</div>
          <div className="mt-2 font-display text-[25px] font-bold text-ink">{dashboardQuery.isLoading ? "—" : dashboard?.kpis.activeWorkOrders}</div>
          <div className="mt-[6px] text-[11px] text-ink-faint">{t("manufacturingHub.stat.activeOrdersSub")}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">{t("manufacturingHub.stat.wip")}</div>
          <div className="mt-2 font-display text-[25px] font-bold text-ink"><Money value={num(dashboard?.kpis.wipValue)} /></div>
          <div className="mt-[6px] text-[11px] text-ink-faint">WIP</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">{t("manufacturingHub.stat.produced")}</div>
          <div className="mt-2 font-display text-[25px] font-bold text-ink mz-num">{dashboardQuery.isLoading ? "—" : num(dashboard?.kpis.unitsProducedThisMonth)}</div>
          <div className="mt-[6px] text-[11px] text-ink-faint">{t("manufacturingHub.stat.producedSub")}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">{t("manufacturingHub.stat.unitCost")}</div>
          <div className="mt-2 font-display text-[25px] font-bold text-ink"><Money value={num(dashboard?.kpis.avgCostPerUnit)} /></div>
          <div className="mt-[6px] text-[11px] text-ink-faint">{t("manufacturingHub.stat.unitCostSub")}</div>
        </div>
      </div>

      <Card className="p-[18px_20px]">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-[14.5px] font-bold text-ink">{t("manufacturingHub.activeHeading")}</h3>
            <div className="mt-[2px] text-[11.5px] text-ink-faint">
              {dashboard ? t("manufacturingHub.overdueCount", { count: dashboard.overdueCount }) : "—"}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => navigate("production-dashboard")}>
            {t("manufacturingHub.openDashboard")}
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
                      {t("manufacturingHub.priorityPrefix", { priority: priorityLabel(o.priority, t) })} · <span className="mz-num">{num(o.producedQty)}</span>/<span className="mz-num">{num(o.plannedQty)}</span>
                    </div>
                  </div>
                  {o.overdue ? <StatusPill label={t("manufacturingHub.overdue")} tone="danger" /> : <StatusPill label={`${Math.round(o.progress * 100)}%`} tone="info" />}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-muted">{t("manufacturingHub.empty")}</p>
          )}
        </div>
      </Card>
    </div>
  );
}
