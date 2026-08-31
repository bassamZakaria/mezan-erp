import { describe, it, expect, afterEach } from "vitest";
import type { Employee } from "@mezan/domain";
import {
  createSqliteDepartmentRepository,
  createSqliteEmployeeRepository,
  createSqliteHolidayRepository,
  createSqliteJobTitleRepository,
  createSqliteLeaveRequestRepository,
} from "./hr-store.js";

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "e1",
    code: "EMP-0001",
    firstName: "منى",
    lastName: "عبد الله",
    firstNameAr: null,
    lastNameAr: null,
    email: null,
    phone: null,
    birthDate: null,
    nationalId: null,
    gender: null,
    maritalStatus: null,
    departmentId: null,
    jobTitleId: null,
    managerId: null,
    branchId: "br-1",
    hireDate: "2025-01-01",
    workerCategory: "monthly",
    employmentType: "full_time",
    overtimeEligibility: "none",
    standardWorkHours: null,
    probationEndDate: null,
    priorServiceYears: 0,
    requireSelfieAtClockIn: false,
    requireBiometricAtClockIn: false,
    address: null,
    emergencyContact: null,
    status: "active",
    terminatedAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  } as Employee;
}

describe("SqliteEmployeeRepository — the columns an employee may leave empty", () => {
  it("round-trips an address and an emergency contact as real objects", async () => {
    const repo = createSqliteEmployeeRepository();
    handles.push(repo);
    await repo.create(
      employee({
        address: { street: "شارع مصطفى النحاس", city: "القاهرة", governorate: "القاهرة", postalCode: "11765" },
        emergencyContact: { name: "أحمد", relationship: "أخ", phone: "01000000000", altPhone: null },
      }),
    );

    const fetched = await repo.findById("e1");
    expect(fetched?.address).toEqual({
      street: "شارع مصطفى النحاس",
      city: "القاهرة",
      governorate: "القاهرة",
      postalCode: "11765",
    });
    expect(fetched?.emergencyContact).toMatchObject({ name: "أحمد", altPhone: null });
  });

  it("keeps an absent address and contact null rather than an empty object", async () => {
    const repo = createSqliteEmployeeRepository();
    handles.push(repo);
    await repo.create(employee());

    const fetched = await repo.findById("e1");
    expect(fetched?.address).toBeNull();
    expect(fetched?.emergencyContact).toBeNull();
  });

  it("round-trips the two clock-in requirements as real booleans", async () => {
    const repo = createSqliteEmployeeRepository();
    handles.push(repo);
    await repo.create(employee({ requireSelfieAtClockIn: true, requireBiometricAtClockIn: true }));

    const fetched = await repo.findById("e1");
    expect(fetched?.requireSelfieAtClockIn).toBe(true);
    expect(fetched?.requireBiometricAtClockIn).toBe(true);
  });

  it("returns null for an employee who was never created", async () => {
    const repo = createSqliteEmployeeRepository();
    handles.push(repo);
    expect(await repo.findById("nope")).toBeNull();
  });
});

describe("SqliteDepartmentRepository and SqliteJobTitleRepository — their flags and their misses", () => {
  it("round-trips the overtime-eligible flag as a real boolean, both ways", async () => {
    const repo = createSqliteDepartmentRepository();
    handles.push(repo);
    for (const [id, code, eligible] of [
      ["d1", "OPS", true],
      ["d2", "ADMIN", false],
    ] as const) {
      await repo.create({
        id,
        code,
        name: code,
        nameAr: null,
        parentDepartmentId: null,
        managerId: null,
        overtimeEligible: eligible,
        standardWorkHours: 8,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    }

    expect((await repo.findById("d1"))?.overtimeEligible).toBe(true);
    expect((await repo.findById("d2"))?.overtimeEligible).toBe(false);
  });

  it("returns null for a department that is not there, by id and by code", async () => {
    const repo = createSqliteDepartmentRepository();
    handles.push(repo);
    expect(await repo.findById("nope")).toBeNull();
    expect(await repo.findByCode("NOPE")).toBeNull();
  });

  it("round-trips a job title's active flag as a real boolean", async () => {
    const repo = createSqliteJobTitleRepository();
    handles.push(repo);
    await repo.create({
      id: "jt-1",
      departmentId: "d1",
      name: "Storekeeper",
      nameAr: "أمين مخزن",
      active: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect((await repo.findById("jt-1"))?.active).toBe(false);
    expect(await repo.findById("nope")).toBeNull();
  });
});

describe("SqliteHolidayRepository and SqliteLeaveRequestRepository", () => {
  it("round-trips the recurring flag as a real boolean, both ways", async () => {
    const repo = createSqliteHolidayRepository();
    handles.push(repo);
    await repo.create({
      id: "h-1",
      date: "2026-04-20",
      nameEn: "Sham El-Nessim",
      nameAr: "شم النسيم",
      recurringAnnual: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await repo.create({
      id: "h-2",
      date: "2026-07-23",
      nameEn: "Revolution Day",
      nameAr: null,
      recurringAnnual: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect((await repo.findById("h-1"))?.recurringAnnual).toBe(true);
    expect((await repo.findById("h-2"))?.recurringAnnual).toBe(false);
    expect((await repo.findById("h-2"))?.nameAr).toBeNull();
    expect(await repo.findById("nope")).toBeNull();
  });

  it("round-trips a half-day leave request as a real boolean, and reports a missing one as null", async () => {
    const repo = createSqliteLeaveRequestRepository();
    handles.push(repo);
    await repo.create({
      id: "lr-1",
      number: "LR-000001",
      employeeId: "e1",
      leaveType: "annual",
      halfDay: true,
      startDate: "2026-08-10",
      endDate: "2026-08-10",
      days: 0.5,
      reason: null,
      status: "pending",
      createdAt: "2026-08-01T00:00:00.000Z",
      decidedAt: null,
      decidedBy: null,
    });

    const fetched = await repo.findById("lr-1");
    expect(fetched?.halfDay).toBe(true);
    expect(fetched?.days).toBe(0.5);
    expect(fetched?.reason).toBeNull();
    expect(await repo.findById("nope")).toBeNull();
  });
});
