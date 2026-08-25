import { FulcrumRule, Button, Card, Money, StatusPill } from "@mezan/ui";
import { useManufacturingDashboard, type ProductionBucketOrderDTO } from "../../data/hub-hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../App";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";

/**
 * لوحة الإنتاج (docs/catalog/07 §"لوحة الإنتاج") — the reference app's
 * `/manufacturing/dashboard` screen. `GET /manufacturing/dashboard` already
 * exists (packages/api/src/manufacturing-routes.ts ~line 662) and computes
 * every figure below server-side from the real work-order repository; this
 * screen is purely a render of that response.
 */

const PRIORITY_KEY: Record<string, AppTranslationKey> = { low: "production.low", normal: "production.normal", high: "production.high" };
const NEXT_ACTION_KEY: Record<string, AppTranslationKey> = {
  start: "production.startIt",
  issue: "production.issueTheMaterials",
  receive: "production.receiveTheProduct",
  complete: "production.closeTheOrder",
};

function num(value: string | undefined): number {
  return value ? Number(value) : 0;
}

function BucketList({ title, orders }: { title: string; orders: readonly ProductionBucketOrderDTO[] }) {
  const { t } = useAppTranslation();
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
                {o.overdue ? <StatusPill label={t("production.late")} tone="danger" /> : null}
              </div>
              <div className="mt-[3px] text-[11px] text-ink-faint">
                <span className="mz-num">{num(o.producedQty)}</span>/<span className="mz-num">{num(o.plannedQty)}</span> {t("production.priority")} {PRIORITY_KEY[o.priority] ? t(PRIORITY_KEY[o.priority]!) : o.priority}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-[10px] text-[12px] text-ink-muted">{t("production.noOrdersAreAtThis")}</p>
      )}
    </Card>
  );
}

export function ProductionDashboardScreen() {
  const { t } = useAppTranslation();
  const { navigate } = useNavigation();
  const query = useManufacturingDashboard();
  const dashboard = query.data;

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">{t("production.productionDashboard")}</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("production.theLiveStateOfThe")}</p>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          <Button size="sm" variant="primary" onClick={() => navigate("work-orders")}>
            {t("production.workOrders")}
          </Button>
          <Button size="sm" onClick={() => navigate("boms")}>
            {t("production.billsOfMaterials")}
          </Button>
        </div>
      </div>
      <div className="-mt-[18px] -mb-[22px]">
        <FulcrumRule />
      </div>

      {query.isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("production.couldNotLoadTheProduction")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">{t("production.activeOrders")}</div>
          <div className="mt-2 font-display text-[25px] font-bold text-ink mz-num">{query.isLoading ? "—" : dashboard?.kpis.activeWorkOrders}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">{t("production.workInProgressValue")}</div>
          <div className="mt-2 font-display text-[25px] font-bold text-ink"><Money value={num(dashboard?.kpis.wipValue)} /></div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">{t("production.unitsProducedThisMonth")}</div>
          <div className="mt-2 font-display text-[25px] font-bold text-ink mz-num">{query.isLoading ? "—" : num(dashboard?.kpis.unitsProducedThisMonth)}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-[16px_18px] shadow-1">
          <div className="text-[11.5px] font-semibold text-ink-muted">{t("production.lateOrders")}</div>
          <div className={`mt-2 font-display text-[25px] font-bold mz-num ${dashboard && dashboard.overdueCount > 0 ? "text-danger-ink" : "text-ink"}`}>
            {query.isLoading ? "—" : dashboard?.overdueCount}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-3">
        <BucketList title={t("production.waitingOnMaterials")} orders={dashboard?.buckets.awaitingMaterialIssue ?? []} />
        <BucketList title={t("production.waitingOnTheProduct")} orders={dashboard?.buckets.awaitingProductReceipt ?? []} />
        <BucketList title={t("production.readyToClose")} orders={dashboard?.buckets.readyToComplete ?? []} />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border p-[16px_18px]">
          <h3 className="font-display text-[14.5px] font-bold text-ink">{t("production.everyActiveOrder")}</h3>
        </div>
        {dashboard && dashboard.activeOrders.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-start text-[11px] text-ink-faint">
                  <th className="p-[10px_16px] text-start font-semibold">{t("production.order")}</th>
                  <th className="p-[10px_16px] text-start font-semibold">{t("production.progress")}</th>
                  <th className="p-[10px_16px] text-start font-semibold">{t("production.priority2")}</th>
                  <th className="p-[10px_16px] text-start font-semibold">{t("production.due")}</th>
                  <th className="p-[10px_16px] text-start font-semibold">{t("production.nextStep")}</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.activeOrders.map((o) => (
                  <tr key={o.id} className="border-b border-border last:border-b-0">
                    <td className="p-[10px_16px]">
                      <span className="mz-lat font-semibold text-ink">{o.number}</span>
                      {o.overdue ? <span className="ms-[8px]"><StatusPill label={t("production.late")} tone="danger" /></span> : null}
                    </td>
                    <td className="p-[10px_16px]">
                      <span className="mz-num">{Math.round(o.progress * 100)}%</span>
                      <span className="mz-num text-ink-faint"> ({num(o.producedQty)}/{num(o.plannedQty)})</span>
                    </td>
                    <td className="p-[10px_16px] text-ink-muted">{PRIORITY_KEY[o.priority] ? t(PRIORITY_KEY[o.priority]!) : o.priority}</td>
                    <td className="p-[10px_16px] mz-num text-ink-muted">{o.scheduledEndDate ?? "—"}</td>
                    <td className="p-[10px_16px]">
                      {o.nextAction ? (
                        <Button size="sm" onClick={() => navigate("work-orders")}>
                          {NEXT_ACTION_KEY[o.nextAction] ? t(NEXT_ACTION_KEY[o.nextAction]!) : o.nextAction}
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
          <p className="p-[18px_20px] text-[12.5px] text-ink-muted">{t("production.noWorkOrdersAreActive")}</p>
        )}
      </Card>
    </div>
  );
}
