import { createPurchasesByPeriodReport, createPurchasesBySupplierReport, createPurchasesByItemReport } from "@mezan/domain";
import { ReportScreen } from "./ReportScreen";
import { monthStartIso, todayIso } from "../../lib/dates";

/** المشتريات — Purchases reports (docs/catalog/08-reports.md), each a thin `ReportScreen` over `/reports/purchases/*`. */

const TODAY = todayIso();
const MONTH_START = monthStartIso();

export function PurchasesByPeriodReportScreen() {
  return <ReportScreen definition={createPurchasesByPeriodReport(MONTH_START, TODAY)} apiPath="/purchases/by-period" />;
}

export function PurchasesBySupplierReportScreen() {
  return <ReportScreen definition={createPurchasesBySupplierReport(MONTH_START, TODAY)} apiPath="/purchases/by-supplier" />;
}

export function PurchasesByItemReportScreen() {
  return <ReportScreen definition={createPurchasesByItemReport(MONTH_START, TODAY)} apiPath="/purchases/by-item" />;
}
