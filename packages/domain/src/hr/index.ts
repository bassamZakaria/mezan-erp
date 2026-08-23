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
export { transitionEmployee, terminateEmployee } from "./transition-employee.js";

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
  LEAVE_REQUEST_STATUS_DEFINITIONS,
  getLeaveRequestStatusLabel,
  ALLOWED_LEAVE_REQUEST_TRANSITIONS,
  canTransitionLeaveRequest,
  createLeaveRequest,
  decideLeaveRequest,
  cancelLeaveRequest,
  type CreateLeaveRequestCommand,
} from "./leave-request.js";

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
} from "./errors.js";
