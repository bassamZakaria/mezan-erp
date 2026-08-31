import { describe, it, expect } from "vitest";
import {
  DepartmentNotFoundError,
  JobTitleNotFoundError,
  EmployeeNotFoundError,
  UserNotLinkedToEmployeeError,
  ContractNotFoundError,
  HolidayNotFoundError,
  LeaveRequestNotFoundError,
  AttendanceEntryNotFoundError,
  LeavePolicyNotFoundError,
  DuplicateLeavePolicyError,
  LeaveBalanceNotFoundError,
  PayrollComponentNotFoundError,
  DuplicatePayrollComponentError,
  DuplicatePayrollPeriodError,
} from "./errors.js";

describe("hr errors — the remaining not-found/duplicate constructors", () => {
  it("DepartmentNotFoundError carries the missing id", () => {
    const err = new DepartmentNotFoundError("dept-1");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DepartmentNotFoundError");
    expect(err.code).toBe("DEPARTMENT_NOT_FOUND");
    expect(err.departmentId).toBe("dept-1");
    expect(err.message).toBe('Department "dept-1" was not found.');
  });

  it("JobTitleNotFoundError carries the missing id", () => {
    const err = new JobTitleNotFoundError("jt-1");
    expect(err.name).toBe("JobTitleNotFoundError");
    expect(err.code).toBe("JOB_TITLE_NOT_FOUND");
    expect(err.jobTitleId).toBe("jt-1");
    expect(err.message).toBe('Job title "jt-1" was not found.');
  });

  it("EmployeeNotFoundError carries the missing id", () => {
    const err = new EmployeeNotFoundError("emp-1");
    expect(err.name).toBe("EmployeeNotFoundError");
    expect(err.code).toBe("EMPLOYEE_NOT_FOUND");
    expect(err.employeeId).toBe("emp-1");
    expect(err.message).toBe('Employee "emp-1" was not found.');
  });

  it("UserNotLinkedToEmployeeError carries the user id", () => {
    const err = new UserNotLinkedToEmployeeError("usr-1");
    expect(err.name).toBe("UserNotLinkedToEmployeeError");
    expect(err.code).toBe("USER_NOT_LINKED_TO_EMPLOYEE");
    expect(err.userId).toBe("usr-1");
    expect(err.message).toBe('User "usr-1" is not linked to an employee record.');
  });

  it("ContractNotFoundError carries the missing id", () => {
    const err = new ContractNotFoundError("ctr-1");
    expect(err.name).toBe("ContractNotFoundError");
    expect(err.code).toBe("CONTRACT_NOT_FOUND");
    expect(err.contractId).toBe("ctr-1");
    expect(err.message).toBe('Contract "ctr-1" was not found.');
  });

  it("HolidayNotFoundError carries the missing id", () => {
    const err = new HolidayNotFoundError("hol-1");
    expect(err.name).toBe("HolidayNotFoundError");
    expect(err.code).toBe("HOLIDAY_NOT_FOUND");
    expect(err.holidayId).toBe("hol-1");
    expect(err.message).toBe('Holiday "hol-1" was not found.');
  });

  it("LeaveRequestNotFoundError carries the missing id", () => {
    const err = new LeaveRequestNotFoundError("lr-1");
    expect(err.name).toBe("LeaveRequestNotFoundError");
    expect(err.code).toBe("LEAVE_REQUEST_NOT_FOUND");
    expect(err.leaveRequestId).toBe("lr-1");
    expect(err.message).toBe('Leave request "lr-1" was not found.');
  });

  it("AttendanceEntryNotFoundError carries the missing id", () => {
    const err = new AttendanceEntryNotFoundError("att-1");
    expect(err.name).toBe("AttendanceEntryNotFoundError");
    expect(err.code).toBe("ATTENDANCE_ENTRY_NOT_FOUND");
    expect(err.entryId).toBe("att-1");
    expect(err.message).toBe('Attendance entry "att-1" was not found.');
  });

  it("LeavePolicyNotFoundError carries the missing id", () => {
    const err = new LeavePolicyNotFoundError("pol-1");
    expect(err.name).toBe("LeavePolicyNotFoundError");
    expect(err.code).toBe("LEAVE_POLICY_NOT_FOUND");
    expect(err.policyId).toBe("pol-1");
    expect(err.message).toBe('Leave policy "pol-1" was not found.');
  });

  it("DuplicateLeavePolicyError carries the leave type", () => {
    const err = new DuplicateLeavePolicyError("annual");
    expect(err.name).toBe("DuplicateLeavePolicyError");
    expect(err.code).toBe("DUPLICATE_LEAVE_POLICY");
    expect(err.leaveType).toBe("annual");
    expect(err.message).toBe('A leave policy for "annual" already exists.');
  });

  it("LeaveBalanceNotFoundError carries the missing id", () => {
    const err = new LeaveBalanceNotFoundError("bal-1");
    expect(err.name).toBe("LeaveBalanceNotFoundError");
    expect(err.code).toBe("LEAVE_BALANCE_NOT_FOUND");
    expect(err.balanceId).toBe("bal-1");
    expect(err.message).toBe('Leave balance "bal-1" was not found.');
  });

  it("PayrollComponentNotFoundError carries the missing id in Arabic", () => {
    const err = new PayrollComponentNotFoundError("comp-1");
    expect(err.name).toBe("PayrollComponentNotFoundError");
    expect(err.code).toBe("PAYROLL_COMPONENT_NOT_FOUND");
    expect(err.componentId).toBe("comp-1");
    expect(err.message).toBe("مكوّن الرواتب غير موجود: comp-1");
  });

  it("DuplicatePayrollComponentError carries the reused code in Arabic", () => {
    const err = new DuplicatePayrollComponentError("BASIC");
    expect(err.name).toBe("DuplicatePayrollComponentError");
    expect(err.code).toBe("DUPLICATE_PAYROLL_COMPONENT");
    expect(err.componentCode).toBe("BASIC");
    expect(err.message).toBe("كود مكوّن الرواتب مستخدم بالفعل: BASIC");
  });

  it("DuplicatePayrollPeriodError names the branch when one is given", () => {
    const err = new DuplicatePayrollPeriodError(2026, 3, "MAIN");
    expect(err.name).toBe("DuplicatePayrollPeriodError");
    expect(err.code).toBe("DUPLICATE_PAYROLL_PERIOD");
    expect(err.year).toBe(2026);
    expect(err.month).toBe(3);
    expect(err.branchId).toBe("MAIN");
    expect(err.message).toBe("A payroll run already exists for 2026-03 (branch MAIN).");
  });

  it("DuplicatePayrollPeriodError omits the branch clause for a tenant-wide run", () => {
    const err = new DuplicatePayrollPeriodError(2026, 11, null);
    expect(err.branchId).toBeNull();
    expect(err.message).toBe("A payroll run already exists for 2026-11.");
  });
});
