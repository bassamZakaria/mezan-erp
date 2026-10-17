import { createRepDailyReport } from "@mezan/domain";
import { ReportScreen } from "../../reports/ReportScreen";
import { monthStartIso, todayIso } from "../../../lib/dates";

export function RepDailyReportScreen() {
  return <ReportScreen definition={createRepDailyReport(monthStartIso(), todayIso())} apiPath="/field/rep-daily" />;
}
