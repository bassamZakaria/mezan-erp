import { createRepDailyReport, withoutCost } from "@mezan/domain";
import { ReportScreen } from "../../reports/ReportScreen";
import { monthStartIso, todayIso } from "../../../lib/dates";
import { useMaySeeItemCost } from "../../../data/item-cost";

export function RepDailyReportScreen() {
  const definition = createRepDailyReport(monthStartIso(), todayIso());
  return <ReportScreen definition={useMaySeeItemCost() ? definition : withoutCost(definition)} apiPath="/field/rep-daily" />;
}
