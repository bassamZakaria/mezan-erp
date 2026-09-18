import {
  createAttendanceSummaryReport,
  createHeadcountMovementReport,
  createLeaveLiabilityReport,
  createPayrollRegisterReport,
} from "@mezan/domain";
import { ReportScreen } from "./ReportScreen";
import { todayIso } from "../../lib/dates";

const TODAY = todayIso();
const YEAR_START = `${TODAY.slice(0, 4)}-01-01`;

export function PayrollRegisterReportScreen() {
  return <ReportScreen definition={createPayrollRegisterReport()} apiPath="/hr/payroll-register" />;
}

export function AttendanceSummaryReportScreen() {
  const definition = createAttendanceSummaryReport();
  return <ReportScreen definition={{ ...definition, defaultParams: { from: YEAR_START, to: TODAY } }} apiPath="/hr/attendance-summary" />;
}

export function LeaveLiabilityReportScreen() {
  const definition = createLeaveLiabilityReport();
  return <ReportScreen definition={{ ...definition, defaultParams: { asOfDate: TODAY } }} apiPath="/hr/leave-liability" />;
}

export function HeadcountMovementReportScreen() {
  const definition = createHeadcountMovementReport();
  return <ReportScreen definition={{ ...definition, defaultParams: { from: YEAR_START, to: TODAY } }} apiPath="/hr/headcount-movement" />;
}
