import {
  createSalesByPeriodReport,
  createSalesByItemReport,
  createSalesByCustomerReport,
  createSalesBySalespersonReport,
  createTopProductsReport,
} from "@mezan/domain";
import { ReportScreen } from "./ReportScreen";
import { monthStartIso, todayIso } from "../../lib/dates";

/** المبيعات — Sales reports (docs/catalog/08-reports.md), each a thin `ReportScreen` over `/reports/sales/*`. */

const TODAY = todayIso();
const MONTH_START = monthStartIso();

export function SalesByPeriodReportScreen() {
  return <ReportScreen definition={createSalesByPeriodReport(MONTH_START, TODAY)} apiPath="/sales/by-period" />;
}

export function SalesByItemReportScreen() {
  return <ReportScreen definition={createSalesByItemReport(MONTH_START, TODAY)} apiPath="/sales/by-item" />;
}

export function SalesByCustomerReportScreen() {
  return <ReportScreen definition={createSalesByCustomerReport(MONTH_START, TODAY)} apiPath="/sales/by-customer" />;
}

export function SalesBySalespersonReportScreen() {
  return <ReportScreen definition={createSalesBySalespersonReport(MONTH_START, TODAY)} apiPath="/sales/by-salesperson" />;
}

export function TopProductsReportScreen() {
  return <ReportScreen definition={createTopProductsReport(MONTH_START, TODAY)} apiPath="/sales/top-products" />;
}
