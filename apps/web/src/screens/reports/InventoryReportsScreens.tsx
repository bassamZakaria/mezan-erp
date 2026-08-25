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
  return <ReportScreen definition={createInventoryStockLevelsReport()} apiPath="/inventory/stock-levels" />;
}

export function InventoryMovementReportScreen() {
  return <ReportScreen definition={createInventoryMovementReport(MONTH_START, TODAY)} apiPath="/inventory/movement" />;
}

export function InventoryLedgerReportScreen() {
  return <ReportScreen definition={createInventoryLedgerReport()} apiPath="/inventory/ledger" />;
}

export function InventoryValuationReportScreen() {
  return <ReportScreen definition={createInventoryValuationReport()} apiPath="/inventory/valuation" />;
}

export function InventoryAgingReportScreen() {
  return <ReportScreen definition={createInventoryAgingReport(TODAY)} apiPath="/inventory/aging" />;
}

export function InventoryExpiringReportScreen() {
  return <ReportScreen definition={createInventoryExpiringReport(TODAY)} apiPath="/inventory/expiring" />;
}

export function InventorySlowMovingReportScreen() {
  return <ReportScreen definition={createInventorySlowMovingReport(TODAY)} apiPath="/inventory/slow-moving" />;
}

export function InventoryDriftReportScreen() {
  return <ReportScreen definition={createInventoryDriftReport()} apiPath="/inventory/drift" />;
}
