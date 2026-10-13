import { PayBasis } from "@mezan/domain";
import { EmployeeRefStatus } from "@mezan/domain";
import { ContractStatus } from "@mezan/domain";
import { describe, it, expect, afterEach } from "vitest";
import { Money } from "@mezan/domain";
import {
  createSqliteDepartmentRepository,
  createSqliteJobTitleRepository,
  createSqliteEmployeeRepository,
  createSqliteContractRepository,
  createSqliteHolidayRepository,
  createSqliteLeaveRequestRepository,
} from "./hr-store.js";

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

describe("SqliteDepartmentRepository", () => {
  it("round-trips a department through create/findById/findByCode/list/update", async () => {
    const repo = createSqliteDepartmentRepository();
    handles.push(repo);
    await repo.create({
      id: "d1",
      code: "SALES",
      name: "Sales",
      nameAr: "المبيعات",
      parentDepartmentId: null,
      managerId: null,
      overtimeEligible: true,
      standardWorkHours: 8,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await repo.findById("d1")).toMatchObject({ code: "SALES", name: "Sales" });
    expect(await repo.findByCode("SALES")).toMatchObject({ id: "d1" });
    expect(await repo.list()).toHaveLength(1);

    const current = await repo.findById("d1");
    await repo.update({ ...current!, name: "Sales & Marketing", active: false });
    expect(await repo.findById("d1")).toMatchObject({ name: "Sales & Marketing", active: false });
  });
});

describe("SqliteJobTitleRepository", () => {
  it("round-trips and filters by department", async () => {
    const repo = createSqliteJobTitleRepository();
    handles.push(repo);
    await repo.create({ id: "jt1", departmentId: "d1", name: "Sales Officer", nameAr: null, active: true, createdAt: "2026-01-01T00:00:00.000Z" });
    await repo.create({ id: "jt2", departmentId: "d2", name: "Accountant", nameAr: null, active: true, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(await repo.list()).toHaveLength(2);
    expect(await repo.listByDepartmentId("d1")).toHaveLength(1);
  });
});

describe("SqliteEmployeeRepository", () => {
  it("round-trips an employee including nested address/emergency-contact JSON", async () => {
    const repo = createSqliteEmployeeRepository();
    handles.push(repo);
    await repo.create({
      id: "e1",
      code: "EMP-0001",
      firstName: "Ahmed",
      lastName: "Mahmoud",
      firstNameAr: "أحمد",
      lastNameAr: "محمود",
      email: null,
      phone: null,
      birthDate: null,
      nationalId: null,
      gender: null,
      maritalStatus: null,
      departmentId: "d1",
      jobTitleId: "jt1",
      managerId: null,
      branchId: "MAIN",
      hireDate: "2026-01-01",
      workerCategory: "staff",
      employmentType: "full_time",
      overtimeEligibility: "inherit_department",
      standardWorkHours: null,
      probationEndDate: null,
      priorServiceYears: 2,
      requireSelfieAtClockIn: true,
      requireBiometricAtClockIn: false, deviceBadgeId: null, hasPensionEntitlement: null, taxDisabilityExemption: false,
      address: { street: "شارع النصر", city: "القاهرة", governorate: "القاهرة", postalCode: null },
      emergencyContact: { name: "سارة", relationship: "زوجة", phone: "0100000000", altPhone: null },
      status: EmployeeRefStatus.Active,
      terminatedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const found = await repo.findById("e1");
    expect(found?.address).toEqual({ street: "شارع النصر", city: "القاهرة", governorate: "القاهرة", postalCode: null });
    expect(found?.emergencyContact?.name).toBe("سارة");
    expect(found?.requireSelfieAtClockIn).toBe(true);
    expect(await repo.list()).toHaveLength(1);
  });
});

describe("SqliteContractRepository", () => {
  it("round-trips a contract including money and line-item arrays", async () => {
    const repo = createSqliteContractRepository();
    handles.push(repo);
    await repo.create({
      id: "c1",
      number: "CTR-0001",
      employeeId: "e1",
      type: "indefinite",
      payBasis: PayBasis.Monthly,
      payFrequency: "monthly",
      startDate: "2026-01-01",
      endDate: null,
      monthlySalary: Money.fromMajor("14000.00"),
      currency: "EGP",
      leaveEntitlement: { annualLeaveDays: 21, sickLeaveDays: null, personalLeaveDays: null },
      allowances: [{ id: "a1", name: "بدل مواصلات", amount: Money.fromMajor("500.00"), componentId: null }],
      deductions: [],
      status: ContractStatus.Active,
      terminatedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const found = await repo.findById("c1");
    expect(found?.monthlySalary.equals(Money.fromMajor("14000.00"))).toBe(true);
    expect(found?.allowances[0]?.amount.equals(Money.fromMajor("500.00"))).toBe(true);
    expect(found?.leaveEntitlement.annualLeaveDays).toBe(21);
    expect(await repo.listByEmployeeId("e1")).toHaveLength(1);
  });
});

describe("SqliteHolidayRepository", () => {
  it("round-trips through create/list/update/remove", async () => {
    const repo = createSqliteHolidayRepository();
    handles.push(repo);
    await repo.create({ id: "h1", date: "2026-10-06", nameEn: "National Day", nameAr: null, recurringAnnual: true, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(await repo.list()).toHaveLength(1);
    const current = await repo.findById("h1");
    await repo.update({ ...current!, nameAr: "اليوم الوطني" });
    expect((await repo.findById("h1"))?.nameAr).toBe("اليوم الوطني");
    await repo.remove("h1");
    expect(await repo.list()).toHaveLength(0);
  });
});

describe("SqliteLeaveRequestRepository", () => {
  it("round-trips and filters by employee", async () => {
    const repo = createSqliteLeaveRequestRepository();
    handles.push(repo);
    await repo.create({
      id: "lr1",
      number: "LR-000001",
      employeeId: "e1",
      leaveType: "annual",
      halfDay: false,
      startDate: "2026-08-10",
      endDate: "2026-08-12",
      days: 3,
      reason: null,
      status: "pending",
      createdAt: "2026-08-01T00:00:00.000Z",
      decidedAt: null,
      decidedBy: null,
    });
    expect(await repo.listByEmployeeId("e1")).toHaveLength(1);
    const current = await repo.findById("lr1");
    await repo.update({ ...current!, status: "approved", decidedAt: "2026-08-02T00:00:00.000Z", decidedBy: "user-1" });
    expect((await repo.findById("lr1"))?.status).toBe("approved");
  });
});
