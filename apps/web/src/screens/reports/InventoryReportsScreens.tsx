import { useMemo } from "react";
import { Card } from "@mezan/ui";
import {
  createInventoryStockLevelsReport,
  createInventoryMovementReport,
  createInventoryLedgerReport,
  createInventoryValuationReport,
  createInventoryAgingReport,
  createInventoryExpiringReport,
  createInventorySlowMovingReport,
  createInventoryDriftReport,
  type InventoryDriftRow,
} from "@mezan/domain";
import { ReportScreen } from "./ReportScreen";
import { ScreenTabs } from "../ScreenTabs";
import { useReport } from "../../data/reports-hooks";
import { useAppTranslation } from "../../i18n";
import { monthStartIso, todayIso } from "../../lib/dates";

/**
 * المخزون — Inventory reports (docs/archive/catalog/08-reports.md), each a thin
 * `ReportScreen` over `/reports/inventory/*`.
 *
 * FOUR ENTRIES, EIGHT REPORTS. The nav used to list all eight side by side,
 * which read as eight subjects when it is four: the ledger and the movement
 * list are the same `StockMovement` rows (the ledger adds a running balance
 * and no date bound); valuation and its drift are a figure and the check on
 * that figure; ageing, expiry and slow-moving are three questions about old
 * stock. Each surviving screen carries the others as VIEWS, so nothing was
 * dropped and no report lost its own filters — see `ScreenTabs`, which puts
 * the open view in the URL.
 */

const TODAY = todayIso();
const MONTH_START = monthStartIso();

export function InventoryStockLevelsReportScreen() {
  return <ReportScreen definition={createInventoryStockLevelsReport()} apiPath="/inventory/stock-levels" />;
}

/*
 * The four reports the nav stopped listing are still exported, still routable
 * and still exactly themselves — each is the view its surviving sibling opens,
 * and each keeps its own address so a saved link or a drill-down into it is
 * never a dead end.
 */

export function InventoryMovementReportScreen() {
  return <ReportScreen definition={createInventoryMovementReport(MONTH_START, TODAY)} apiPath="/inventory/movement" />;
}

export function InventoryDriftReportScreen() {
  return <ReportScreen definition={createInventoryDriftReport()} apiPath="/inventory/drift" />;
}

export function InventoryExpiringReportScreen() {
  return <ReportScreen definition={createInventoryExpiringReport(TODAY)} apiPath="/inventory/expiring" />;
}

export function InventorySlowMovingReportScreen() {
  return <ReportScreen definition={createInventorySlowMovingReport(TODAY)} apiPath="/inventory/slow-moving" />;
}

/** السجل والحركة — the running-balance ledger, and the same rows as a flat in/out list. */
export function InventoryLedgerReportScreen() {
  const { t } = useAppTranslation();
  return (
    <ScreenTabs
      ariaLabel={t("inventoryReports.views.ledger")}
      tabs={[
        {
          key: "ledger",
          label: t("inventoryReports.view.ledger"),
          render: () => <ReportScreen definition={createInventoryLedgerReport()} apiPath="/inventory/ledger" />,
        },
        {
          key: "movement",
          label: t("inventoryReports.view.movement"),
          render: () => <InventoryMovementReportScreen />,
        },
      ]}
    />
  );
}

const DRIFT_PARAMS = {};

/**
 * التقييم — the valuation, with its own reconciliation check beside it.
 *
 * The drift report is not a second opinion on the valuation: it is the
 * sub-ledger-versus-control-account test on it (كل صنف يخالف فيه متوسط تكلفته
 * قيمة طبقاته). A valuation figure shown with no indication that N items fail
 * that test is the figure this app must never present, so the banner is part
 * of the valuation view rather than a separate nav entry someone has to know
 * to open.
 */
export function InventoryValuationReportScreen() {
  const { t } = useAppTranslation();
  const driftQuery = useReport<InventoryDriftRow>("inventory.drift", "/inventory/drift", DRIFT_PARAMS);
  const driftCount = useMemo(() => driftQuery.data?.rows.length ?? 0, [driftQuery.data]);

  return (
    <ScreenTabs
      ariaLabel={t("inventoryReports.views.valuation")}
      tabs={[
        {
          key: "valuation",
          label: t("inventoryReports.view.valuation"),
          render: () => (
            <div className="flex flex-col gap-[14px]">
              {driftCount > 0 ? (
                <Card className="border-warning bg-warning-soft p-[14px_18px]">
                  <p className="text-[12.5px] font-semibold text-ink">
                    {t("inventoryReports.driftBanner", { count: driftCount })}
                  </p>
                  <p className="mt-[3px] text-[11.5px] text-ink-muted">{t("inventoryReports.driftBannerHint")}</p>
                </Card>
              ) : null}
              <ReportScreen definition={createInventoryValuationReport()} apiPath="/inventory/valuation" />
            </div>
          ),
        },
        {
          key: "drift",
          label: t("inventoryReports.view.drift"),
          render: () => <InventoryDriftReportScreen />,
        },
      ]}
    />
  );
}

/** الأعمار — how old the stock is, when it expires, and what stopped selling. */
export function InventoryAgingReportScreen() {
  const { t } = useAppTranslation();
  return (
    <ScreenTabs
      ariaLabel={t("inventoryReports.views.aging")}
      tabs={[
        {
          key: "aging",
          label: t("inventoryReports.view.aging"),
          render: () => <ReportScreen definition={createInventoryAgingReport(TODAY)} apiPath="/inventory/aging" />,
        },
        {
          key: "expiring",
          label: t("inventoryReports.view.expiring"),
          render: () => <InventoryExpiringReportScreen />,
        },
        {
          key: "slow-moving",
          label: t("inventoryReports.view.slowMoving"),
          render: () => <InventorySlowMovingReportScreen />,
        },
      ]}
    />
  );
}
