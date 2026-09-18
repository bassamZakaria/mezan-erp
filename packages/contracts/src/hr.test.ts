import { describe, it, expect } from "vitest";
import {
  departmentSchema,
  createDepartmentSchema,
  updateDepartmentSchema,
  jobTitleSchema,
  createJobTitleSchema,
  updateJobTitleSchema,
  employeeStatusSchema,
  workerCategorySchema,
  overtimeEligibilitySchema,
  genderSchema,
  maritalStatusSchema,
  employmentTypeSchema,
  employeeAddressSchema,
  emergencyContactSchema,
  employeeSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
  transitionEmployeeSchema,
  rehireEmployeeSchema,
  contractTypeSchema,
  payBasisSchema,
  payFrequencySchema,
  contractStatusSchema,
  contractLineItemSchema,
  leaveEntitlementOverridesSchema,
  contractSchema,
  createContractLineItemSchema,
  createContractSchema,
  holidaySchema,
  createHolidaySchema,
  updateHolidaySchema,
  leaveTypeSchema,
  leaveRequestStatusSchema,
  leaveRequestSchema,
  createLeaveRequestSchema,
  decideLeaveRequestSchema,
  attendanceStatusSchema,
  attendanceEntrySchema,
  recordAttendanceSchema,
  correctAttendanceSchema,
  attendanceSummarySchema,
  leaveAccrualFrequencySchema,
  leavePolicySchema,
  createLeavePolicySchema,
  updateLeavePolicySchema,
  leavePolicyPresetSchema,
  applyLeavePolicyPresetSchema,
  leaveBalanceSchema,
  upsertLeaveBalanceSchema,
  leaveAccrualBatchSchema,
  runLeaveAccrualSchema,
  hrDashboardSummarySchema,
} from "./hr.js";

describe("departmentSchema", () => {
  const department = {
    id: "dept-1",
    code: "SALES",
    name: "Sales",
    nameAr: "المبيعات",
    parentDepartmentId: null,
    managerId: null,
    overtimeEligible: true,
    standardWorkHours: 8,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a minimal valid department and preserves every field verbatim", () => {
    const result = departmentSchema.safeParse(department);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(department);
  });

  it("rejects a department missing overtimeEligible", () => {
    const { overtimeEligible, ...rest } = department;
    const result = departmentSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("overtimeEligible");
  });
});

describe("createDepartmentSchema", () => {
  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createDepartmentSchema.safeParse({ code: "SALES", name: "Sales" });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing name", () => {
    const result = createDepartmentSchema.safeParse({ code: "SALES" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("name");
  });
});

describe("updateDepartmentSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updateDepartmentSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload with a single field", () => {
    const result = updateDepartmentSchema.safeParse({ active: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ active: false });
  });
});

describe("jobTitleSchema / createJobTitleSchema / updateJobTitleSchema", () => {
  const title = { id: "jt-1", departmentId: "dept-1", name: "Sales Rep", nameAr: "مندوب مبيعات", active: true, createdAt: "2026-01-01T00:00:00.000Z" };

  it("jobTitleSchema accepts a minimal valid title and preserves every field verbatim", () => {
    const result = jobTitleSchema.safeParse(title);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(title);
  });

  it("createJobTitleSchema rejects a payload missing departmentId", () => {
    const result = createJobTitleSchema.safeParse({ name: "Sales Rep" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("departmentId");
  });

  it("updateJobTitleSchema accepts an empty payload", () => {
    const result = updateJobTitleSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("employee enum schemas", () => {
  it("employeeStatusSchema accepts each of the four known statuses", () => {
    for (const s of ["active", "on_leave", "suspended", "terminated"]) {
      expect(employeeStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("employeeStatusSchema rejects a status outside the enum", () => {
    expect(employeeStatusSchema.safeParse("retired").success).toBe(false);
  });

  it("workerCategorySchema accepts staff and worker only", () => {
    expect(workerCategorySchema.safeParse("staff").success).toBe(true);
    expect(workerCategorySchema.safeParse("manager").success).toBe(false);
  });

  it("overtimeEligibilitySchema accepts each of the three known values", () => {
    for (const v of ["inherit_department", "eligible", "not_eligible"]) {
      expect(overtimeEligibilitySchema.safeParse(v).success).toBe(true);
    }
  });

  it("genderSchema accepts male and female only", () => {
    expect(genderSchema.safeParse("male").success).toBe(true);
    expect(genderSchema.safeParse("other").success).toBe(false);
  });

  it("maritalStatusSchema accepts each of the four known values", () => {
    for (const v of ["single", "married", "divorced", "widowed"]) {
      expect(maritalStatusSchema.safeParse(v).success).toBe(true);
    }
  });

  it("employmentTypeSchema accepts full_time and part_time only", () => {
    expect(employmentTypeSchema.safeParse("full_time").success).toBe(true);
    expect(employmentTypeSchema.safeParse("contractor").success).toBe(false);
  });
});

describe("employeeAddressSchema / emergencyContactSchema", () => {
  it("employeeAddressSchema accepts a fully-null address", () => {
    const result = employeeAddressSchema.safeParse({ street: null, city: null, governorate: null, postalCode: null });
    expect(result.success).toBe(true);
  });

  it("emergencyContactSchema accepts a fully-null contact", () => {
    const result = emergencyContactSchema.safeParse({ name: null, relationship: null, phone: null, altPhone: null });
    expect(result.success).toBe(true);
  });

  it("emergencyContactSchema rejects a payload missing altPhone entirely", () => {
    const result = emergencyContactSchema.safeParse({ name: null, relationship: null, phone: null });
    expect(result.success).toBe(false);
  });
});

describe("employeeSchema", () => {
  const employee = {
    id: "emp-1",
    code: "EMP-001",
    firstName: "Mohamed",
    lastName: "Al Shehabi",
    firstNameAr: "محمد",
    lastNameAr: "الشهابي",
    email: null,
    phone: null,
    birthDate: null,
    nationalId: null,
    gender: "male" as const,
    maritalStatus: null,
    departmentId: "dept-1",
    jobTitleId: "jt-1",
    managerId: null,
    branchId: "branch-1",
    hireDate: "2026-01-01",
    workerCategory: "staff" as const,
    employmentType: "full_time" as const,
    overtimeEligibility: "inherit_department" as const,
    standardWorkHours: null,
    probationEndDate: null,
    priorServiceYears: 0,
    requireSelfieAtClockIn: false,
    requireBiometricAtClockIn: false, hasPensionEntitlement: null, taxDisabilityExemption: false,
    address: null,
    emergencyContact: null,
    status: "active" as const,
    terminatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a minimal valid employee and preserves every field verbatim", () => {
    const result = employeeSchema.safeParse(employee);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(employee);
  });

  it("rejects an employee missing branchId", () => {
    const { branchId, ...rest } = employee;
    const result = employeeSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("branchId");
  });

  it("rejects an out-of-enum status", () => {
    const result = employeeSchema.safeParse({ ...employee, status: "retired" });
    expect(result.success).toBe(false);
  });
});

describe("createEmployeeSchema", () => {
  const create = { firstName: "Mohamed", lastName: "Al Shehabi", branchId: "branch-1", hireDate: "2026-01-01" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createEmployeeSchema.safeParse(create);
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing hireDate", () => {
    const { hireDate, ...rest } = create;
    const result = createEmployeeSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("hireDate");
  });

  it("silently strips status — a new employee always starts active, not caller-chosen", () => {
    const result = createEmployeeSchema.safeParse({ ...create, status: "terminated" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("status");
  });
});

describe("updateEmployeeSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updateEmployeeSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("strips id — id is omitted before the partial() is applied", () => {
    const result = updateEmployeeSchema.safeParse({ id: "emp-2", firstName: "Ahmed" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("id");
  });
});

describe("transitionEmployeeSchema / rehireEmployeeSchema", () => {
  it("transitionEmployeeSchema accepts a minimal valid payload", () => {
    const result = transitionEmployeeSchema.safeParse({ status: "suspended" });
    expect(result.success).toBe(true);
  });

  it("transitionEmployeeSchema rejects an out-of-enum status", () => {
    const result = transitionEmployeeSchema.safeParse({ status: "retired" });
    expect(result.success).toBe(false);
  });

  it("rehireEmployeeSchema accepts a minimal valid payload", () => {
    const result = rehireEmployeeSchema.safeParse({ hireDate: "2027-01-01" });
    expect(result.success).toBe(true);
  });

  it("rehireEmployeeSchema rejects a payload missing hireDate", () => {
    const result = rehireEmployeeSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("contract enum schemas", () => {
  it("contractTypeSchema accepts each of the four known types", () => {
    for (const t of ["indefinite", "fixed_term", "seasonal", "probationary"]) {
      expect(contractTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("payBasisSchema accepts monthly, hourly and daily", () => {
    for (const b of ["monthly", "hourly", "daily"]) {
      expect(payBasisSchema.safeParse(b).success).toBe(true);
    }
  });

  it("payFrequencySchema accepts monthly, biweekly and weekly", () => {
    for (const f of ["monthly", "biweekly", "weekly"]) {
      expect(payFrequencySchema.safeParse(f).success).toBe(true);
    }
  });

  it("contractStatusSchema accepts active and terminated only", () => {
    expect(contractStatusSchema.safeParse("active").success).toBe(true);
    expect(contractStatusSchema.safeParse("terminated").success).toBe(true);
    expect(contractStatusSchema.safeParse("draft").success).toBe(false);
  });
});

describe("contractLineItemSchema", () => {
  const line = { id: "cli-1", name: "Housing allowance", amount: "1000.123456", componentId: "comp-housing" };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = contractLineItemSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("never coerces amount to a float — high-precision decimal string survives verbatim", () => {
    const result = contractLineItemSchema.safeParse({ ...line, amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = contractLineItemSchema.safeParse({ ...line, amount: 1000.12 });
    expect(result.success).toBe(false);
  });
});

describe("contractSchema", () => {
  const contract = {
    id: "contract-1",
    number: "CT-2026-001",
    employeeId: "emp-1",
    type: "indefinite" as const,
    payBasis: "monthly" as const,
    payFrequency: "monthly" as const,
    startDate: "2026-01-01",
    endDate: null,
    monthlySalary: "15000.000000",
    currency: "EGP",
    leaveEntitlement: { annualLeaveDays: 21, sickLeaveDays: 14, personalLeaveDays: 3 },
    allowances: [],
    deductions: [],
    status: "active" as const,
    expiringSoon: false,
    terminatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a minimal valid contract and preserves every field verbatim", () => {
    const result = contractSchema.safeParse(contract);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(contract);
  });

  it("never coerces monthlySalary to a float — high-precision decimal string survives verbatim", () => {
    const result = contractSchema.safeParse({ ...contract, monthlySalary: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.monthlySalary).toBe("0.100001");
  });

  it("rejects monthlySalary sent as a JS number instead of a string", () => {
    const result = contractSchema.safeParse({ ...contract, monthlySalary: 15000.12 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum contract type", () => {
    const result = contractSchema.safeParse({ ...contract, type: "casual" });
    expect(result.success).toBe(false);
  });
});

describe("createContractSchema", () => {
  const create = { employeeId: "emp-1", startDate: "2026-01-01", monthlySalary: "15000.000000" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createContractSchema.safeParse(create);
    expect(result.success).toBe(true);
  });

  it("never coerces monthlySalary to a float when supplied", () => {
    const result = createContractSchema.safeParse({ ...create, monthlySalary: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.monthlySalary).toBe("0.100001");
  });

  it("rejects monthlySalary sent as a JS number instead of a string", () => {
    const result = createContractSchema.safeParse({ ...create, monthlySalary: 15000 });
    expect(result.success).toBe(false);
  });

  it("accepts a partial leaveEntitlement override with only one field set", () => {
    const result = createContractSchema.safeParse({ ...create, leaveEntitlement: { annualLeaveDays: 25 } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.leaveEntitlement).toEqual({ annualLeaveDays: 25 });
  });

  it("silently strips status and expiringSoon — both are server-derived, never caller-supplied", () => {
    const result = createContractSchema.safeParse({ ...create, status: "terminated", expiringSoon: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("status");
      expect(result.data).not.toHaveProperty("expiringSoon");
    }
  });
});

describe("createContractLineItemSchema", () => {
  it("accepts a minimal valid line with optionals omitted", () => {
    const result = createContractLineItemSchema.safeParse({ name: "Housing allowance", amount: "1000.000000" });
    expect(result.success).toBe(true);
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = createContractLineItemSchema.safeParse({ name: "Housing allowance", amount: 1000 });
    expect(result.success).toBe(false);
  });
});

describe("holidaySchema / createHolidaySchema / updateHolidaySchema", () => {
  const holiday = { id: "hol-1", date: "2027-01-25", nameEn: "Revolution Day", nameAr: "عيد الثورة", recurringAnnual: true, createdAt: "2026-01-01T00:00:00.000Z" };

  it("holidaySchema accepts a minimal valid holiday and preserves every field verbatim", () => {
    const result = holidaySchema.safeParse(holiday);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(holiday);
  });

  it("createHolidaySchema rejects a payload missing nameEn", () => {
    const result = createHolidaySchema.safeParse({ date: "2027-01-25" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("nameEn");
  });

  it("updateHolidaySchema accepts an empty payload", () => {
    const result = updateHolidaySchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("leaveTypeSchema / leaveRequestStatusSchema", () => {
  it("leaveTypeSchema accepts each of the eight known types", () => {
    for (const t of ["annual", "sick", "personal", "casual", "maternity", "paternity", "unpaid", "emergency"]) {
      expect(leaveTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("leaveTypeSchema rejects a type outside the enum", () => {
    expect(leaveTypeSchema.safeParse("bereavement").success).toBe(false);
  });

  it("leaveRequestStatusSchema accepts each of the four known statuses", () => {
    for (const s of ["pending", "approved", "rejected", "cancelled"]) {
      expect(leaveRequestStatusSchema.safeParse(s).success).toBe(true);
    }
  });
});

describe("leaveRequestSchema", () => {
  const request = {
    id: "lr-1",
    number: "LR-2026-001",
    employeeId: "emp-1",
    leaveType: "annual" as const,
    halfDay: false,
    startDate: "2026-09-01",
    endDate: "2026-09-05",
    days: 5,
    reason: null,
    status: "pending" as const,
    createdAt: "2026-08-30T10:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
  };

  it("accepts a minimal valid request and preserves every field verbatim", () => {
    const result = leaveRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(request);
  });

  it("rejects an out-of-enum leaveType", () => {
    const result = leaveRequestSchema.safeParse({ ...request, leaveType: "bereavement" });
    expect(result.success).toBe(false);
  });
});

describe("createLeaveRequestSchema", () => {
  const create = { leaveType: "annual" as const, startDate: "2026-09-01", endDate: "2026-09-05" };

  it("accepts a minimal valid payload with employeeId omitted — the caller's own request", () => {
    const result = createLeaveRequestSchema.safeParse(create);
    expect(result.success).toBe(true);
  });

  it("accepts an explicit employeeId — filing on behalf of another employee", () => {
    const result = createLeaveRequestSchema.safeParse({ ...create, employeeId: "emp-2" });
    expect(result.success).toBe(true);
  });

  it("silently strips status — a new request always starts pending", () => {
    const result = createLeaveRequestSchema.safeParse({ ...create, status: "approved" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("status");
  });

  it("rejects a payload missing leaveType", () => {
    const { leaveType, ...rest } = create;
    const result = createLeaveRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("leaveType");
  });
});

describe("decideLeaveRequestSchema", () => {
  it("accepts a minimal valid decision", () => {
    const result = decideLeaveRequestSchema.safeParse({ decision: "approved" });
    expect(result.success).toBe(true);
  });

  it("rejects a decision outside approved/rejected", () => {
    const result = decideLeaveRequestSchema.safeParse({ decision: "pending" });
    expect(result.success).toBe(false);
  });
});

describe("attendanceStatusSchema / attendanceEntrySchema", () => {
  it("attendanceStatusSchema accepts each of the seven known statuses", () => {
    for (const s of ["present", "late", "half_day", "absent", "on_leave", "holiday", "weekly_off"]) {
      expect(attendanceStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  const entry = {
    id: "att-1",
    employeeId: "emp-1",
    date: "2026-08-30",
    checkIn: "09:00",
    checkOut: "17:00",
    workedMinutes: 480,
    approvedOvertimeMinutes: null,
    status: "present" as const,
    notes: null,
    createdAt: "2026-08-30T09:00:00.000Z",
    updatedAt: "2026-08-30T17:00:00.000Z",
  };

  it("attendanceEntrySchema accepts a minimal valid entry and preserves every field verbatim", () => {
    const result = attendanceEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(entry);
  });

  it("attendanceEntrySchema rejects a non-ISO date", () => {
    const result = attendanceEntrySchema.safeParse({ ...entry, date: "30/08/2026" });
    expect(result.success).toBe(false);
  });
});

describe("recordAttendanceSchema", () => {
  const record = { employeeId: "emp-1", date: "2026-08-30" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = recordAttendanceSchema.safeParse(record);
    expect(result.success).toBe(true);
  });

  it("accepts valid HH:MM check-in/check-out times", () => {
    const result = recordAttendanceSchema.safeParse({ ...record, checkIn: "09:00", checkOut: "17:30" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed checkIn time", () => {
    const result = recordAttendanceSchema.safeParse({ ...record, checkIn: "9am" });
    expect(result.success).toBe(false);
  });

  it("rejects a checkIn hour above 23", () => {
    const result = recordAttendanceSchema.safeParse({ ...record, checkIn: "25:00" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-ISO date", () => {
    const result = recordAttendanceSchema.safeParse({ ...record, date: "30/08/2026" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative graceMinutes", () => {
    const result = recordAttendanceSchema.safeParse({ ...record, graceMinutes: -5 });
    expect(result.success).toBe(false);
  });
});

describe("correctAttendanceSchema", () => {
  it("accepts an empty payload — id/employeeId/date are omitted, everything else optional", () => {
    const result = correctAttendanceSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("strips id, employeeId and date — a correction cannot re-target which record it edits", () => {
    const result = correctAttendanceSchema.safeParse({ id: "att-2", employeeId: "emp-2", date: "2026-09-01", notes: "corrected" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("id");
      expect(result.data).not.toHaveProperty("employeeId");
      expect(result.data).not.toHaveProperty("date");
      expect(result.data.notes).toBe("corrected");
    }
  });

  it("rejects a malformed checkIn time when supplied", () => {
    const result = correctAttendanceSchema.safeParse({ checkIn: "9am" });
    expect(result.success).toBe(false);
  });
});

describe("attendanceSummarySchema", () => {
  const summary = {
    employeeId: "emp-1",
    from: "2026-08-01",
    to: "2026-08-31",
    workingDays: 22,
    daysPresent: 20,
    daysLate: 2,
    daysAbsent: 1,
    halfDays: 1,
    daysOnLeave: 0,
    holidays: 1,
    weeklyOffDays: 8,
    workedMinutes: 9600,
    attendanceRatePercent: 90.9,
  };

  it("accepts a minimal valid summary and preserves every field verbatim", () => {
    const result = attendanceSummarySchema.safeParse(summary);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(summary);
  });

  it("rejects a summary missing attendanceRatePercent", () => {
    const { attendanceRatePercent, ...rest } = summary;
    const result = attendanceSummarySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("leavePolicySchema", () => {
  const policy = {
    id: "lp-1",
    leaveType: "annual" as const,
    entitlementDays: "21.000000",
    accrualFrequency: "annual" as const,
    carryOver: true,
    maxCarryOverDays: "5.000000",
    payoutOnTermination: true,
    legallyMandated: true,
    presetCode: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a minimal valid policy and preserves every field verbatim", () => {
    const result = leavePolicySchema.safeParse(policy);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(policy);
  });

  it("never coerces entitlementDays to a float — high-precision decimal string survives verbatim", () => {
    const result = leavePolicySchema.safeParse({ ...policy, entitlementDays: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.entitlementDays).toBe("0.100001");
  });

  it("rejects entitlementDays sent as a JS number instead of a string", () => {
    const result = leavePolicySchema.safeParse({ ...policy, entitlementDays: 21 });
    expect(result.success).toBe(false);
  });

  it("rejects entitlementDays with more than 6 decimal places", () => {
    const result = leavePolicySchema.safeParse({ ...policy, entitlementDays: "21.1234567" });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum accrualFrequency", () => {
    const result = leavePolicySchema.safeParse({ ...policy, accrualFrequency: "weekly" });
    expect(result.success).toBe(false);
  });
});

describe("createLeavePolicySchema / updateLeavePolicySchema", () => {
  const create = { leaveType: "annual" as const, entitlementDays: "21.000000", accrualFrequency: "annual" as const };

  it("createLeavePolicySchema accepts a minimal valid payload", () => {
    const result = createLeavePolicySchema.safeParse(create);
    expect(result.success).toBe(true);
  });

  it("createLeavePolicySchema rejects entitlementDays sent as a JS number", () => {
    const result = createLeavePolicySchema.safeParse({ ...create, entitlementDays: 21 });
    expect(result.success).toBe(false);
  });

  it("updateLeavePolicySchema accepts an empty payload", () => {
    const result = updateLeavePolicySchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("leavePolicyPresetSchema / applyLeavePolicyPresetSchema", () => {
  const preset = {
    code: "EG-LABOR-LAW",
    labelAr: "قانون العمل المصري",
    effectiveFrom: "2026-01-01",
    lines: [
      {
        leaveType: "annual" as const,
        entitlementDays: "21.000000",
        accrualFrequency: "annual" as const,
        carryOver: true,
        maxCarryOverDays: null,
        payoutOnTermination: true,
        legallyMandated: true,
        noteAr: "٢١ يوم إجازة سنوية",
      },
    ],
  };

  it("leavePolicyPresetSchema accepts a minimal valid preset and preserves every field verbatim", () => {
    const result = leavePolicyPresetSchema.safeParse(preset);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(preset);
  });

  it("applyLeavePolicyPresetSchema accepts a minimal valid payload", () => {
    const result = applyLeavePolicyPresetSchema.safeParse({ presetCode: "EG-LABOR-LAW" });
    expect(result.success).toBe(true);
  });

  it("applyLeavePolicyPresetSchema rejects an empty presetCode", () => {
    const result = applyLeavePolicyPresetSchema.safeParse({ presetCode: "" });
    expect(result.success).toBe(false);
  });
});

describe("leaveBalanceSchema / upsertLeaveBalanceSchema", () => {
  const balance = {
    id: "lb-1",
    employeeId: "emp-1",
    leaveType: "annual" as const,
    year: 2026,
    entitled: "21.000000",
    carriedOver: "0",
    used: "5.000000",
    available: "16.000000",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  };

  it("leaveBalanceSchema accepts a minimal valid balance and preserves every field verbatim", () => {
    const result = leaveBalanceSchema.safeParse(balance);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(balance);
  });

  it("leaveBalanceSchema rejects used sent as a JS number instead of a string", () => {
    const result = leaveBalanceSchema.safeParse({ ...balance, used: 5 });
    expect(result.success).toBe(false);
  });

  it("upsertLeaveBalanceSchema accepts a minimal valid payload with optionals omitted", () => {
    const result = upsertLeaveBalanceSchema.safeParse({ employeeId: "emp-1", leaveType: "annual", year: 2026 });
    expect(result.success).toBe(true);
  });
});

describe("leaveAccrualBatchSchema / runLeaveAccrualSchema", () => {
  const batch = {
    id: "lab-1",
    number: "LAB-2026-08",
    periodKey: "2026-08",
    frequency: "monthly" as const,
    runType: "scheduled" as const,
    runDate: "2026-08-31",
    notes: null,
    employeeCount: 10,
    totalDays: "17.500000",
    lines: [{ employeeId: "emp-1", leaveType: "annual" as const, days: "1.750000" }],
    runBy: null,
    createdAt: "2026-08-31T00:00:00.000Z",
  };

  it("leaveAccrualBatchSchema accepts a minimal valid batch and preserves every field verbatim", () => {
    const result = leaveAccrualBatchSchema.safeParse(batch);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(batch);
  });

  it("leaveAccrualBatchSchema rejects an out-of-enum runType", () => {
    const result = leaveAccrualBatchSchema.safeParse({ ...batch, runType: "auto" });
    expect(result.success).toBe(false);
  });

  it("runLeaveAccrualSchema accepts a minimal valid payload with optionals omitted", () => {
    const result = runLeaveAccrualSchema.safeParse({ runDate: "2026-08-31" });
    expect(result.success).toBe(true);
  });

  it("runLeaveAccrualSchema rejects a non-ISO runDate", () => {
    const result = runLeaveAccrualSchema.safeParse({ runDate: "31/08/2026" });
    expect(result.success).toBe(false);
  });
});

describe("hrDashboardSummarySchema", () => {
  const summary = {
    activeEmployees: 50,
    onLeave: 3,
    hiresThisMonth: 2,
    terminationsThisMonth: 1,
    contractsExpiringSoon: 4,
    probationEndingSoon: 2,
    byDepartment: [{ departmentId: "dept-1", departmentName: "Sales", departmentNameAr: "المبيعات", count: 20 }],
    byBranch: [{ branchId: "branch-1", count: 50 }],
    leaveConsumption: [{ leaveType: "annual" as const, entitled: 21, used: 5, pending: 1, usedPercent: 23.8 }],
    headcountTrend: [{ month: "2026-08", hires: 2, leavers: 1 }],
    attendance: {
      from: "2026-08-01",
      to: "2026-08-31",
      workingDays: 22,
      daysPresent: 20,
      daysLate: 2,
      halfDays: 1,
      daysAbsent: 1,
      daysOnLeave: 0,
      absenceRatePercent: 4.5,
      lateArrivalRatePercent: 9.1,
    },
  };

  it("accepts a minimal valid summary and preserves every field verbatim", () => {
    const result = hrDashboardSummarySchema.safeParse(summary);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(summary);
  });

  it("accepts a null entitled/usedPercent for a leave type never accrued", () => {
    const result = hrDashboardSummarySchema.safeParse({
      ...summary,
      leaveConsumption: [{ leaveType: "sick" as const, entitled: null, used: 0, pending: 0, usedPercent: null }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a summary missing attendance", () => {
    const { attendance, ...rest } = summary;
    const result = hrDashboardSummarySchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("attendance");
  });

  it("silently strips an unrecognised branchId at the top level — the report is already broken down byBranch inside", () => {
    const result = hrDashboardSummarySchema.safeParse({ ...summary, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });
});
