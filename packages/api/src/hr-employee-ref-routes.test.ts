import { describe, it, expect } from "vitest";
import type { EmployeeDirectory, EmployeeRef } from "@mezan/domain";
import { createHrEmployeeRefRoutes } from "./hr-employee-ref-routes.js";

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const EMPLOYEE_1: EmployeeRef = {
  id: "emp-1",
  code: "EMP-0001",
  fullNameAr: "أحمد محمود",
  fullNameEn: "Ahmed Mahmoud",
  departmentId: "dept-1",
  jobTitleId: null,
  branchId: "branch-1",
  managerId: null,
  hireDate: "2025-01-01",
  status: "active",
  workerCategory: "staff",
  overtimeEligibility: "inherit_department",
  standardWorkHours: null,
  probationEndDate: null,
  priorServiceYears: 0,
  requireSelfieAtClockIn: false,
  requireBiometricAtClockIn: false,
};

function fakeEmployeeDirectory(seed: readonly EmployeeRef[]): EmployeeDirectory {
  return {
    async findById(id) {
      return seed.find((e) => e.id === id) ?? null;
    },
    async list() {
      return [...seed];
    },
    async listActive() {
      return seed.filter((e) => e.status === "active");
    },
  };
}

function newApp() {
  const employees = fakeEmployeeDirectory([EMPLOYEE_1]);
  return { app: createHrEmployeeRefRoutes(employees), employees };
}

describe("hr employee-ref router", () => {
  it("rejects with no permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
  });

  it("lists active employees with the permission, serialized down to the picker shape", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "hr.employee.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; nameAr: string; active: boolean }[];
    expect(body).toHaveLength(1);
    expect(body[0]!.id).toBe("emp-1");
    expect(body[0]!.nameAr).toBe("أحمد محمود");
    expect(body[0]!.active).toBe(true);
  });

  it("finds by id, 404s for unknown id", async () => {
    const { app } = newApp();
    const found = await app.fetch(req("/emp-1", { permissions: "hr.employee.view" }));
    expect(found.status).toBe(200);
    const missing = await app.fetch(req("/nope", { permissions: "hr.employee.view" }));
    expect(missing.status).toBe(404);
  });
});
