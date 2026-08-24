import { createInstallmentsOverviewReport, createInstallmentsOverdueReport } from "@mezan/domain";
import { ReportScreen } from "./ReportScreen";

/** الأقساط — Installment reports (docs/catalog/08-reports.md), each a thin `ReportScreen` over `/reports/installments/*`. */

const TODAY = "2026-08-22";

export function InstallmentsOverviewReportScreen() {
  return <ReportScreen eyebrow="eyebrow.reports.installments" definition={createInstallmentsOverviewReport(TODAY)} apiPath="/installments/overview" />;
}

export function InstallmentsOverdueReportScreen() {
  return <ReportScreen eyebrow="eyebrow.reports.installments" definition={createInstallmentsOverdueReport(TODAY)} apiPath="/installments/overdue" />;
}
