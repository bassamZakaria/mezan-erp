export class DuplicateAccrualPeriodError extends Error {
  readonly code = "DUPLICATE_ACCRUAL_PERIOD";
  constructor(period: string) {
    super(`A non-cancelled leave accrual batch already exists for period "${period}"`);
    this.name = "DuplicateAccrualPeriodError";
  }
}

export class NoAccruableEmployeesError extends Error {
  readonly code = "NO_ACCRUABLE_EMPLOYEES";
  constructor(period: string) {
    super(`No employee/leave-type combination has a non-zero credit due for period "${period}"`);
    this.name = "NoAccruableEmployeesError";
  }
}

export class LeaveAccrualBatchNotFoundError extends Error {
  readonly code = "LEAVE_ACCRUAL_BATCH_NOT_FOUND";
  constructor(id: string) {
    super(`Leave accrual batch "${id}" not found`);
    this.name = "LeaveAccrualBatchNotFoundError";
  }
}

export class LeaveAccrualBatchNotDraftError extends Error {
  readonly code = "LEAVE_ACCRUAL_BATCH_NOT_DRAFT";
  constructor(id: string, status: string) {
    super(`Leave accrual batch "${id}" is ${status}, not draft`);
    this.name = "LeaveAccrualBatchNotDraftError";
  }
}
