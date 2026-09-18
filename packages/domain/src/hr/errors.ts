import { getEmployeeStatusLabel, type EmployeeStatus } from "./employee.js";
import { getLeaveRequestStatusLabel, type LeaveRequestStatus } from "./leave-request.js";
import { getPayrollRunStatusLabel, type PayrollRunStatus } from "./payroll-run.js";
import { getEmployeeAdvanceStatusLabel, type EmployeeAdvanceStatus } from "./advance.js";

/** Raised when an operation references a department id/code that does not exist. */
export class DepartmentNotFoundError extends Error {
  readonly code = "DEPARTMENT_NOT_FOUND";
  constructor(readonly departmentId: string) {
    super(`Department "${departmentId}" was not found.`);
    this.name = "DepartmentNotFoundError";
  }
}

/** Raised when a department create/update command fails validation. */
export class InvalidDepartmentError extends Error {
  readonly code = "INVALID_DEPARTMENT";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidDepartmentError";
  }
}

/** Raised when an operation references a job-title id that does not exist. */
export class JobTitleNotFoundError extends Error {
  readonly code = "JOB_TITLE_NOT_FOUND";
  constructor(readonly jobTitleId: string) {
    super(`Job title "${jobTitleId}" was not found.`);
    this.name = "JobTitleNotFoundError";
  }
}

/** Raised when a job-title create/update command fails validation. */
export class InvalidJobTitleError extends Error {
  readonly code = "INVALID_JOB_TITLE";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidJobTitleError";
  }
}

/** Raised when an operation references an employee id that does not exist. */
export class EmployeeNotFoundError extends Error {
  readonly code = "EMPLOYEE_NOT_FOUND";
  constructor(readonly employeeId: string) {
    super(`Employee "${employeeId}" was not found.`);
    this.name = "EmployeeNotFoundError";
  }
}

/** Raised when a new-employee/edit command fails validation. */
export class InvalidEmployeeError extends Error {
  readonly code = "INVALID_EMPLOYEE";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidEmployeeError";
  }
}

/** Raised when an employee status transition is not allowed by the employee state machine. */
export class InvalidEmployeeTransitionError extends Error {
  readonly code = "INVALID_EMPLOYEE_TRANSITION";
  constructor(
    readonly from: EmployeeStatus,
    readonly to: EmployeeStatus,
  ) {
    super(`لا يمكن نقل الموظف من "${getEmployeeStatusLabel(from)}" إلى "${getEmployeeStatusLabel(to)}".`);
    this.name = "InvalidEmployeeTransitionError";
  }
}

/** Raised when the calling user account is not linked to an employee record (My Leave self-service gate). */
export class UserNotLinkedToEmployeeError extends Error {
  readonly code = "USER_NOT_LINKED_TO_EMPLOYEE";
  constructor(readonly userId: string) {
    super(`User "${userId}" is not linked to an employee record.`);
    this.name = "UserNotLinkedToEmployeeError";
  }
}

/** Raised when an operation references a contract id that does not exist. */
export class ContractNotFoundError extends Error {
  readonly code = "CONTRACT_NOT_FOUND";
  constructor(readonly contractId: string) {
    super(`Contract "${contractId}" was not found.`);
    this.name = "ContractNotFoundError";
  }
}

/** Raised when a new-contract command fails validation. */
export class InvalidContractError extends Error {
  readonly code = "INVALID_CONTRACT";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidContractError";
  }
}

/** Raised when terminating a contract that is already terminated. */
export class ContractNotActiveError extends Error {
  readonly code = "CONTRACT_NOT_ACTIVE";
  constructor(readonly contractId: string) {
    super(`Contract "${contractId}" is not active.`);
    this.name = "ContractNotActiveError";
  }
}

/** Raised when an operation references a holiday id that does not exist. */
export class HolidayNotFoundError extends Error {
  readonly code = "HOLIDAY_NOT_FOUND";
  constructor(readonly holidayId: string) {
    super(`Holiday "${holidayId}" was not found.`);
    this.name = "HolidayNotFoundError";
  }
}

/** Raised when a new-holiday/edit command fails validation. */
export class InvalidHolidayError extends Error {
  readonly code = "INVALID_HOLIDAY";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidHolidayError";
  }
}

/** Raised when an operation references a leave-request id that does not exist. */
export class LeaveRequestNotFoundError extends Error {
  readonly code = "LEAVE_REQUEST_NOT_FOUND";
  constructor(readonly leaveRequestId: string) {
    super(`Leave request "${leaveRequestId}" was not found.`);
    this.name = "LeaveRequestNotFoundError";
  }
}

/** Raised when a new-leave-request command fails validation (e.g. end before start). */
export class InvalidLeaveRequestError extends Error {
  readonly code = "INVALID_LEAVE_REQUEST";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidLeaveRequestError";
  }
}

/** Raised when a leave-request status transition is not allowed by its state machine. */
export class InvalidLeaveRequestTransitionError extends Error {
  readonly code = "INVALID_LEAVE_REQUEST_TRANSITION";
  constructor(
    readonly from: LeaveRequestStatus,
    readonly to: LeaveRequestStatus,
  ) {
    super(`لا يمكن نقل طلب الإجازة من "${getLeaveRequestStatusLabel(from)}" إلى "${getLeaveRequestStatusLabel(to)}".`);
    this.name = "InvalidLeaveRequestTransitionError";
  }
}

/** Raised when an attendance record/correction command fails validation. */
export class InvalidAttendanceEntryError extends Error {
  readonly code = "INVALID_ATTENDANCE_ENTRY";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidAttendanceEntryError";
  }
}

/** Raised when an operation references an attendance-entry id that does not exist. */
export class AttendanceEntryNotFoundError extends Error {
  readonly code = "ATTENDANCE_ENTRY_NOT_FOUND";
  constructor(readonly entryId: string) {
    super(`Attendance entry "${entryId}" was not found.`);
    this.name = "AttendanceEntryNotFoundError";
  }
}

/** Raised when an employee already has an attendance entry for the same day. */
export class DuplicateAttendanceEntryError extends Error {
  readonly code = "DUPLICATE_ATTENDANCE_ENTRY";
  constructor(
    readonly employeeId: string,
    readonly date: string,
  ) {
    super(`Attendance for employee "${employeeId}" on "${date}" already exists.`);
    this.name = "DuplicateAttendanceEntryError";
  }
}

/**
 * Raised when approving a leave request would take the employee's balance
 * negative. Approving used to be unconditional: the balance simply went
 * negative and nothing refused it, so an employee could be granted leave the
 * tenant had never accrued.
 */
export class LeaveBalanceExceededError extends Error {
  readonly code = "LEAVE_BALANCE_EXCEEDED";
  constructor(
    readonly requestedDays: number,
    readonly availableDays: number,
  ) {
    super(
      `الرصيد المتاح ${availableDays} يوم لا يغطي الطلب (${requestedDays} يوم). ` +
        "عدّل الطلب أو زد الرصيد قبل الاعتماد.",
    );
    this.name = "LeaveBalanceExceededError";
  }
}

/** Raised when a leave-policy create/update command fails validation. */
export class InvalidLeavePolicyError extends Error {
  readonly code = "INVALID_LEAVE_POLICY";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidLeavePolicyError";
  }
}

/** Raised when an operation references a leave-policy id that does not exist. */
export class LeavePolicyNotFoundError extends Error {
  readonly code = "LEAVE_POLICY_NOT_FOUND";
  constructor(readonly policyId: string) {
    super(`Leave policy "${policyId}" was not found.`);
    this.name = "LeavePolicyNotFoundError";
  }
}

/** Raised when a leave policy already exists for the same leave type. */
export class DuplicateLeavePolicyError extends Error {
  readonly code = "DUPLICATE_LEAVE_POLICY";
  constructor(readonly leaveType: string) {
    super(`A leave policy for "${leaveType}" already exists.`);
    this.name = "DuplicateLeavePolicyError";
  }
}

/** Raised when applying a preset code that is not one of the dated labour-law presets. */
export class UnknownLeavePolicyPresetError extends Error {
  readonly code = "UNKNOWN_LEAVE_POLICY_PRESET";
  constructor(readonly presetCode: string) {
    super(`"${presetCode}" is not a known leave-policy preset.`);
    this.name = "UnknownLeavePolicyPresetError";
  }
}

/** Raised when a leave-balance create/adjust command fails validation. */
export class InvalidLeaveBalanceError extends Error {
  readonly code = "INVALID_LEAVE_BALANCE";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidLeaveBalanceError";
  }
}

/** Raised when an operation references a leave-balance id that does not exist. */
export class LeaveBalanceNotFoundError extends Error {
  readonly code = "LEAVE_BALANCE_NOT_FOUND";
  constructor(readonly balanceId: string) {
    super(`Leave balance "${balanceId}" was not found.`);
    this.name = "LeaveBalanceNotFoundError";
  }
}

/** Raised when an accrual-run command fails validation. */
export class InvalidLeaveAccrualBatchError extends Error {
  readonly code = "INVALID_LEAVE_ACCRUAL_BATCH";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidLeaveAccrualBatchError";
  }
}

/** Raised when an operation references an employee-advance id that does not exist. */
export class EmployeeAdvanceNotFoundError extends Error {
  readonly code = "EMPLOYEE_ADVANCE_NOT_FOUND";
  constructor(readonly advanceId: string) {
    super(`Employee advance "${advanceId}" was not found.`);
    this.name = "EmployeeAdvanceNotFoundError";
  }
}

/** Raised when an advance request/recovery command fails validation. */
export class InvalidEmployeeAdvanceError extends Error {
  readonly code = "INVALID_EMPLOYEE_ADVANCE";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidEmployeeAdvanceError";
  }
}

/** Raised when an advance status transition is not allowed by its state machine. */
export class InvalidEmployeeAdvanceTransitionError extends Error {
  readonly code = "INVALID_EMPLOYEE_ADVANCE_TRANSITION";
  constructor(
    readonly from: EmployeeAdvanceStatus,
    readonly to: EmployeeAdvanceStatus,
  ) {
    super(`لا يمكن نقل السلفة من "${getEmployeeAdvanceStatusLabel(from)}" إلى "${getEmployeeAdvanceStatusLabel(to)}".`);
    this.name = "InvalidEmployeeAdvanceTransitionError";
  }
}

/** Raised when an operation references a payroll-run id that does not exist. */
export class PayrollRunNotFoundError extends Error {
  readonly code = "PAYROLL_RUN_NOT_FOUND";
  constructor(readonly runId: string) {
    super(`Payroll run "${runId}" was not found.`);
    this.name = "PayrollRunNotFoundError";
  }
}

/** Raised when a payroll-run create command fails validation. */
export class InvalidPayrollRunError extends Error {
  readonly code = "INVALID_PAYROLL_RUN";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidPayrollRunError";
  }
}

/** Raised when a payroll-run status transition is not allowed by its state machine. */
export class InvalidPayrollRunTransitionError extends Error {
  readonly code = "INVALID_PAYROLL_RUN_TRANSITION";
  constructor(
    readonly from: PayrollRunStatus,
    readonly to: PayrollRunStatus,
  ) {
    super(`لا يمكن نقل مسير الرواتب من "${getPayrollRunStatusLabel(from)}" إلى "${getPayrollRunStatusLabel(to)}".`);
    this.name = "InvalidPayrollRunTransitionError";
  }
}

/** Raised when a non-cancelled run already covers the same period + branch scope. */
export class DuplicatePayrollPeriodError extends Error {
  readonly code = "DUPLICATE_PAYROLL_PERIOD";
  constructor(
    readonly year: number,
    readonly month: number,
    readonly branchId: string | null,
  ) {
    super(`A payroll run already exists for ${year}-${String(month).padStart(2, "0")}${branchId ? ` (branch ${branchId})` : ""}.`);
    this.name = "DuplicatePayrollPeriodError";
  }
}

/** Raised when a run's calculation produced no payslip at all — there is nothing to post. */
export class NoPayableEmployeesError extends Error {
  readonly code = "NO_PAYABLE_EMPLOYEES";
  constructor(readonly runId: string) {
    super(`Payroll run "${runId}" produced no payslips.`);
    this.name = "NoPayableEmployeesError";
  }
}

/**
 * Raised when an employee's deductions exceed their earnings for the period.
 * Payroll refuses to compute a negative net rather than post a wrong one.
 */
export class NegativeNetPayError extends Error {
  readonly code = "NEGATIVE_NET_PAY";
  constructor(
    readonly employeeId: string,
    readonly gross: string,
    readonly deductions: string,
  ) {
    super(`Employee "${employeeId}" has deductions (${deductions}) exceeding earnings (${gross}) for the period.`);
    this.name = "NegativeNetPayError";
  }
}

/**
 * Raised when the disbursement's treasury voucher is held بانتظار الموافقة by a
 * configured TREASURY_VOUCHER_CONFIRM chain. The advance / payroll run must NOT
 * be marked صرف: no cash has moved and no journal entry exists yet. Approving
 * the request posts the voucher; disbursing again then completes.
 */
export class TreasuryDisbursementHeldError extends Error {
  readonly code = "TREASURY_DISBURSEMENT_HELD";
  constructor(readonly voucherId: string) {
    super("سند الصرف بانتظار الموافقة — لن يُعتبر الصرف تماً قبل اعتماده.");
    this.name = "TreasuryDisbursementHeldError";
  }
}

/** Raised when a cash disbursement is requested but no treasury voucher path is wired. */
export class TreasuryDisbursementUnavailableError extends Error {
  readonly code = "TREASURY_DISBURSEMENT_UNAVAILABLE";
  constructor() {
    super("No treasury disbursement path is configured.");
    this.name = "TreasuryDisbursementUnavailableError";
  }
}

/** Raised when a payroll component fails its own validation (code, Arabic name). */
export class InvalidPayrollComponentError extends Error {
  readonly code = "INVALID_PAYROLL_COMPONENT";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidPayrollComponentError";
  }
}

/** Raised when an operation references a payroll-component id that does not exist. */
export class PayrollComponentNotFoundError extends Error {
  readonly code = "PAYROLL_COMPONENT_NOT_FOUND";
  constructor(readonly componentId: string) {
    super(`مكوّن الرواتب غير موجود: ${componentId}`);
    this.name = "PayrollComponentNotFoundError";
  }
}

/** Raised when a payroll component reuses a code the registry already holds. */
export class DuplicatePayrollComponentError extends Error {
  readonly code = "DUPLICATE_PAYROLL_COMPONENT";
  constructor(readonly componentCode: string) {
    super(`كود مكوّن الرواتب مستخدم بالفعل: ${componentCode}`);
    this.name = "DuplicatePayrollComponentError";
  }
}

/** Raised when a garnishment command fails validation. */
export class InvalidGarnishmentError extends Error {
  readonly code = "INVALID_GARNISHMENT";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidGarnishmentError";
  }
}

/** Raised when an operation references a garnishment id that does not exist. */
export class GarnishmentNotFoundError extends Error {
  readonly code = "GARNISHMENT_NOT_FOUND";
  constructor(readonly garnishmentId: string) {
    super("سند الحجز غير موجود.");
    this.name = "GarnishmentNotFoundError";
  }
}
