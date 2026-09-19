import { z } from "zod";
import { moneyString } from "./money-string.js";

/**
 * Wire contracts for HR master data (docs/archive/catalog/06-crm-hr.md "الموارد
 * البشرية"): departments, job titles, employees, contracts, holidays, and the
 * minimal leave-request slice backing إجازاتي (My Leave). Money crosses the
 * wire as an exact decimal string, never a float (docs/archive/plan.md §2.3); the
 * domain re-parses via `Money.fromMajor`.
 */

// --- Departments -----------------------------------------------------------

export const departmentSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  nameAr: z.string().nullable(),
  parentDepartmentId: z.string().nullable(),
  managerId: z.string().nullable(),
  overtimeEligible: z.boolean(),
  standardWorkHours: z.number().nullable(),
  active: z.boolean(),
  createdAt: z.string().min(1),
});

export const createDepartmentSchema = z.object({
  id: z.string().min(1).optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  nameAr: z.string().nullable().optional(),
  parentDepartmentId: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
  overtimeEligible: z.boolean().optional(),
  standardWorkHours: z.number().nullable().optional(),
});

export const updateDepartmentSchema = z.object({
  name: z.string().min(1).optional(),
  nameAr: z.string().nullable().optional(),
  parentDepartmentId: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
  overtimeEligible: z.boolean().optional(),
  standardWorkHours: z.number().nullable().optional(),
  active: z.boolean().optional(),
});

// --- Job Titles --------------------------------------------------------

export const jobTitleSchema = z.object({
  id: z.string().min(1),
  departmentId: z.string().min(1),
  name: z.string().min(1),
  nameAr: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string().min(1),
});

export const createJobTitleSchema = z.object({
  id: z.string().min(1).optional(),
  departmentId: z.string().min(1),
  name: z.string().min(1),
  nameAr: z.string().nullable().optional(),
});

export const updateJobTitleSchema = z.object({
  name: z.string().min(1).optional(),
  nameAr: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

// --- Employees ---------------------------------------------------------

export const employeeStatusSchema = z.enum(["active", "on_leave", "suspended", "terminated"]);
export const workerCategorySchema = z.enum(["staff", "worker"]);
export const overtimeEligibilitySchema = z.enum(["inherit_department", "eligible", "not_eligible"]);
export const genderSchema = z.enum(["male", "female"]);
export const maritalStatusSchema = z.enum(["single", "married", "divorced", "widowed"]);
export const employmentTypeSchema = z.enum(["full_time", "part_time"]);

export const employeeAddressSchema = z.object({
  street: z.string().nullable(),
  city: z.string().nullable(),
  governorate: z.string().nullable(),
  postalCode: z.string().nullable(),
});

export const emergencyContactSchema = z.object({
  name: z.string().nullable(),
  relationship: z.string().nullable(),
  phone: z.string().nullable(),
  altPhone: z.string().nullable(),
});

export const employeeSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  firstNameAr: z.string().nullable(),
  lastNameAr: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  birthDate: z.string().nullable(),
  nationalId: z.string().nullable(),
  gender: genderSchema.nullable(),
  maritalStatus: maritalStatusSchema.nullable(),
  departmentId: z.string().nullable(),
  jobTitleId: z.string().nullable(),
  managerId: z.string().nullable(),
  branchId: z.string().min(1),
  hireDate: z.string().min(1),
  workerCategory: workerCategorySchema,
  employmentType: employmentTypeSchema,
  overtimeEligibility: overtimeEligibilitySchema,
  standardWorkHours: z.number().nullable(),
  probationEndDate: z.string().nullable(),
  priorServiceYears: z.number(),
  requireSelfieAtClockIn: z.boolean(),
  requireBiometricAtClockIn: z.boolean(),
  /** Badge/employee-code on a fingerprint-device export; null until set. */
  deviceBadgeId: z.string().nullable(),
  /** Null = never answered; end-of-service gratuity is not computed until it is. */
  hasPensionEntitlement: z.boolean().nullable(),
  taxDisabilityExemption: z.boolean(),
  address: employeeAddressSchema.nullable(),
  emergencyContact: emergencyContactSchema.nullable(),
  status: employeeStatusSchema,
  terminatedAt: z.string().nullable(),
  createdAt: z.string().min(1),
});

export const createEmployeeSchema = z.object({
  id: z.string().min(1).optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  firstNameAr: z.string().nullable().optional(),
  lastNameAr: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  birthDate: z.string().nullable().optional(),
  nationalId: z.string().nullable().optional(),
  gender: genderSchema.nullable().optional(),
  maritalStatus: maritalStatusSchema.nullable().optional(),
  departmentId: z.string().nullable().optional(),
  jobTitleId: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
  branchId: z.string().min(1),
  hireDate: z.string().min(1),
  workerCategory: workerCategorySchema.optional(),
  employmentType: employmentTypeSchema.optional(),
  overtimeEligibility: overtimeEligibilitySchema.optional(),
  standardWorkHours: z.number().nullable().optional(),
  probationEndDate: z.string().nullable().optional(),
  priorServiceYears: z.number().optional(),
  requireSelfieAtClockIn: z.boolean().optional(),
  requireBiometricAtClockIn: z.boolean().optional(),
  deviceBadgeId: z.string().nullable().optional(),
  hasPensionEntitlement: z.boolean().nullable().optional(),
  taxDisabilityExemption: z.boolean().optional(),
  address: employeeAddressSchema.nullable().optional(),
  emergencyContact: emergencyContactSchema.nullable().optional(),
});

export const updateEmployeeSchema = createEmployeeSchema.omit({ id: true }).partial();

export const transitionEmployeeSchema = z.object({
  status: employeeStatusSchema,
});

export const rehireEmployeeSchema = z.object({
  /** The new spell's start date; the previous spell folds into priorServiceYears. */
  hireDate: z.string().min(1),
});

// --- Contracts ---------------------------------------------------------

export const contractTypeSchema = z.enum(["indefinite", "fixed_term", "seasonal", "probationary"]);
export const payBasisSchema = z.enum(["monthly", "hourly", "daily"]);
export const payFrequencySchema = z.enum(["monthly", "biweekly", "weekly"]);
export const contractStatusSchema = z.enum(["active", "terminated"]);

export const contractLineItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  amount: moneyString,
  /** The payroll component this line binds to; drives the GL account the line posts to (R10.7). */
  componentId: z.string().nullable(),
});

export const leaveEntitlementOverridesSchema = z.object({
  annualLeaveDays: z.number().nullable(),
  sickLeaveDays: z.number().nullable(),
  personalLeaveDays: z.number().nullable(),
});

export const contractSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  employeeId: z.string().min(1),
  type: contractTypeSchema,
  payBasis: payBasisSchema,
  payFrequency: payFrequencySchema,
  startDate: z.string().min(1),
  endDate: z.string().nullable(),
  monthlySalary: z.string(),
  currency: z.string().min(1),
  leaveEntitlement: leaveEntitlementOverridesSchema,
  allowances: z.array(contractLineItemSchema),
  deductions: z.array(contractLineItemSchema),
  status: contractStatusSchema,
  /** Active, fixed-term, and ending within the domain's expiring-soon window. */
  expiringSoon: z.boolean(),
  terminatedAt: z.string().nullable(),
  createdAt: z.string().min(1),
});

export const createContractLineItemSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  amount: moneyString,
  componentId: z.string().nullable().optional(),
});

export const createContractSchema = z.object({
  id: z.string().min(1).optional(),
  employeeId: z.string().min(1),
  type: contractTypeSchema.optional(),
  payBasis: payBasisSchema.optional(),
  payFrequency: payFrequencySchema.optional(),
  startDate: z.string().min(1),
  endDate: z.string().nullable().optional(),
  monthlySalary: z.string(),
  currency: z.string().min(1).optional(),
  leaveEntitlement: leaveEntitlementOverridesSchema.partial().optional(),
  allowances: z.array(createContractLineItemSchema).optional(),
  deductions: z.array(createContractLineItemSchema).optional(),
});

// --- Holidays ------------------------------------------------------------

export const holidaySchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().nullable(),
  recurringAnnual: z.boolean(),
  createdAt: z.string().min(1),
});

export const createHolidaySchema = z.object({
  id: z.string().min(1).optional(),
  date: z.string().min(1),
  nameEn: z.string().min(1),
  nameAr: z.string().nullable().optional(),
  recurringAnnual: z.boolean().optional(),
});

export const updateHolidaySchema = z.object({
  date: z.string().min(1).optional(),
  nameEn: z.string().min(1).optional(),
  nameAr: z.string().nullable().optional(),
  recurringAnnual: z.boolean().optional(),
});

// --- Leave Requests (My Leave self-service) -------------------------------

export const leaveTypeSchema = z.enum(["annual", "sick", "personal", "casual", "maternity", "paternity", "unpaid", "emergency"]);
export const leaveRequestStatusSchema = z.enum(["pending", "approved", "rejected", "cancelled"]);

export const leaveRequestSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  employeeId: z.string().min(1),
  leaveType: leaveTypeSchema,
  halfDay: z.boolean(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  days: z.number(),
  reason: z.string().nullable(),
  status: leaveRequestStatusSchema,
  createdAt: z.string().min(1),
  decidedAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
});

export const createLeaveRequestSchema = z.object({
  id: z.string().min(1).optional(),
  /** Filing on behalf of another employee (the admin list's create action); omitted, the request is the caller's own. */
  employeeId: z.string().min(1).optional(),
  leaveType: leaveTypeSchema,
  halfDay: z.boolean().optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().nullable().optional(),
});

export const decideLeaveRequestSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().nullable().optional(),
});

// --- Attendance ------------------------------------------------------------

export const attendanceStatusSchema = z.enum(["present", "late", "half_day", "absent", "on_leave", "holiday", "weekly_off", "compensatory_off"]);

/** How a worked public holiday is compensated: the premium, or a substitute day on the worker's written request. */
export const holidayWorkCompensationSchema = z.enum(["pay", "day_off"]);

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "HH:MM");
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const attendanceEntrySchema = z.object({
  id: z.string().min(1),
  employeeId: z.string().min(1),
  date: isoDateSchema,
  checkIn: z.string().nullable(),
  checkOut: z.string().nullable(),
  workedMinutes: z.number().int(),
  /** Null = no overtime approval recorded, which is NOT the same as an approved zero. */
  approvedOvertimeMinutes: z.number().int().nullable(),
  holidayCompensation: holidayWorkCompensationSchema,
  status: attendanceStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const recordAttendanceSchema = z.object({
  id: z.string().min(1).optional(),
  employeeId: z.string().min(1),
  date: isoDateSchema,
  checkIn: timeOfDaySchema.nullable().optional(),
  checkOut: timeOfDaySchema.nullable().optional(),
  halfDay: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  status: attendanceStatusSchema.nullable().optional(),
  expectedCheckIn: timeOfDaySchema.nullable().optional(),
  graceMinutes: z.number().int().min(0).optional(),
  /** Overtime the manager approved for this day, in whole minutes. */
  approvedOvertimeMinutes: z.number().int().min(0).nullable().optional(),
  holidayCompensation: holidayWorkCompensationSchema.optional(),
});

export const correctAttendanceSchema = recordAttendanceSchema.omit({ id: true, employeeId: true, date: true }).partial();

export const attendanceSummarySchema = z.object({
  /** Null = the whole workforce, not one employee. */
  employeeId: z.string().min(1).nullable(),
  from: z.string().min(1),
  to: z.string().min(1),
  workingDays: z.number(),
  daysPresent: z.number(),
  daysLate: z.number(),
  daysAbsent: z.number(),
  halfDays: z.number(),
  daysOnLeave: z.number(),
  holidays: z.number(),
  weeklyOffDays: z.number(),
  workedMinutes: z.number(),
  attendanceRatePercent: z.number(),
});

// --- Leave Policies --------------------------------------------------------

export const leaveAccrualFrequencySchema = z.enum(["annual", "monthly", "none"]);

/** Day counts cross the wire as exact decimal strings (`Qty`), never floats. */
const qtyDaysSchema = z.string().regex(/^-?\d+(\.\d{1,6})?$/, "exact decimal");

export const leavePolicySchema = z.object({
  id: z.string().min(1),
  leaveType: leaveTypeSchema,
  entitlementDays: qtyDaysSchema,
  accrualFrequency: leaveAccrualFrequencySchema,
  carryOver: z.boolean(),
  maxCarryOverDays: qtyDaysSchema.nullable(),
  payoutOnTermination: z.boolean(),
  legallyMandated: z.boolean(),
  presetCode: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const createLeavePolicySchema = z.object({
  id: z.string().min(1).optional(),
  leaveType: leaveTypeSchema,
  entitlementDays: qtyDaysSchema,
  accrualFrequency: leaveAccrualFrequencySchema,
  carryOver: z.boolean().optional(),
  maxCarryOverDays: qtyDaysSchema.nullable().optional(),
  payoutOnTermination: z.boolean().optional(),
  legallyMandated: z.boolean().optional(),
});

export const updateLeavePolicySchema = z.object({
  entitlementDays: qtyDaysSchema.optional(),
  accrualFrequency: leaveAccrualFrequencySchema.optional(),
  carryOver: z.boolean().optional(),
  maxCarryOverDays: qtyDaysSchema.nullable().optional(),
  payoutOnTermination: z.boolean().optional(),
  legallyMandated: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const leavePolicyPresetSchema = z.object({
  code: z.string().min(1),
  labelAr: z.string().min(1),
  effectiveFrom: z.string().min(1),
  lines: z.array(
    z.object({
      leaveType: leaveTypeSchema,
      entitlementDays: qtyDaysSchema,
      accrualFrequency: leaveAccrualFrequencySchema,
      carryOver: z.boolean(),
      maxCarryOverDays: qtyDaysSchema.nullable(),
      payoutOnTermination: z.boolean(),
      legallyMandated: z.boolean(),
      noteAr: z.string(),
    }),
  ),
});

export const applyLeavePolicyPresetSchema = z.object({
  presetCode: z.string().min(1),
});

// --- Leave Balances & Accrual Batches --------------------------------------

export const leaveBalanceSchema = z.object({
  id: z.string().min(1),
  employeeId: z.string().min(1),
  leaveType: leaveTypeSchema,
  year: z.number().int(),
  entitled: qtyDaysSchema,
  carriedOver: qtyDaysSchema,
  used: qtyDaysSchema,
  available: qtyDaysSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const upsertLeaveBalanceSchema = z.object({
  employeeId: z.string().min(1),
  leaveType: leaveTypeSchema,
  year: z.number().int(),
  entitled: qtyDaysSchema.optional(),
  carriedOver: qtyDaysSchema.optional(),
  used: qtyDaysSchema.optional(),
});

export const leaveAccrualBatchSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  periodKey: z.string().min(1),
  frequency: leaveAccrualFrequencySchema,
  runType: z.enum(["manual", "scheduled"]),
  runDate: z.string().min(1),
  notes: z.string().nullable(),
  employeeCount: z.number().int(),
  totalDays: qtyDaysSchema,
  lines: z.array(z.object({ employeeId: z.string().min(1), leaveType: leaveTypeSchema, days: qtyDaysSchema })),
  runBy: z.string().nullable(),
  createdAt: z.string().min(1),
});

export const runLeaveAccrualSchema = z.object({
  runDate: isoDateSchema,
  frequency: z.enum(["monthly", "annual"]).optional(),
  runType: z.enum(["manual", "scheduled"]).optional(),
  notes: z.string().nullable().optional(),
});

// --- Dashboard -------------------------------------------------------------

export const hrDashboardSummarySchema = z.object({
  activeEmployees: z.number(),
  onLeave: z.number(),
  hiresThisMonth: z.number(),
  terminationsThisMonth: z.number(),
  contractsExpiringSoon: z.number(),
  probationEndingSoon: z.number(),
  byDepartment: z.array(z.object({ departmentId: z.string(), departmentName: z.string(), departmentNameAr: z.string().nullable(), count: z.number() })),
  byBranch: z.array(z.object({ branchId: z.string(), count: z.number() })),
  leaveConsumption: z.array(
    z.object({
      leaveType: leaveTypeSchema,
      /** Accrued + carried over for the current year, or null when nothing has been accrued. */
      entitled: z.number().nullable(),
      used: z.number(),
      pending: z.number(),
      usedPercent: z.number().nullable(),
    }),
  ),
  /** Hires and leavers per month over the trailing 12 months, oldest first. */
  headcountTrend: z.array(z.object({ month: z.string(), hires: z.number(), leavers: z.number() })),
  attendance: z.object({
    from: z.string(),
    to: z.string(),
    workingDays: z.number(),
    daysPresent: z.number(),
    daysLate: z.number(),
    halfDays: z.number(),
    daysAbsent: z.number(),
    daysOnLeave: z.number(),
    absenceRatePercent: z.number(),
    lateArrivalRatePercent: z.number(),
  }),
});

export type DepartmentDTO = z.infer<typeof departmentSchema>;
export type CreateDepartmentDTO = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentDTO = z.infer<typeof updateDepartmentSchema>;
export type JobTitleDTO = z.infer<typeof jobTitleSchema>;
export type CreateJobTitleDTO = z.infer<typeof createJobTitleSchema>;
export type UpdateJobTitleDTO = z.infer<typeof updateJobTitleSchema>;
export type EmployeeStatusDTO = z.infer<typeof employeeStatusSchema>;
export type WorkerCategoryDTO = z.infer<typeof workerCategorySchema>;
export type OvertimeEligibilityDTO = z.infer<typeof overtimeEligibilitySchema>;
export type GenderDTO = z.infer<typeof genderSchema>;
export type MaritalStatusDTO = z.infer<typeof maritalStatusSchema>;
export type EmploymentTypeDTO = z.infer<typeof employmentTypeSchema>;
export type EmployeeAddressDTO = z.infer<typeof employeeAddressSchema>;
export type EmergencyContactDTO = z.infer<typeof emergencyContactSchema>;
export type EmployeeDTO = z.infer<typeof employeeSchema>;
export type CreateEmployeeDTO = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeDTO = z.infer<typeof updateEmployeeSchema>;
export type RehireEmployeeDTO = z.infer<typeof rehireEmployeeSchema>;
export type TransitionEmployeeDTO = z.infer<typeof transitionEmployeeSchema>;
export type ContractTypeDTO = z.infer<typeof contractTypeSchema>;
export type PayBasisDTO = z.infer<typeof payBasisSchema>;
export type PayFrequencyDTO = z.infer<typeof payFrequencySchema>;
export type ContractStatusDTO = z.infer<typeof contractStatusSchema>;
export type ContractLineItemDTO = z.infer<typeof contractLineItemSchema>;
export type LeaveEntitlementOverridesDTO = z.infer<typeof leaveEntitlementOverridesSchema>;
export type ContractDTO = z.infer<typeof contractSchema>;
export type CreateContractDTO = z.infer<typeof createContractSchema>;
export type HolidayDTO = z.infer<typeof holidaySchema>;
export type CreateHolidayDTO = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayDTO = z.infer<typeof updateHolidaySchema>;
export type LeaveTypeDTO = z.infer<typeof leaveTypeSchema>;
export type LeaveRequestStatusDTO = z.infer<typeof leaveRequestStatusSchema>;
export type LeaveRequestDTO = z.infer<typeof leaveRequestSchema>;
export type CreateLeaveRequestDTO = z.infer<typeof createLeaveRequestSchema>;
export type HrDashboardSummaryDTO = z.infer<typeof hrDashboardSummarySchema>;
export type DecideLeaveRequestDTO = z.infer<typeof decideLeaveRequestSchema>;
export type AttendanceStatusDTO = z.infer<typeof attendanceStatusSchema>;
export type HolidayWorkCompensationDTO = z.infer<typeof holidayWorkCompensationSchema>;
export type AttendanceEntryDTO = z.infer<typeof attendanceEntrySchema>;
export type RecordAttendanceDTO = z.infer<typeof recordAttendanceSchema>;
export type CorrectAttendanceDTO = z.infer<typeof correctAttendanceSchema>;
export type AttendanceSummaryDTO = z.infer<typeof attendanceSummarySchema>;
export type LeaveAccrualFrequencyDTO = z.infer<typeof leaveAccrualFrequencySchema>;
export type LeavePolicyDTO = z.infer<typeof leavePolicySchema>;
export type CreateLeavePolicyDTO = z.infer<typeof createLeavePolicySchema>;
export type UpdateLeavePolicyDTO = z.infer<typeof updateLeavePolicySchema>;
export type LeavePolicyPresetDTO = z.infer<typeof leavePolicyPresetSchema>;
export type ApplyLeavePolicyPresetDTO = z.infer<typeof applyLeavePolicyPresetSchema>;
export type LeaveBalanceDTO = z.infer<typeof leaveBalanceSchema>;
export type UpsertLeaveBalanceDTO = z.infer<typeof upsertLeaveBalanceSchema>;
export type LeaveAccrualBatchDTO = z.infer<typeof leaveAccrualBatchSchema>;
export type RunLeaveAccrualDTO = z.infer<typeof runLeaveAccrualSchema>;
