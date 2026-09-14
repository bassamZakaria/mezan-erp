import { createSimplifiedRegimeComparisonReport } from "@mezan/domain";
import { ReportScreen } from "../reports/ReportScreen";
import { yearStartIso, todayIso } from "../../lib/dates";

/**
 * مقارنة النظام الضريبي المبسط بالنظام العادي — the screen that makes the
 * feature worth having: the same year priced both ways, side by side.
 *
 * It is the generic `ReportScreen` over `/tax/simplified-regime/comparison`,
 * so the columns, parameters and copy are the report definition's own and
 * cannot drift from what the server computed. The rows it cannot price are
 * rendered empty with the article cited rather than filled with a guess.
 */

export function SimplifiedRegimeComparisonScreen() {
  return (
    <ReportScreen
      definition={createSimplifiedRegimeComparisonReport(yearStartIso(), todayIso())}
      apiRoot="/tax/simplified-regime"
      apiPath="/comparison"
    />
  );
}
