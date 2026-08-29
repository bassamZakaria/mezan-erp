export type { Department, DepartmentRepository } from "./department.js";
export { createDepartment, updateDepartment, type CreateDepartmentCommand } from "./create-department.js";

export type { JobTitle, JobTitleRepository } from "./job-title.js";
export { createJobTitle, updateJobTitle, type CreateJobTitleCommand } from "./create-job-title.js";

export type {
  Employee,
  EmployeeRepository,
  EmployeeStatus,
  WorkerCategory,
  OvertimeEligibility,
  Gender,
  MaritalStatus,
  EmployeeAddress,
  EmergencyContact,
  EmployeeStatusDefinition,
} from "./employee.js";
export {
  EMPLOYEE_STATUS_DEFINITIONS,
  getEmployeeStatusLabel,
  fullNameAr,
  fullNameEn,
  toEmployeeRef,
  createEmployeeDirectory,
  ALLOWED_EMPLOYEE_TRANSITIONS,
  canTransitionEmployee,
} from "./employee.js";
export { createEmployee, updateEmployee, type CreateEmployeeCommand, type EmployeeEditableFields } from "./create-employee.js";
export { transitionEmployee, terminateEmployee, rehireEmployee } from "./transition-employee.js";

export type {
  Contract,
  ContractRepository,
  ContractType,
  PayBasis,
  PayFrequency,
  ContractStatus,
  ContractLineItem,
  LeaveEntitlementOverrides,
  ContractTypeDefinition,
} from "./contract.js";
export {
  CONTRACT_TYPE_DEFINITIONS,
  getContractTypeLabel,
  getPayBasisLabel,
  getPayFrequencyLabel,
  CONTRACT_EXPIRING_SOON_WINDOW_DAYS,
  isContractExpiringSoon,
} from "./contract.js";
export { createContract, terminateContract, type CreateContractCommand } from "./create-contract.js";

export type { Holiday, HolidayRepository } from "./holiday.js";
export { createHoliday, updateHoliday, listHolidaysForYear, type CreateHolidayCommand } from "./holiday.js";

export type {
  LeaveRequest,
  LeaveRequestRepository,
  LeaveType,
  LeaveRequestStatus,
  LeaveTypeDefinition,
  LeaveRequestStatusDefinition,
} from "./leave-request.js";
export {
  LEAVE_TYPE_DEFINITIONS,
  getLeaveTypeLabel,
  leaveApprovalActionType,
  isUnpaidLeaveType,
  LEAVE_REQUEST_STATUS_DEFINITIONS,
  getLeaveRequestStatusLabel,
  ALLOWED_LEAVE_REQUEST_TRANSITIONS,
  canTransitionLeaveRequest,
  createLeaveRequest,
  decideLeaveRequest,
  cancelLeaveRequest,
  filterLeaveRequests,
  isOnApprovedLeave,
  type CreateLeaveRequestCommand,
  type LeaveRequestFilter,
} from "./leave-request.js";

export type {
  AttendanceEntry,
  AttendanceRepository,
  AttendanceStatus,
  AttendanceStatusDefinition,
  AttendanceFilter,
  AttendanceSummary,
  WorkforceAttendanceSummary,
  RecordAttendanceCommand,
  CorrectAttendanceCommand,
  ResolveAttendanceStatusInput,
} from "./attendance.js";
export {
  ATTENDANCE_STATUS_DEFINITIONS,
  NON_WORKING_ATTENDANCE_STATUSES,
  DEFAULT_WEEKLY_OFF_DAYS,
  getAttendanceStatusLabel,
  workedMinutesBetween,
  isWeeklyOffDay,
  isHolidayDate,
  resolveAttendanceStatus,
  recordAttendance,
  correctAttendance,
  summarizeAttendance,
  summarizeWorkforceAttendance,
} from "./attendance.js";

export type {
  LeavePolicy,
  LeavePolicyRepository,
  LeavePolicyPatch,
  LeaveAccrualFrequency,
  LeaveAccrualFrequencyDefinition,
  LeavePolicyPreset,
  LeavePolicyPresetLine,
  CreateLeavePolicyCommand,
  ApplyLeavePolicyPresetResult,
} from "./leave-policy.js";
export {
  LEAVE_ACCRUAL_FREQUENCY_DEFINITIONS,
  LEAVE_POLICY_PRESETS,
  getLeaveAccrualFrequencyLabel,
  createLeavePolicy,
  updateLeavePolicy,
  accrualDaysPerPeriod,
  findLeavePolicyPreset,
  applyLeavePolicyPreset,
} from "./leave-policy.js";

export type {
  LeaveBalance,
  LeaveBalanceRepository,
  LeaveBalanceFilter,
  LeaveBalancePatch,
  CreateLeaveBalanceCommand,
  LeaveAccrualBatch,
  LeaveAccrualBatchRepository,
  LeaveAccrualBatchFilter,
  LeaveAccrualLine,
  LeaveAccrualRunType,
  RunLeaveAccrualCommand,
  RunLeaveAccrualDeps,
  RunLeaveAccrualResult,
} from "./leave-balance.js";
export {
  availableLeaveDays,
  createLeaveBalance,
  adjustLeaveBalance,
  accrualPeriodKey,
  runLeaveAccrual,
  consumeLeaveBalance,
  releaseLeaveBalance,
  assertLeaveBalanceCovers,
  createUnpaidLeaveDaysProvider,
} from "./leave-balance.js";

export type {
  EmployeeAdvance,
  EmployeeAdvanceRepository,
  EmployeeAdvanceStatus,
  EmployeeAdvanceStatusDefinition,
  AdvanceInstallment,
  CreateEmployeeAdvanceCommand,
} from "./advance.js";
export {
  EMPLOYEE_ADVANCE_STATUS_DEFINITIONS,
  getEmployeeAdvanceStatusLabel,
  ALLOWED_ADVANCE_TRANSITIONS,
  canTransitionAdvance,
  advanceRecovered,
  advanceOutstanding,
  employeeOutstandingBalance,
  buildInstallmentSchedule,
  addMonths,
  requestEmployeeAdvance,
  approveEmployeeAdvance,
  rejectEmployeeAdvance,
  markEmployeeAdvanceDisbursed,
  installmentsDue,
  amountDueBy,
  applyAdvanceRecovery,
} from "./advance.js";

export type {
  PayrollRun,
  PayrollRunRepository,
  PayrollRunStatus,
  PayrollRunStatusDefinition,
  Payslip,
  PayslipRepository,
  PayslipLine,
  PayslipLineKind,
  PayslipLineSource,
  PayrollGlAccounts,
  PayrollPeriodBounds,
  PayrollUnimplementedRule,
  PayslipLineSourceDefinition,
  UnpaidLeaveDaysProvider,
  OvertimeHoursProvider,
  PeriodOvertimeHours,
  WorkedTimeProvider,
  Garnishment,
  GarnishmentProvider,
  PayrollDayDivisorBasis,
  PayrollDayDivisorBasisDefinition,
} from "./payroll-run.js";
export {
  PAYROLL_RUN_STATUS_DEFINITIONS,
  getPayrollRunStatusLabel,
  ALLOWED_PAYROLL_RUN_TRANSITIONS,
  canTransitionPayrollRun,
  PAYROLL_GL_ACCOUNTS,
  PAYROLL_UNIMPLEMENTED_RULES,
  PAYSLIP_LINE_SOURCE_DEFINITIONS,
  getPayslipLineSourceLabel,
  PAYROLL_DAY_DIVISOR_BASIS_DEFINITIONS,
  getPayrollDayDivisorBasisLabel,
  payrollDayDivisor,
  daysInPayrollMonth,
  payrollPeriodBounds,
  inclusiveDays,
} from "./payroll-run.js";
export type {
  CreatePayrollRunCommand,
  PayrollCalculationDeps,
  PayrollNumbering,
} from "./calculate-payroll-run.js";
export { createPayrollRun, calculatePayrollRun, cancelPayrollRun } from "./calculate-payroll-run.js";
export type {
  PayrollComponent,
  PayrollComponentKind,
  PayrollComponentRepository,
  PayrollComponentFilter,
  PayrollComponentPatch,
  CreatePayrollComponentCommand,
} from "./payroll-component.js";
export { createPayrollComponent, updatePayrollComponent, componentAccountId } from "./payroll-component.js";
export type { PostPayrollRunDeps } from "./post-payroll-run.js";
export { approvePayrollRun } from "./post-payroll-run.js";
export type {
  TreasuryDisbursementPort,
  TreasuryDisbursementRequest,
  TreasuryDisbursementResult,
  DisbursementInput,
  DisburseAdvanceDeps,
  DisbursePayrollRunDeps,
} from "./hr-disbursement.js";
export { disburseEmployeeAdvance, disbursePayrollRun } from "./hr-disbursement.js";

export {
  DepartmentNotFoundError,
  InvalidDepartmentError,
  JobTitleNotFoundError,
  InvalidJobTitleError,
  EmployeeNotFoundError,
  InvalidEmployeeError,
  InvalidEmployeeTransitionError,
  UserNotLinkedToEmployeeError,
  ContractNotFoundError,
  InvalidContractError,
  ContractNotActiveError,
  HolidayNotFoundError,
  InvalidHolidayError,
  LeaveRequestNotFoundError,
  InvalidLeaveRequestError,
  InvalidLeaveRequestTransitionError,
  InvalidAttendanceEntryError,
  AttendanceEntryNotFoundError,
  DuplicateAttendanceEntryError,
  InvalidLeavePolicyError,
  LeavePolicyNotFoundError,
  DuplicateLeavePolicyError,
  UnknownLeavePolicyPresetError,
  InvalidLeaveBalanceError,
  LeaveBalanceNotFoundError,
  InvalidLeaveAccrualBatchError,
  EmployeeAdvanceNotFoundError,
  InvalidEmployeeAdvanceError,
  InvalidEmployeeAdvanceTransitionError,
  PayrollRunNotFoundError,
  InvalidPayrollRunError,
  InvalidPayrollRunTransitionError,
  DuplicatePayrollPeriodError,
  NoPayableEmployeesError,
  NegativeNetPayError,
  StatutoryRulesUnavailableError,
  EmployeeStillEmployedError,
  InvalidGarnishmentError,
  GarnishmentNotFoundError,
  LeaveBalanceExceededError,
  TreasuryDisbursementHeldError,
  TreasuryDisbursementUnavailableError,
  InvalidPayrollComponentError,
  PayrollComponentNotFoundError,
  DuplicatePayrollComponentError,
} from "./errors.js";

// --- Egyptian statutory payroll --------------------------------------------

export type {
  BasisPoints,
  IncomeTaxBracket,
  BracketEliminationTier,
  IncomeTaxTable,
  ContributionShare,
  SocialInsuranceTable,
  LevyBase,
  LevySide,
  PayrollLevy,
  PayrollLevyTable,
  OvertimeTable,
  EndOfServiceTier,
  EndOfServiceTable,
  EgyptStatutoryRules,
  SocialInsuranceYearOverride,
  StatutoryOverrideRepository,
} from "./egypt-statutory.js";
export {
  BASIS_POINTS_PER_UNIT,
  EGYPT_INCOME_TAX_TABLES,
  EGYPT_SOCIAL_INSURANCE_TABLES,
  EGYPT_PAYROLL_LEVY_TABLES,
  EGYPT_OVERTIME_TABLES,
  EGYPT_END_OF_SERVICE_TABLES,
  resolveEgyptStatutoryRules,
  listEgyptStatutoryTables,
  totalShareBp,
  formatRateBp,
  overrideToSocialInsuranceTable,
} from "./egypt-statutory.js";

export type {
  ContributionLine,
  SocialInsuranceResult,
  IncomeTaxResult,
  MonthlyIncomeTaxInput,
  LevyLine,
  OvertimeKind,
  OvertimeHours,
  OvertimeLine,
  EndOfServiceResult,
} from "./statutory-payroll.js";
export {
  applyRateBp,
  insurableWage,
  socialInsuranceFor,
  annualIncomeTax,
  monthlyIncomeTax,
  payrollLevies,
  hourlyRate,
  overtimePay,
  overtimeKindForHour,
  endOfServiceGratuity,
  serviceYearsBetween,
  NO_OVERTIME_HOURS,
} from "./statutory-payroll.js";

export type { OvertimeDerivationOptions } from "./attendance-overtime.js";
export {
  overtimeMinutesForEntry,
  summarizeOvertime,
  createOvertimeHoursProvider,
  createWorkedTimeProvider,
} from "./attendance-overtime.js";

export type { EndOfServiceSettlement, EndOfServiceSettlementInput } from "./end-of-service.js";
export { calculateEndOfServiceSettlement } from "./end-of-service.js";

export type {
  GarnishmentKind,
  GarnishmentKindDefinition,
  GarnishmentRecord,
  GarnishmentFilter,
  GarnishmentRepository,
  CreateGarnishmentCommand,
} from "./garnishment.js";
export {
  GARNISHMENT_KIND_DEFINITIONS,
  getGarnishmentKindLabel,
  createGarnishment,
  applyGarnishmentRecovery,
  releaseGarnishment,
  createGarnishmentProvider,
} from "./garnishment.js";

export type {
  HrProvisionKind,
  HrProvisionDefinition,
  PostHrProvisionCommand,
  PostHrProvisionDeps,
  HrProvisionResult,
} from "./post-hr-provision.js";
export {
  HR_PROVISION_DEFINITIONS,
  getHrProvisionDefinition,
  hrProvisionMovement,
  postHrProvision,
} from "./post-hr-provision.js";
