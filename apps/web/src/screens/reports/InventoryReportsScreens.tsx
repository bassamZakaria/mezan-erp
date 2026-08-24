import {
  createInventoryStockLevelsReport,
  createInventoryMovementReport,
  createInventoryLedgerReport,
  createInventoryValuationReport,
  createInventoryAgingReport,
  createInventoryExpiringReport,
  createInventorySlowMovingReport,
  createInventoryDriftReport,
} from "@mezan/domain";
import { ReportScreen } from "./ReportScreen";

/** المخزون — Inventory reports (docs/catalog/08-reports.md), each a thin `ReportScreen` over `/reports/inventory/*`. */

const TODAY = "2026-08-22";
const MONTH_START = "2026-08-01";

export function InventoryStockLevelsReportScreen() {
  return <ReportScreen eyebrow="eyebrow.reports.inventory" definition={createInventoryStockLevelsReport()} apiPath="/inventory/stock-levels" />;
}

export function InventoryMovementReportScreen() {
  return <ReportScreen eyebrow="eyebrow.reports.inventory" definition={createInventoryMovementReport(MONTH_START, TODAY)} apiPath="/inventory/movement" />;
}

export function InventoryLedgerReportScreen() {
  return <ReportScreen eyebrow="eyebrow.reports.inventory" definition={createInventoryLedgerReport()} apiPath="/inventory/ledger" />;
}

export function InventoryValuationReportScreen() {
  return <ReportScreen eyebrow="eyebrow.reports.inventory" definition={createInventoryValuationReport()} apiPath="/inventory/valuation" />;
}

export function InventoryAgingReportScreen() {
  return <ReportScreen eyebrow="eyebrow.reports.inventory" definition={createInventoryAgingReport(TODAY)} apiPath="/inventory/aging" />;
}

export function InventoryExpiringReportScreen() {
  return <ReportScreen eyebrow="eyebrow.reports.inventory" definition={createInventoryExpiringReport(TODAY)} apiPath="/inventory/expiring" />;
}

export function InventorySlowMovingReportScreen() {
  return <ReportScreen eyebrow="eyebrow.reports.inventory" definition={createInventorySlowMovingReport(TODAY)} apiPath="/inventory/slow-moving" />;
}

export function InventoryDriftReportScreen() {
  return <ReportScreen eyebrow="eyebrow.reports.inventory" definition={createInventoryDriftReport()} apiPath="/inventory/drift" />;
}
