import { createReturnsFxFaceValueReport } from "@mezan/domain";
import { ReportScreen } from "./ReportScreen";

/**
 * مرتجعات بعملة أجنبية مرحّلة بالقيمة الاسمية (D222) — an exceptions report
 * over `/reports/returns/fx-face-value`. Empty is the clean reading.
 */
export function ReturnsFxFaceValueReportScreen() {
  return <ReportScreen definition={createReturnsFxFaceValueReport()} apiPath="/returns/fx-face-value" />;
}
