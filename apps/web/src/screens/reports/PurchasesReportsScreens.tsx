import { createPurchasesByPeriodReport, createPurchasesBySupplierReport, createPurchasesByItemReport } from "@mezan/domain";
import { ReportScreen } from "./ReportScreen";

/** المشتريات — Purchases reports (docs/catalog/08-reports.md), each a thin `ReportScreen` over `/reports/purchases/*`. */

const TODAY = "2026-08-22";
const MONTH_START = "2026-08-01";

export function PurchasesByPeriodReportScreen() {
  return <ReportScreen eyebrow="eyebrow.reports.purchases" definition={createPurchasesByPeriodReport(MONTH_START, TODAY)} apiPath="/purchases/by-period" />;
}

export function PurchasesBySupplierReportScreen() {
  return <ReportScreen eyebrow="eyebrow.reports.purchases" definition={createPurchasesBySupplierReport(MONTH_START, TODAY)} apiPath="/purchases/by-supplier" />;
}

export function PurchasesByItemReportScreen() {
  return <ReportScreen eyebrow="eyebrow.reports.purchases" definition={createPurchasesByItemReport(MONTH_START, TODAY)} apiPath="/purchases/by-item" />;
}
