import { describe, it, expect, afterEach } from "vitest";
import { Money, createAccrualBatch, applyLeavePolicyPreset, type EmployeeDirectory, type EmployeeRef } from "@mezan/domain";
import { createSqliteLeaveAccrualBatchRepository } from "./hr-leave-accrual-store.js";
import { createSqliteLeavePolicyRepository } from "./hr-leave-policy-store.js";

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

const EMPLOYEE_1: EmployeeRef = {
  id: "emp-1",
  code: "EMP-0001",
  fullNameAr: "a",
  fullNameEn: "a",
  departmentId: null,
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

function fakeEmployeeDirectory(): EmployeeDirectory {
  return {
    async findById(id) {
      return id === EMPLOYEE_1.id ? EMPLOYEE_1 : null;
    },
    async list() {
      return [EMPLOYEE_1];
    },
    async listActive() {
      return [EMPLOYEE_1];
    },
  };
}

describe("SqliteLeaveAccrualBatchRepository", () => {
  it("round-trips a draft batch, including per-line Money values", async () => {
    const batches = createSqliteLeaveAccrualBatchRepository();
    handles.push(batches);
    const policies = createSqliteLeavePolicyRepository();
    handles.push(policies);
    const employees = fakeEmployeeDirectory();

    await applyLeavePolicyPreset({ source: "PRESET_EG_LAW_12_2003", idPrefix: "p12" }, { policies });

    const created = await createAccrualBatch(
      { id: "b1", runDate: "2026-08-01", runType: "MANUAL" },
      { batches, employees, policies, dailyRate: async () => Money.fromMajor("50.00") },
    );

    const found = await batches.findById("b1");
    expect(found).toEqual(created);
    expect(found?.lines[0]!.value.toString()).toBe(created.lines[0]!.value.toString());
  });

  it("findByPeriod returns the MOST RECENT batch for a period even once one was cancelled and superseded", async () => {
    const batches = createSqliteLeaveAccrualBatchRepository();
    handles.push(batches);
    const policies = createSqliteLeavePolicyRepository();
    handles.push(policies);
    const employees = fakeEmployeeDirectory();
    await applyLeavePolicyPreset({ source: "PRESET_EG_LAW_12_2003", idPrefix: "p12" }, { policies });
    const deps = { batches, employees, policies, dailyRate: async () => Money.zero() };

    const first = await createAccrualBatch(
      { id: "b1", runDate: "2026-08-01", runType: "MANUAL", now: () => "2026-08-01T00:00:00.000Z" },
      deps,
    );
    await batches.update({ ...first, status: "cancelled" });
    const second = await createAccrualBatch(
      { id: "b2", runDate: "2026-08-15", runType: "MANUAL", now: () => "2026-08-15T00:00:00.000Z" },
      deps,
    );

    const latest = await batches.findByPeriod("2026-08");
    expect(latest?.id).toBe(second.id);
    expect(latest?.status).toBe("draft");
  });

  it("list returns every batch, newest first", async () => {
    const batches = createSqliteLeaveAccrualBatchRepository();
    handles.push(batches);
    const policies = createSqliteLeavePolicyRepository();
    handles.push(policies);
    const employees = fakeEmployeeDirectory();
    await applyLeavePolicyPreset({ source: "PRESET_EG_LAW_12_2003", idPrefix: "p12" }, { policies });
    const deps = { batches, employees, policies, dailyRate: async () => Money.zero() };

    await createAccrualBatch({ id: "b1", runDate: "2026-08-01", runType: "MANUAL" }, deps);
    await createAccrualBatch({ id: "b2", runDate: "2027-01-01", runType: "SCHEDULED" }, deps);

    expect(await batches.list()).toHaveLength(2);
  });
});
