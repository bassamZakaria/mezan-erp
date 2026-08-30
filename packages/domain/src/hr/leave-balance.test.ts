import { describe, it, expect } from "vitest";
import { Qty } from "../money/index.js";
import type { EmployeeDirectory } from "../hr-shared/employee-ref.js";
import { createEmployeeDirectory } from "./employee.js";
import { createInMemoryEmployeeRepository } from "./test-helpers/in-memory-hr-repositories.js";
import { createEmployee } from "./create-employee.js";
import { createLeavePolicy } from "./leave-policy.js";
import { createLeaveRequest, decideLeaveRequest } from "./leave-request.js";
import {
  availableLeaveDays,
  createLeaveBalance,
  adjustLeaveBalance,
  accrualPeriodKey,
  runLeaveAccrual,
  consumeLeaveBalance,
  releaseLeaveBalance,
  assertLeaveBalanceCovers,
  createUnpaidLeaveDaysProvider,
  type LeaveBalance,
  type LeaveBalanceRepository,
  type LeaveAccrualBatch,
  type LeaveAccrualBatchRepository,
  type RunLeaveAccrualDeps,
} from "./leave-balance.js";
import type { LeavePolicyRepository } from "./leave-policy.js";
import type { LeaveRequestRepository } from "./leave-request.js";
import {
  InvalidLeaveAccrualBatchError,
  InvalidLeaveBalanceError,
  LeaveBalanceExceededError,
} from "./errors.js";

function createInMemoryLeaveBalanceRepository(): LeaveBalanceRepository {
  const rows = new Map<string, LeaveBalance>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async find(employeeId, leaveType, year) {
      return [...rows.values()].find((b) => b.employeeId === employeeId && b.leaveType === leaveType && b.year === year) ?? null;
    },
    async list(filter) {
      return [...rows.values()].filter((b) => {
        if (filter?.employeeId && b.employeeId !== filter.employeeId) return false;
        if (filter?.leaveType && b.leaveType !== filter.leaveType) return false;
        if (filter?.year != null && b.year !== filter.year) return false;
        return true;
      });
    },
    async create(balance) {
      rows.set(balance.id, balance);
    },
    async update(balance) {
      rows.set(balance.id, balance);
    },
  };
}

function createInMemoryLeaveAccrualBatchRepository(): LeaveAccrualBatchRepository {
  const rows = new Map<string, LeaveAccrualBatch>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByPeriodKey(periodKey) {
      return [...rows.values()].find((b) => b.periodKey === periodKey) ?? null;
    },
    async list(filter) {
      return [...rows.values()].filter((b) => (filter?.runType ? b.runType === filter.runType : true));
    },
    async create(batch) {
      rows.set(batch.id, batch);
    },
  };
}

function createInMemoryLeavePolicyRepository(): LeavePolicyRepository {
  const rows = new Map<string, LeavePolicy2>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByLeaveType(leaveType) {
      return [...rows.values()].find((p) => p.leaveType === leaveType) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async create(policy) {
      rows.set(policy.id, policy);
    },
    async update(policy) {
      rows.set(policy.id, policy);
    },
    async remove(id) {
      rows.delete(id);
    },
  };
}
type LeavePolicy2 = ReturnType<typeof createLeavePolicy>;

describe("availableLeaveDays", () => {
  it("is entitled + carriedOver - used", () => {
    const available = availableLeaveDays({ entitled: Qty.fromMajor("21"), carriedOver: Qty.fromMajor("3"), used: Qty.fromMajor("5") });
    expect(available.toString()).toBe("19.000000");
  });
});

describe("createLeaveBalance", () => {
  it("creates a balance defaulting every quantity to zero", () => {
    const balance = createLeaveBalance({ id: "lb-1", employeeId: "emp-1", leaveType: "annual", year: 2026 }, () => "2026-01-01T00:00:00.000Z");
    expect(balance.entitled.isZero()).toBe(true);
    expect(balance.carriedOver.isZero()).toBe(true);
    expect(balance.used.isZero()).toBe(true);
    expect(balance.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects a missing employee", () => {
    expect(() => createLeaveBalance({ id: "lb-1", employeeId: "", leaveType: "annual", year: 2026 })).toThrow(InvalidLeaveBalanceError);
  });

  it("rejects an invalid year", () => {
    expect(() => createLeaveBalance({ id: "lb-1", employeeId: "emp-1", leaveType: "annual", year: 1999 })).toThrow(InvalidLeaveBalanceError);
  });

  it("rejects negative entitled/carriedOver/used", () => {
    expect(() => createLeaveBalance({ id: "lb-1", employeeId: "emp-1", leaveType: "annual", year: 2026, entitled: Qty.fromMajor("-1") })).toThrow(
      InvalidLeaveBalanceError,
    );
    expect(() =>
      createLeaveBalance({ id: "lb-1", employeeId: "emp-1", leaveType: "annual", year: 2026, carriedOver: Qty.fromMajor("-1") }),
    ).toThrow(InvalidLeaveBalanceError);
    expect(() => createLeaveBalance({ id: "lb-1", employeeId: "emp-1", leaveType: "annual", year: 2026, used: Qty.fromMajor("-1") })).toThrow(
      InvalidLeaveBalanceError,
    );
  });
});

describe("adjustLeaveBalance", () => {
  const base = createLeaveBalance({ id: "lb-1", employeeId: "emp-1", leaveType: "annual", year: 2026, entitled: Qty.fromMajor("21") });

  it("applies a patch and stamps updatedAt", () => {
    const updated = adjustLeaveBalance(base, { used: Qty.fromMajor("5") }, () => "2026-03-01T00:00:00.000Z");
    expect(updated.used.toString()).toBe("5.000000");
    expect(updated.updatedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("rejects a patch that goes negative", () => {
    expect(() => adjustLeaveBalance(base, { used: Qty.fromMajor("-1") })).toThrow(InvalidLeaveBalanceError);
  });
});

describe("accrualPeriodKey", () => {
  it("is YYYY-MM for a monthly frequency", () => {
    expect(accrualPeriodKey("2026-03-15", "monthly")).toBe("2026-03");
  });

  it("is YYYY for an annual frequency", () => {
    expect(accrualPeriodKey("2026-03-15", "annual")).toBe("2026");
  });
});

async function directoryWith(...employees: { id: string; hireDate?: string; status?: "active" | "terminated" }[]): Promise<EmployeeDirectory> {
  const repo = createInMemoryEmployeeRepository();
  for (const e of employees) {
    await createEmployee(
      { id: e.id, code: e.id.toUpperCase(), firstName: "F", lastName: "L", branchId: "MAIN", hireDate: e.hireDate ?? "2020-01-01" },
      repo,
    );
  }
  return createEmployeeDirectory(repo);
}

function accrualDeps(overrides: Partial<RunLeaveAccrualDeps> = {}): RunLeaveAccrualDeps {
  return {
    batches: createInMemoryLeaveAccrualBatchRepository(),
    balances: createInMemoryLeaveBalanceRepository(),
    policies: createInMemoryLeavePolicyRepository(),
    employees: { async findById() { return null; }, async list() { return []; }, async listActive() { return []; } },
    generateId: (() => {
      let n = 0;
      return () => `gen-${++n}`;
    })(),
    ...overrides,
  };
}

describe("runLeaveAccrual", () => {
  it("rejects a malformed run date", async () => {
    const deps = accrualDeps();
    await expect(runLeaveAccrual({ id: "b1", number: "LAB-000001", runDate: "not-a-date", frequency: "monthly" }, deps)).rejects.toThrow(
      InvalidLeaveAccrualBatchError,
    );
  });

  it("credits every active monthly policy to every active employee, skipping annual/none policies", async () => {
    const policies = createInMemoryLeavePolicyRepository();
    await policies.create(createLeavePolicy({ id: "p1", leaveType: "annual", entitlementDays: Qty.fromMajor("21"), accrualFrequency: "monthly" }));
    await policies.create(createLeavePolicy({ id: "p2", leaveType: "sick", entitlementDays: Qty.fromMajor("180"), accrualFrequency: "annual" }));
    await policies.create(createLeavePolicy({ id: "p3", leaveType: "maternity", entitlementDays: Qty.fromMajor("90"), accrualFrequency: "none" }));
    const employees = await directoryWith({ id: "emp-1" }, { id: "emp-2" });
    const balances = createInMemoryLeaveBalanceRepository();
    const deps = accrualDeps({ policies, employees, balances });

    const result = await runLeaveAccrual(
      { id: "b1", number: "LAB-000001", runDate: "2026-03-15", frequency: "monthly" },
      deps,
      () => "2026-03-15T00:00:00.000Z",
    );

    expect(result.created).toBe(true);
    expect(result.batch.periodKey).toBe("2026-03");
    expect(result.batch.employeeCount).toBe(2);
    expect(result.batch.lines).toHaveLength(2);
    expect(result.batch.totalDays.toString()).toBe("3.500000"); // 2 employees x 1.75 (21/12)

    const emp1Balance = await balances.find("emp-1", "annual", 2026);
    expect(emp1Balance!.entitled.toString()).toBe("1.750000");
  });

  it("is idempotent per periodKey: a second call for the same period credits nothing and returns created:false", async () => {
    const policies = createInMemoryLeavePolicyRepository();
    await policies.create(createLeavePolicy({ id: "p1", leaveType: "annual", entitlementDays: Qty.fromMajor("21"), accrualFrequency: "monthly" }));
    const employees = await directoryWith({ id: "emp-1" });
    const balances = createInMemoryLeaveBalanceRepository();
    const batches = createInMemoryLeaveAccrualBatchRepository();
    const deps = accrualDeps({ policies, employees, balances, batches });

    const first = await runLeaveAccrual({ id: "b1", number: "LAB-000001", runDate: "2026-03-15", frequency: "monthly" }, deps);
    const second = await runLeaveAccrual({ id: "b2", number: "LAB-000002", runDate: "2026-03-20", frequency: "monthly" }, deps);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.batch.id).toBe("b1");
    const balance = await balances.find("emp-1", "annual", 2026);
    expect(balance!.entitled.toString()).toBe("1.750000"); // not doubled
  });

  it("credits an EXISTING balance by adding to it rather than replacing it", async () => {
    const policies = createInMemoryLeavePolicyRepository();
    await policies.create(createLeavePolicy({ id: "p1", leaveType: "annual", entitlementDays: Qty.fromMajor("21"), accrualFrequency: "monthly" }));
    const employees = await directoryWith({ id: "emp-1" });
    const balances = createInMemoryLeaveBalanceRepository();
    await balances.create(createLeaveBalance({ id: "existing", employeeId: "emp-1", leaveType: "annual", year: 2026, entitled: Qty.fromMajor("10") }));
    const deps = accrualDeps({ policies, employees, balances });

    await runLeaveAccrual({ id: "b1", number: "LAB-000001", runDate: "2026-03-15", frequency: "monthly" }, deps);

    const balance = await balances.find("emp-1", "annual", 2026);
    expect(balance!.entitled.toString()).toBe("11.750000"); // 10 + 1.75
    expect(balance!.id).toBe("existing");
  });

  it("skips employees no policy applies days to (accrualDaysPerPeriod === 0) without crediting them", async () => {
    const policies = createInMemoryLeavePolicyRepository();
    await policies.create(createLeavePolicy({ id: "p1", leaveType: "annual", entitlementDays: Qty.fromMajor("0"), accrualFrequency: "monthly" }));
    const employees = await directoryWith({ id: "emp-1" });
    const deps = accrualDeps({ policies, employees });

    const result = await runLeaveAccrual({ id: "b1", number: "LAB-000001", runDate: "2026-03-15", frequency: "monthly" }, deps);
    expect(result.batch.employeeCount).toBe(0);
    expect(result.batch.lines).toEqual([]);
  });
});

describe("assertLeaveBalanceCovers", () => {
  it("unpaid leave is always exempt, even against a zero/missing balance", () => {
    expect(() => assertLeaveBalanceCovers("unpaid", 30, null)).not.toThrow();
  });

  it("a missing balance counts as zero available, refusing any positive request", () => {
    expect(() => assertLeaveBalanceCovers("annual", 1, null)).toThrow(LeaveBalanceExceededError);
  });

  it("a request exactly at the available balance is accepted (boundary)", () => {
    const balance = { entitled: Qty.fromMajor("5"), carriedOver: Qty.zero(), used: Qty.zero() };
    expect(() => assertLeaveBalanceCovers("annual", 5, balance)).not.toThrow();
  });

  it("a request one day over the available balance is refused (boundary)", () => {
    const balance = { entitled: Qty.fromMajor("5"), carriedOver: Qty.zero(), used: Qty.zero() };
    expect(() => assertLeaveBalanceCovers("annual", 6, balance)).toThrow(LeaveBalanceExceededError);
  });
});

describe("consumeLeaveBalance / releaseLeaveBalance", () => {
  it("consumeLeaveBalance creates a balance at the consumed amount when none exists", async () => {
    const balances = createInMemoryLeaveBalanceRepository();
    const result = await consumeLeaveBalance("emp-1", "annual", 2026, Qty.fromMajor("3"), balances, () => "gen-1");
    expect(result.used.toString()).toBe("3.000000");
    expect((await balances.find("emp-1", "annual", 2026))!.used.toString()).toBe("3.000000");
  });

  it("consumeLeaveBalance adds to an existing balance", async () => {
    const balances = createInMemoryLeaveBalanceRepository();
    await balances.create(createLeaveBalance({ id: "b1", employeeId: "emp-1", leaveType: "annual", year: 2026, used: Qty.fromMajor("2") }));
    const result = await consumeLeaveBalance("emp-1", "annual", 2026, Qty.fromMajor("3"), balances, () => "gen-1");
    expect(result.used.toString()).toBe("5.000000");
  });

  it("consuming leave the tenant never accrued for still records it, driving the balance negative", async () => {
    const balances = createInMemoryLeaveBalanceRepository();
    const result = await consumeLeaveBalance("emp-1", "annual", 2026, Qty.fromMajor("5"), balances, () => "gen-1");
    expect(availableLeaveDays(result).toString()).toBe("-5.000000");
  });

  it("releaseLeaveBalance returns null when no balance row exists", async () => {
    const balances = createInMemoryLeaveBalanceRepository();
    expect(await releaseLeaveBalance("emp-1", "annual", 2026, Qty.fromMajor("2"), balances)).toBeNull();
  });

  it("releaseLeaveBalance reduces used by exactly the released amount", async () => {
    const balances = createInMemoryLeaveBalanceRepository();
    await balances.create(createLeaveBalance({ id: "b1", employeeId: "emp-1", leaveType: "annual", year: 2026, used: Qty.fromMajor("5") }));
    const released = await releaseLeaveBalance("emp-1", "annual", 2026, Qty.fromMajor("2"), balances);
    expect(released!.used.toString()).toBe("3.000000");
  });

  it("releaseLeaveBalance never drives used below zero", async () => {
    const balances = createInMemoryLeaveBalanceRepository();
    await balances.create(createLeaveBalance({ id: "b1", employeeId: "emp-1", leaveType: "annual", year: 2026, used: Qty.fromMajor("2") }));
    const released = await releaseLeaveBalance("emp-1", "annual", 2026, Qty.fromMajor("5"), balances);
    expect(released!.used.toString()).toBe("0.000000");
  });
});

describe("createUnpaidLeaveDaysProvider", () => {
  function repoWith(requests: Awaited<ReturnType<typeof createLeaveRequest>>[]): Pick<LeaveRequestRepository, "listByEmployeeId"> {
    return {
      async listByEmployeeId(employeeId) {
        return requests.filter((r) => r.employeeId === employeeId);
      },
    };
  }

  it("counts only approved unpaid-leave requests overlapping the period", async () => {
    const repo = createInMemoryLeaveRequestRepository();
    const unpaid = await createLeaveRequest(
      { id: "lr-1", number: "LR-000001", employeeId: "emp-1", leaveType: "unpaid", startDate: "2026-01-10", endDate: "2026-01-12" },
      repo,
    );
    const approvedUnpaid = decideLeaveRequest(unpaid, "approved", "user-1");
    await repo.update(approvedUnpaid);
    const pendingUnpaid = await createLeaveRequest(
      { id: "lr-2", number: "LR-000002", employeeId: "emp-1", leaveType: "unpaid", startDate: "2026-01-15", endDate: "2026-01-16" },
      repo,
    );
    const approvedAnnual = decideLeaveRequest(
      await createLeaveRequest(
        { id: "lr-3", number: "LR-000003", employeeId: "emp-1", leaveType: "annual", startDate: "2026-01-20", endDate: "2026-01-21" },
        repo,
      ),
      "approved",
      "user-1",
    );
    await repo.update(approvedAnnual);

    const provider = createUnpaidLeaveDaysProvider(repoWith([approvedUnpaid, pendingUnpaid, approvedAnnual]));
    const days = await provider.unpaidDaysFor("emp-1", "2026-01-01", "2026-01-31");
    expect(days).toBe(3); // only lr-1: Jan 10-12 inclusive
  });

  it("counts only the portion of a request overlapping the period (a leave spanning a month end)", async () => {
    const repo = createInMemoryLeaveRequestRepository();
    const spanning = decideLeaveRequest(
      await createLeaveRequest(
        { id: "lr-1", number: "LR-000001", employeeId: "emp-1", leaveType: "unpaid", startDate: "2026-01-28", endDate: "2026-02-03" },
        repo,
      ),
      "approved",
      "user-1",
    );
    const provider = createUnpaidLeaveDaysProvider(repoWith([spanning]));
    // January period only sees Jan 28-31 (4 days) of the 7-day request.
    expect(await provider.unpaidDaysFor("emp-1", "2026-01-01", "2026-01-31")).toBe(4);
    // February period only sees Feb 1-3 (3 days).
    expect(await provider.unpaidDaysFor("emp-1", "2026-02-01", "2026-02-28")).toBe(3);
  });

  it("counts a half-day request as its recorded 0.5 days regardless of overlap math", async () => {
    const repo = createInMemoryLeaveRequestRepository();
    const halfDay = decideLeaveRequest(
      await createLeaveRequest(
        { id: "lr-1", number: "LR-000001", employeeId: "emp-1", leaveType: "unpaid", halfDay: true, startDate: "2026-01-10", endDate: "2026-01-10" },
        repo,
      ),
      "approved",
      "user-1",
    );
    const provider = createUnpaidLeaveDaysProvider(repoWith([halfDay]));
    expect(await provider.unpaidDaysFor("emp-1", "2026-01-01", "2026-01-31")).toBe(0.5);
  });

  it("is zero when nothing overlaps the requested period", async () => {
    const repo = createInMemoryLeaveRequestRepository();
    const outOfRange = decideLeaveRequest(
      await createLeaveRequest(
        { id: "lr-1", number: "LR-000001", employeeId: "emp-1", leaveType: "unpaid", startDate: "2026-03-01", endDate: "2026-03-02" },
        repo,
      ),
      "approved",
      "user-1",
    );
    const provider = createUnpaidLeaveDaysProvider(repoWith([outOfRange]));
    expect(await provider.unpaidDaysFor("emp-1", "2026-01-01", "2026-01-31")).toBe(0);
  });
});

function createInMemoryLeaveRequestRepository(): LeaveRequestRepository {
  const rows = new Map<string, Awaited<ReturnType<typeof createLeaveRequest>>>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async listByEmployeeId(employeeId) {
      return [...rows.values()].filter((r) => r.employeeId === employeeId);
    },
    async create(request) {
      rows.set(request.id, request);
    },
    async update(request) {
      rows.set(request.id, request);
    },
  };
}
