import { createVanSalesReport } from "@mezan/domain";
import { ReportScreen } from "./ReportScreen";
import { monthStartIso, todayIso } from "../../lib/dates";

/** المبيعات الميدانية — van-trip reports, a thin `ReportScreen` over `/reports/field/*`. */

const TODAY = todayIso();
const MONTH_START = monthStartIso();

export function VanSalesReportScreen() {
  return <ReportScreen definition={createVanSalesReport(MONTH_START, TODAY)} apiPath="/field/van-sales" />;
}
