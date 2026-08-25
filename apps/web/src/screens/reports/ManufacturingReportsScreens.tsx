import { createMakeVsBuyReport } from "@mezan/domain";
import { ReportScreen } from "./ReportScreen";

/** التصنيع — Manufacturing reports (docs/catalog/07 §التصنيع مقابل الشراء), a thin `ReportScreen` over `/reports/manufacturing/*`. */

export function MakeVsBuyReportScreen() {
  return <ReportScreen definition={createMakeVsBuyReport()} apiPath="/manufacturing/make-vs-buy" />;
}
