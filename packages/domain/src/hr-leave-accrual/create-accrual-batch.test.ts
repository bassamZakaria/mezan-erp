import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { applyLeavePolicyPreset } from "../hr-leave-policies/index.js";
import { createInMemoryLeavePolicyRepository } from "../hr-leave-policies/test-helpers/in-memory-leave-policy-repository.js";
import { createInMemoryEmployeeDirectory, employeeRefFixture } from "../hr-shared/test-helpers/in-memory-employee-directory.js";
import { createAccrualBatch } from "./create-accrual-batch.js";
import { DuplicateAccrualPeriodError, NoAccruableEmployeesError } from "./errors.js";
import { createInMemoryAccrualBatchRepository } from "./test-helpers/in-memory-accrual-batch-repository.js";

async function baseDeps(dailyRate: (id: string) => Promise<Money> = async () => Money.zero()) {
  const policies = createInMemoryLeavePolicyRepository();
  await applyLeavePolicyPreset({ source: "PRESET_EG_LAW_12_2003", idPrefix: "p12" }, { policies });
  const employees = createInMemoryEmployeeDirectory([employeeRefFixture({ id: "emp-1" }), employeeRefFixture({ id: "emp-2" })]);
  const batches = createInMemoryAccrualBatchRepository();
  return { batches, employees, policies, dailyRate };
}

describe("createAccrualBatch", () => {
  it("credits MONTHLY-accrual types (ANNUAL) every run, for every active employee", async () => {
    const deps = await baseDeps();
    const batch = await createAccrualBatch({ id: "b1", runDate: "2026-08-01", runType: "MANUAL" }, deps);

    expect(batch.status).toBe("draft");
    // 21 days / 12 = 1.75, x2 employees x1 MONTHLY type (ANNUAL leave type) — CASUAL/SICK/MATERNITY/UNPAID accrue ANNUAL or NONE, so August isn't January.
    const annualLines = batch.lines.filter((l) => l.leaveTypeCode === "ANNUAL");
    expect(annualLines).toHaveLength(2);
    expect(annualLines[0]!.creditedDays).toBe(1.75);
  });

  it("credits ANNUAL-accrual types only on a January run", async () => {
    const deps = await baseDeps();
    const august = await createAccrualBatch({ id: "b1", runDate: "2026-08-01", runType: "MANUAL" }, deps);
    expect(august.lines.some((l) => l.leaveTypeCode === "CASUAL")).toBe(false);

    const deps2 = await baseDeps();
    const january = await createAccrualBatch({ id: "b2", runDate: "2027-01-01", runType: "MANUAL" }, deps2);
    const casualLines = january.lines.filter((l) => l.leaveTypeCode === "CASUAL");
    expect(casualLines).toHaveLength(2);
    expect(casualLines[0]!.creditedDays).toBe(6);
  });

  it("computes each line's monetary value from the injected daily rate", async () => {
    const deps = await baseDeps(async () => Money.fromMajor("100.00"));
    const batch = await createAccrualBatch({ id: "b1", runDate: "2026-08-01", runType: "MANUAL" }, deps);
    const line = batch.lines.find((l) => l.employeeId === "emp-1" && l.leaveTypeCode === "ANNUAL")!;
    expect(line.value.toString()).toBe("175.000000"); // 1.75 days * 100.00
    expect(batch.totalValue.scaled).toBeGreaterThan(0n);
  });

  it("rejects a duplicate non-cancelled batch for the same period", async () => {
    const deps = await baseDeps();
    await createAccrualBatch({ id: "b1", runDate: "2026-08-01", runType: "MANUAL" }, deps);
    await expect(createAccrualBatch({ id: "b2", runDate: "2026-08-15", runType: "MANUAL" }, deps)).rejects.toBeInstanceOf(
      DuplicateAccrualPeriodError,
    );
  });

  it("allows a new batch for the same period once the prior one is cancelled", async () => {
    const deps = await baseDeps();
    const first = await createAccrualBatch({ id: "b1", runDate: "2026-08-01", runType: "MANUAL" }, deps);
    await deps.batches.update({ ...first, status: "cancelled" });
    const second = await createAccrualBatch({ id: "b2", runDate: "2026-08-20", runType: "MANUAL" }, deps);
    expect(second.status).toBe("draft");
  });

  it("rejects when there is nothing to accrue (no employees)", async () => {
    const policies = createInMemoryLeavePolicyRepository();
    await applyLeavePolicyPreset({ source: "PRESET_EG_LAW_12_2003", idPrefix: "p12" }, { policies });
    const deps = {
      batches: createInMemoryAccrualBatchRepository(),
      employees: createInMemoryEmployeeDirectory([]),
      policies,
      dailyRate: async () => Money.zero(),
    };
    await expect(createAccrualBatch({ id: "b1", runDate: "2026-08-01", runType: "MANUAL" }, deps)).rejects.toBeInstanceOf(
      NoAccruableEmployeesError,
    );
  });
});
