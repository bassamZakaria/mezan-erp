import { useMemo } from "react";
import { Button, Money, StatusPill, WorkspaceHub } from "@mezan/ui";
import { useManufacturingDashboard } from "../../data/hub-hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../router/screens";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { useMaySeeItemCost } from "../../data/item-cost";

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
export function ManufacturingHubScreen() {
  const { t } = useAppTranslation();
  const { navigate } = useNavigation();
  const dashboardQuery = useManufacturingDashboard();
  const showCost = useMaySeeItemCost();
  const dashboard = dashboardQuery.data;

  const activeOrders = useMemo(() => dashboard?.activeOrders.slice(0, 5) ?? [], [dashboard]);

  return (
    <WorkspaceHub
      title={t("manufacturingHub.title")}
      description={t("manufacturingHub.description")}
      loading={dashboardQuery.isLoading}
      error={dashboardQuery.isError ? t("manufacturingHub.loadFailed") : null}
      stats={[
        { key: "orders", label: t("manufacturingHub.stat.activeOrders"), value: dashboard?.kpis.activeWorkOrders ?? 0, sub: t("manufacturingHub.stat.activeOrdersSub") },
        ...(showCost ? [{ key: "wip", label: t("manufacturingHub.stat.wip"), value: <Money value={num(dashboard?.kpis.wipValue)} />, sub: t("manufacturingHub.stat.wipSub") }] : []),
        { key: "produced", label: t("manufacturingHub.stat.produced"), value: num(dashboard?.kpis.unitsProducedThisMonth), sub: t("manufacturingHub.stat.producedSub") },
        ...(showCost ? [{ key: "unitCost", label: t("manufacturingHub.stat.unitCost"), value: <Money value={num(dashboard?.kpis.avgCostPerUnit)} />, sub: t("manufacturingHub.stat.unitCostSub") }] : []),
      ]}
      list={{
        title: t("manufacturingHub.activeHeading"),
        sub: dashboard ? t("manufacturingHub.overdueCount", { count: dashboard.overdueCount }) : "—",
        empty: t("manufacturingHub.empty"),
        action: (
          <Button size="sm" variant="ghost" onClick={() => navigate("production-dashboard")}>
            {t("manufacturingHub.openDashboard")}
          </Button>
        ),
        rows: activeOrders.map((o) => ({
          key: o.id,
          primary: <span className="mz-lat font-semibold">{o.number}</span>,
          secondary: (
            <>
              {t("manufacturingHub.priorityPrefix", { priority: priorityLabel(o.priority, t) })} ·{" "}
              <span className="mz-num">{num(o.producedQty)}</span>/<span className="mz-num">{num(o.plannedQty)}</span>
            </>
          ),
          trailing: o.overdue ? (
            <StatusPill label={t("manufacturingHub.overdue")} tone="danger" />
          ) : (
            <StatusPill label={`${Math.round(o.progress * 100)}%`} tone="info" />
          ),
        })),
      }}
    />
  );
}
