import { createVanSalesReport } from "@mezan/domain";
import { ReportScreen } from "./ReportScreen";

/** المبيعات الميدانية — van-trip reports, a thin `ReportScreen` over `/reports/field/*`. */

const TODAY = "2026-08-22";
const MONTH_START = "2026-08-01";

export function VanSalesReportScreen() {
  return <ReportScreen eyebrow="المبيعات الميدانية · التقارير" definition={createVanSalesReport(MONTH_START, TODAY)} apiPath="/field/van-sales" />;
}
