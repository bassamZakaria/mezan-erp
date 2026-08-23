import { z } from "zod";

/**
 * Wire contracts for HR master data (docs/catalog/06-crm-hr.md "الموارد
 * البشرية"): departments, job titles, employees, contracts, holidays, and the
 * minimal leave-request slice backing إجازاتي (My Leave). Money crosses the
 * wire as an exact decimal string, never a float (docs/plan.md §2.3); the
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
  address: employeeAddressSchema.nullable().optional(),
  emergencyContact: emergencyContactSchema.nullable().optional(),
});

export const updateEmployeeSchema = createEmployeeSchema.omit({ id: true }).partial();

export const transitionEmployeeSchema = z.object({
  status: employeeStatusSchema,
});

// --- Contracts ---------------------------------------------------------

export const contractTypeSchema = z.enum(["indefinite", "fixed_term", "seasonal", "probationary"]);
export const payBasisSchema = z.enum(["monthly", "hourly", "daily"]);
export const payFrequencySchema = z.enum(["monthly", "biweekly", "weekly"]);
export const contractStatusSchema = z.enum(["active", "terminated"]);

export const contractLineItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  amount: z.string(),
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
  terminatedAt: z.string().nullable(),
  createdAt: z.string().min(1),
});

export const createContractLineItemSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  amount: z.string(),
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

export const leaveTypeSchema = z.enum(["annual", "sick", "personal"]);
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
  leaveType: leaveTypeSchema,
  halfDay: z.boolean().optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().nullable().optional(),
});

// --- Dashboard -------------------------------------------------------------

export const hrDashboardSummarySchema = z.object({
  activeEmployees: z.number(),
  onLeave: z.number(),
  hiresThisMonth: z.number(),
  terminationsThisMonth: z.number(),
  contractsExpiringSoon: z.number(),
  probationEndingSoon: z.number(),
  byDepartment: z.array(z.object({ departmentId: z.string(), departmentName: z.string(), count: z.number() })),
  byBranch: z.array(z.object({ branchId: z.string(), count: z.number() })),
  leaveConsumption: z.array(
    z.object({
      leaveType: leaveTypeSchema,
      entitled: z.number().nullable(),
      used: z.number(),
      pending: z.number(),
    }),
  ),
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
