import { createAgingCustomersReport, createAgingSuppliersReport } from "@mezan/domain";
import { ReportScreen } from "./ReportScreen";

/** أعمار الديون — Aging reports (docs/catalog/08-reports.md), each a thin `ReportScreen` over `/reports/aging/*`. */

const TODAY = "2026-08-22";

export function AgingCustomersReportScreen() {
  return <ReportScreen eyebrow="أعمار الديون · التقارير" definition={createAgingCustomersReport(TODAY)} apiPath="/aging/customers" />;
}

export function AgingSuppliersReportScreen() {
  return <ReportScreen eyebrow="أعمار الديون · التقارير" definition={createAgingSuppliersReport(TODAY)} apiPath="/aging/suppliers" />;
}
