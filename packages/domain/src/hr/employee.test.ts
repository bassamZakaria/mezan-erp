import { describe, it, expect } from "vitest";
import { createInMemoryEmployeeRepository } from "./test-helpers/in-memory-hr-repositories.js";
import { createEmployee, updateEmployee } from "./create-employee.js";
import { transitionEmployee, terminateEmployee } from "./transition-employee.js";
import { InvalidEmployeeError, InvalidEmployeeTransitionError } from "./errors.js";
import { fullNameAr, fullNameEn, toEmployeeRef, createEmployeeDirectory, getEmployeeStatusLabel, EMPLOYEE_STATUS_DEFINITIONS, type EmployeeStatus } from "./employee.js";

const BASE = {
  id: "emp-1",
  code: "EMP-0001",
  firstName: "Ahmed",
  lastName: "Mahmoud",
  branchId: "MAIN",
  hireDate: "2026-01-01",
} as const;

describe("createEmployee", () => {
  it("creates an employee with defaults, starting status 'active'", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee(BASE, repo);
    expect(emp).toMatchObject({
      status: "active",
      workerCategory: "staff",
      employmentType: "full_time",
      overtimeEligibility: "inherit_department",
      priorServiceYears: 0,
      requireSelfieAtClockIn: false,
      requireBiometricAtClockIn: false, deviceBadgeId: null, hasPensionEntitlement: null, taxDisabilityExemption: false,
      terminatedAt: null,
    });
    expect(await repo.findById("emp-1")).toEqual(emp);
  });

  it("rejects missing required fields", async () => {
    const repo = createInMemoryEmployeeRepository();
    await expect(createEmployee({ ...BASE, firstName: "" }, repo)).rejects.toThrow(InvalidEmployeeError);
    await expect(createEmployee({ ...BASE, lastName: "" }, repo)).rejects.toThrow(InvalidEmployeeError);
    await expect(createEmployee({ ...BASE, branchId: "" }, repo)).rejects.toThrow(InvalidEmployeeError);
    await expect(createEmployee({ ...BASE, hireDate: "" }, repo)).rejects.toThrow(InvalidEmployeeError);
  });

  it("rejects a negative priorServiceYears", async () => {
    const repo = createInMemoryEmployeeRepository();
    await expect(createEmployee({ ...BASE, priorServiceYears: -1 }, repo)).rejects.toThrow(InvalidEmployeeError);
  });
});

describe("updateEmployee", () => {
  it("applies a patch and re-validates", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee(BASE, repo);
    const updated = updateEmployee(emp, { departmentId: "dept-1", jobTitleId: "jt-1", priorServiceYears: 3 });
    expect(updated.departmentId).toBe("dept-1");
    expect(updated.priorServiceYears).toBe(3);
  });

  it("rejects a patch that re-validates invalid (e.g. blanking the first name)", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee(BASE, repo);
    expect(() => updateEmployee(emp, { firstName: "" })).toThrow(InvalidEmployeeError);
  });
});

describe("employee status transitions", () => {
  it("allows active -> on_leave -> active", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee(BASE, repo);
    const onLeave = transitionEmployee(emp, "on_leave");
    expect(onLeave.status).toBe("on_leave");
    const active = transitionEmployee(onLeave, "active");
    expect(active.status).toBe("active");
  });

  it("rejects transitioning out of terminated", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee(BASE, repo);
    const terminated = terminateEmployee(emp, "2026-06-01", "2026-06-10");
    expect(terminated.status).toBe("terminated");
    expect(terminated.terminatedAt).toBe("2026-06-01");
    expect(() => terminateEmployee(emp, "2026-06-11", "2026-06-10")).toThrow(InvalidEmployeeError);
    expect(() => terminateEmployee(emp, "2026-06-01T00:00:00.000Z", "2026-06-10")).toThrow(InvalidEmployeeError);
    expect(() => terminateEmployee({ ...emp, hireDate: "2026-06-05" }, "2026-06-01", "2026-06-10")).toThrow(InvalidEmployeeError);
    expect(() => transitionEmployee(terminated, "active")).toThrow(InvalidEmployeeTransitionError);
  });

  it("terminateEmployee rejects an already-terminated employee", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee(BASE, repo);
    const terminated = terminateEmployee(emp, "2026-06-01");
    expect(() => terminateEmployee(terminated, "2026-06-02")).toThrow(InvalidEmployeeTransitionError);
  });
});

describe("getEmployeeStatusLabel", () => {
  it("returns the Arabic label for every defined status", () => {
    for (const def of EMPLOYEE_STATUS_DEFINITIONS) {
      expect(getEmployeeStatusLabel(def.code)).toBe(def.labelAr);
    }
  });

  it("falls back to the raw code for an unknown status", () => {
    expect(getEmployeeStatusLabel("bogus" as EmployeeStatus)).toBe("bogus");
  });
});

describe("name helpers + EmployeeDirectory adapter", () => {
  it("falls back to English names when Arabic names are absent", () => {
    expect(fullNameAr({ ...BASE, firstNameAr: null, lastNameAr: null })).toBe("Ahmed Mahmoud");
    expect(fullNameEn(BASE)).toBe("Ahmed Mahmoud");
  });

  it("prefers Arabic names when present", () => {
    expect(fullNameAr({ ...BASE, firstNameAr: "أحمد", lastNameAr: "محمود" })).toBe("أحمد محمود");
  });

  it("toEmployeeRef projects the stable EmployeeRef shape", async () => {
    const repo = createInMemoryEmployeeRepository();
    const emp = await createEmployee(BASE, repo);
    const ref = toEmployeeRef(emp);
    expect(ref).toMatchObject({ id: "emp-1", code: "EMP-0001", branchId: "MAIN", status: "active" });
  });

  it("createEmployeeDirectory adapts a repository into a read-only directory, excluding terminated from listActive", async () => {
    const repo = createInMemoryEmployeeRepository();
    const active = await createEmployee(BASE, repo);
    const toTerminate = await createEmployee({ ...BASE, id: "emp-2", code: "EMP-0002" }, repo);
    await repo.update(terminateEmployee(toTerminate, "2026-06-01"));

    const directory = createEmployeeDirectory(repo);
    expect((await directory.findById(active.id))?.id).toBe(active.id);
    expect(await directory.list()).toHaveLength(2);
    const activeRefs = await directory.listActive();
    expect(activeRefs.map((r) => r.id)).toEqual([active.id]);
  });
});
