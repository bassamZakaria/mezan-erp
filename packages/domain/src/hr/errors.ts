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
    readonly from: string,
    readonly to: string,
  ) {
    super(`Cannot transition employee from "${from}" to "${to}".`);
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
    readonly from: string,
    readonly to: string,
  ) {
    super(`Cannot transition leave request from "${from}" to "${to}".`);
    this.name = "InvalidLeaveRequestTransitionError";
  }
}
