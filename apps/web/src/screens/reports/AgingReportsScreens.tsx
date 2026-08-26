import { createAgingCustomersReport, createAgingSuppliersReport } from "@mezan/domain";
import { ReportScreen } from "./ReportScreen";
import { todayIso } from "../../lib/dates";

/** أعمار الديون — Aging reports (docs/catalog/08-reports.md), each a thin `ReportScreen` over `/reports/aging/*`. */

const TODAY = todayIso();

export function AgingCustomersReportScreen() {
  return <ReportScreen definition={createAgingCustomersReport(TODAY)} apiPath="/aging/customers" />;
}

export function AgingSuppliersReportScreen() {
  return <ReportScreen definition={createAgingSuppliersReport(TODAY)} apiPath="/aging/suppliers" />;
}
