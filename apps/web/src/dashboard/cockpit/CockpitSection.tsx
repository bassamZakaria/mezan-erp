import { Fragment, useMemo, type ReactNode } from "react";
import { Button, Card, Select, cn, useFormat, type SelectOption } from "@mezan/ui";
import { UNATTRIBUTED_BRANCH_ID, type DashboardWidget } from "@mezan/domain";
import { useAppTranslation } from "../../i18n";
import { useBranches } from "../../data/hooks";
import { useUrlParam } from "../../lib/url-state";
import { majorOf, scaledOf } from "../../lib/money";
import { CockpitWidgetKind } from "../widget-registry";
import { useBookVersionWatch, useCockpit } from "./cockpit-hooks";
import {
  CockpitCashTile,
  CockpitLowStockTile,
  CockpitMarginTile,
  CockpitMoversTile,
  CockpitOverdueTile,
  CockpitPulse,
  CockpitRunway,
  type CockpitWidgetProps,
} from "./CockpitWidgets";

const SPAN: Readonly<Record<DashboardWidget["size"], string>> = {
  sm: "col-span-1",
  md: "col-span-2",
  lg: "col-span-2",
  full: "col-span-2 lg:col-span-4",
};

const ALL_BRANCHES = "all";

export function CockpitSection({ widgets, rtl }: { readonly widgets: readonly DashboardWidget[]; readonly rtl: boolean }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const [branchParam, setBranchParam] = useUrlParam("branch", "");
  const cockpit = useCockpit(branchParam, true);
  const watch = useBookVersionWatch(true, cockpit.data?.bookVersion ?? null);
  const branchRows = useBranches().data;
  const data = cockpit.data;

  const branchOptions = useMemo<SelectOption[]>(
    () => [
      { value: ALL_BRANCHES, label: t("cockpit.branch.all") },
      ...(branchRows ?? []).map((branch) => ({ value: branch.id, label: branch.name })),
      { value: UNATTRIBUTED_BRANCH_ID, label: t("cockpit.branch.unattributed") },
    ],
    [branchRows, t],
  );

  const props: CockpitWidgetProps | null = data ? { data, rtl, branchParam } : null;
  const render = (kind: string): ReactNode => {
    if (kind === CockpitWidgetKind.Runway) return <CockpitRunway companyWide={branchParam !== ""} />;
    if (!props) return null;
    switch (kind) {
      case CockpitWidgetKind.Pulse:
        return <CockpitPulse {...props} />;
      case CockpitWidgetKind.Overdue:
        return props.data.overdueReceivables ? <CockpitOverdueTile {...props} /> : null;
      case CockpitWidgetKind.LowStock:
        return props.data.lowStock ? <CockpitLowStockTile {...props} /> : null;
      case CockpitWidgetKind.Cash:
        return props.data.cash ? <CockpitCashTile {...props} /> : null;
      case CockpitWidgetKind.Movers:
        return props.data.topMovers ? <CockpitMoversTile {...props} /> : null;
      case CockpitWidgetKind.Margin:
        return props.data.marginTrend ? <CockpitMarginTile {...props} /> : null;
      default:
        return null;
    }
  };

  const unattributedSales = data ? scaledOf(data.unattributed.sales7d) : 0n;
  const unattributedCollections = data ? scaledOf(data.unattributed.collections7d) : 0n;
  const showUnattributed = data !== undefined && data.branchNarrowed && branchParam !== UNATTRIBUTED_BRANCH_ID && (unattributedSales !== 0n || unattributedCollections !== 0n);
  const updatedAt = data ? format.time(data.generatedAt, true) : null;

  return (
    <section aria-labelledby="cockpit-title" className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-end justify-between gap-[10px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-[8px]">
            <h2 id="cockpit-title" className="font-display text-lg font-bold text-ink">
              {t("cockpit.title")}
            </h2>
            <span
              className={cn(
                "inline-flex items-center gap-[5px] rounded-full px-[8px] py-[2px] text-2xs font-semibold",
                watch.isError ? "bg-warning-soft text-warning-ink" : "bg-success-soft text-success-ink",
              )}
              title={t("cockpit.liveHint")}
            >
              <span aria-hidden className={cn("h-[6px] w-[6px] rounded-full", watch.isError ? "bg-warning" : "bg-success")} />
              {t("cockpit.live")}
            </span>
          </div>
          <p className="mt-[2px] max-w-[62ch] text-2xs text-ink-faint">{t("cockpit.subtitle")}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-[8px] sm:w-auto">
          <div className="min-w-0 flex-1 sm:w-[200px] sm:flex-none">
            <Select
              size="sm"
              aria-label={t("cockpit.branch.label")}
              value={branchParam === "" ? ALL_BRANCHES : branchParam}
              onChange={(value) => setBranchParam(value === ALL_BRANCHES ? "" : value)}
              options={branchOptions}
            />
          </div>
          <Button size="sm" onClick={() => void cockpit.refetch()} disabled={cockpit.isFetching}>
            {t("cockpit.refresh")}
          </Button>
        </div>
      </div>

      <p className="text-2xs text-ink-faint" aria-live="polite">
        {updatedAt ? t("cockpit.updatedAt", { time: updatedAt }) : t("cockpit.loading")}
      </p>

      {cockpit.isError ? (
        <Card className="p-[14px_16px]">
          <p className="text-sm font-semibold text-danger-ink">{cockpit.error?.message ?? t("cockpit.loadFailed")}</p>
          <Button size="sm" className="mt-[8px]" onClick={() => void cockpit.refetch()}>
            {t("cockpit.retry")}
          </Button>
        </Card>
      ) : null}

      {showUnattributed ? (
        <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px] rounded-md border border-border bg-surface-2 p-[8px_12px] text-2xs text-ink-muted">
          <span className="min-w-0">
            {t("cockpit.branch.unattributedNote", {
              sales: format.money(majorOf(data.unattributed.sales7d)),
              collections: format.money(majorOf(data.unattributed.collections7d)),
              included: t(branchParam === "" ? "cockpit.branch.unattributedIncluded" : "cockpit.branch.unattributedExcluded"),
            })}
          </span>
          <button type="button" className="font-semibold text-brand hover:underline" onClick={() => setBranchParam(UNATTRIBUTED_BRANCH_ID)}>
            {t("cockpit.branch.unattributedShow")}
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
        {widgets.map((widget) => {
          const node = render(widget.kind);
          if (!node) return null;
          return (
            <Fragment key={widget.id}>
              <div className={cn("min-w-0", SPAN[widget.size] ?? "col-span-2")}>{node}</div>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
