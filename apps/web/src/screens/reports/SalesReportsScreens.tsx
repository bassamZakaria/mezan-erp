import {
  createSalesByPeriodReport,
  createSalesByItemReport,
  createSalesByCustomerReport,
  createTopProductsReport,
} from "@mezan/domain";
import { ReportScreen } from "./ReportScreen";

/** المبيعات — Sales reports (docs/catalog/08-reports.md), each a thin `ReportScreen` over `/reports/sales/*`. */

const TODAY = "2026-08-22";
const MONTH_START = "2026-08-01";

export function SalesByPeriodReportScreen() {
  return <ReportScreen eyebrow="المبيعات · التقارير" definition={createSalesByPeriodReport(MONTH_START, TODAY)} apiPath="/sales/by-period" />;
}

export function SalesByItemReportScreen() {
  return <ReportScreen eyebrow="المبيعات · التقارير" definition={createSalesByItemReport(MONTH_START, TODAY)} apiPath="/sales/by-item" />;
}

export function SalesByCustomerReportScreen() {
  return <ReportScreen eyebrow="المبيعات · التقارير" definition={createSalesByCustomerReport(MONTH_START, TODAY)} apiPath="/sales/by-customer" />;
}

export function TopProductsReportScreen() {
  return <ReportScreen eyebrow="المبيعات · التقارير" definition={createTopProductsReport(MONTH_START, TODAY)} apiPath="/sales/top-products" />;
}
