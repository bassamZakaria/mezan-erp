import { describe, it, expect, afterEach } from "vitest";
import { createSqliteDepartmentRepository, createSqliteEmployeeRepository } from "./hr-master-data-store.js";

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

describe("SqliteDepartmentRepository", () => {
  it("creates, lists, and finds a department by id/code", async () => {
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
      standardWorkHours: null,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(await repo.findById("d1")).toMatchObject({ code: "SALES", nameAr: "المبيعات" });
    expect(await repo.findByCode("SALES")).toMatchObject({ id: "d1" });
    expect(await repo.findByCode("NOPE")).toBeNull();
    expect(await repo.list()).toHaveLength(1);
  });

  it("update() overwrites an existing row", async () => {
    const repo = createSqliteDepartmentRepository();
    handles.push(repo);
    const base = {
      id: "d1",
      code: "SALES",
      name: "Sales",
      nameAr: null,
      parentDepartmentId: null,
      managerId: null,
      overtimeEligible: true,
      standardWorkHours: null,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    await repo.create(base);
    await repo.update({ ...base, active: false });
    expect(await repo.findById("d1")).toMatchObject({ active: false });
    expect(await repo.list()).toHaveLength(1);
  });
});

describe("SqliteEmployeeRepository", () => {
  it("creates, lists, and finds an employee by id, round-tripping nested address/emergencyContact", async () => {
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
      jobTitleId: null,
      managerId: null,
      branchId: "b1",
      hireDate: "2026-01-01",
      workerCategory: "staff",
      employmentType: "full_time",
      overtimeEligibility: "inherit_department",
      standardWorkHours: null,
      probationEndDate: null,
      priorServiceYears: 0,
      requireSelfieAtClockIn: false,
      requireBiometricAtClockIn: false,
      address: { street: "شارع النصر", city: "القاهرة", governorate: null, postalCode: null },
      emergencyContact: { name: "منى", relationship: "زوجة", phone: "0100", altPhone: null },
      status: "active",
      terminatedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const found = await repo.findById("e1");
    expect(found).toMatchObject({ code: "EMP-0001", departmentId: "d1", branchId: "b1" });
    expect(found?.address).toEqual({ street: "شارع النصر", city: "القاهرة", governorate: null, postalCode: null });
    expect(found?.emergencyContact).toEqual({ name: "منى", relationship: "زوجة", phone: "0100", altPhone: null });
    expect(await repo.list()).toHaveLength(1);
  });
});
