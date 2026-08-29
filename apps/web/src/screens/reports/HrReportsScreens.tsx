import {
  createAttendanceSummaryReport,
  createEndOfServiceProvisionReport,
  createHeadcountMovementReport,
  createLeaveLiabilityReport,
  createPayrollRegisterReport,
  createSalaryTaxReturnReport,
  createSocialInsuranceReturnReport,
} from "@mezan/domain";
import { ReportScreen } from "./ReportScreen";
import { todayIso } from "../../lib/dates";

/**
 * تقارير الموارد البشرية — each a thin `ReportScreen` over `/reports/hr/*`,
 * exactly like every other domain's reports.
 *
 * The date-ranged ones default to the current year rather than an empty range:
 * a report that opens on no rows cannot be checked, and an empty screen is the
 * one state where a control cannot be proven to work.
 */

const TODAY = todayIso();
const YEAR_START = `${TODAY.slice(0, 4)}-01-01`;

export function PayrollRegisterReportScreen() {
  return <ReportScreen definition={createPayrollRegisterReport()} apiPath="/hr/payroll-register" />;
}

export function SocialInsuranceReturnReportScreen() {
  return <ReportScreen definition={createSocialInsuranceReturnReport()} apiPath="/hr/social-insurance-return" />;
}

export function SalaryTaxReturnReportScreen() {
  return <ReportScreen definition={createSalaryTaxReturnReport()} apiPath="/hr/salary-tax-return" />;
}

export function AttendanceSummaryReportScreen() {
  const definition = createAttendanceSummaryReport();
  return <ReportScreen definition={{ ...definition, defaultParams: { from: YEAR_START, to: TODAY } }} apiPath="/hr/attendance-summary" />;
}

export function LeaveLiabilityReportScreen() {
  const definition = createLeaveLiabilityReport();
  return <ReportScreen definition={{ ...definition, defaultParams: { asOfDate: TODAY } }} apiPath="/hr/leave-liability" />;
}

export function EndOfServiceProvisionReportScreen() {
  const definition = createEndOfServiceProvisionReport();
  return <ReportScreen definition={{ ...definition, defaultParams: { asOfDate: TODAY } }} apiPath="/hr/end-of-service-provision" />;
}

export function HeadcountMovementReportScreen() {
  const definition = createHeadcountMovementReport();
  return <ReportScreen definition={{ ...definition, defaultParams: { from: YEAR_START, to: TODAY } }} apiPath="/hr/headcount-movement" />;
}
