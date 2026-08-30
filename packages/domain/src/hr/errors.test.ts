import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { requestEmployeeAdvance, approveEmployeeAdvance, type EmployeeAdvance, type EmployeeAdvanceRepository } from "./advance.js";
import type { PayrollRun, PayrollRunRepository } from "./payroll-run.js";
import {
  disburseEmployeeAdvance,
  disbursePayrollRun,
  type TreasuryDisbursementPort,
} from "./hr-disbursement.js";
import { assertLeaveBalanceCovers, type LeaveBalance } from "./leave-balance.js";
import { TreasuryDisbursementHeldError, LeaveBalanceExceededError } from "./errors.js";

/**
 * This file drives REAL HR operations into the two errors in `errors.ts` that
 * a real caller can actually hit today. The other ~15 constructors
 * (DepartmentNotFoundError, JobTitleNotFoundError, EmployeeNotFoundError,
 * ContractNotFoundError, HolidayNotFoundError, LeaveRequestNotFoundError,
 * LeavePolicyNotFoundError, LeaveBalanceNotFoundError,
 * PayrollComponentNotFoundError, UserNotLinkedToEmployeeError,
 * AttendanceEntryNotFoundError, DuplicateAttendanceEntryError,
 * DuplicateLeavePolicyError, DuplicatePayrollComponentError) are either never
 * constructed anywhere in packages/ (dead — verified by grep), or are
 * constructed only in an HR API route file outside this file's territory
 * (packages/api/src/hr-time-leave-routes.ts, hr-payroll-routes.ts). Writing
 * `new XNotFoundError("id")` by hand here would just re-assert the
 * constructor's own body, which is the false-coverage pattern this pass is
 * told not to produce. HR is descoped for v1, so this is reported as
 * informational, not as a filed defect.
 */

function createInMemoryEmployeeAdvanceRepository(): EmployeeAdvanceRepository {
  const rows = new Map<string, EmployeeAdvance>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async listByEmployeeId(employeeId) {
      return [...rows.values()].filter((a) => a.employeeId === employeeId);
    },
    async create(advance) {
      rows.set(advance.id, advance);
    },
    async update(advance) {
      rows.set(advance.id, advance);
    },
  };
}

function createInMemoryPayrollRunRepository(seed: PayrollRun): PayrollRunRepository {
  const rows = new Map<string, PayrollRun>([[seed.id, seed]]);
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByPeriod(year, month, branchId) {
      return [...rows.values()].find((r) => r.year === year && r.month === month && r.branchId === branchId) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async create(run) {
      rows.set(run.id, run);
    },
    async update(run) {
      rows.set(run.id, run);
    },
  };
}

function heldTreasuryPort(voucherId: string): TreasuryDisbursementPort {
  return {
    async disburse() {
      throw new TreasuryDisbursementHeldError(voucherId);
    },
  };
}

function payrollRun(overrides: Partial<PayrollRun> = {}): PayrollRun {
  return {
    id: "run-1",
    number: "PR-000001",
    year: 2026,
    month: 1,
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    branchId: null,
    currency: "EGP",
    status: "approved",
    employeeCount: 1,
    totalGross: Money.fromMajor("5000.00"),
    totalDeductions: Money.fromMajor("500.00"),
    totalEmployerContributions: Money.zero(),
    totalNet: Money.fromMajor("4500.00"),
    unpaidLeaveSource: "none",
    warnings: [],
    journalEntryId: "PAYROLL-JE:run-1",
    disbursementVoucherId: null,
    calculatedAt: "2026-01-31T00:00:00.000Z",
    approvedAt: "2026-01-31T00:00:00.000Z",
    approvedBy: "user-1",
    disbursedAt: null,
    cancelledAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("TreasuryDisbursementHeldError — a configured TREASURY_VOUCHER_CONFIRM chain holds the voucher", () => {
  it("propagates out of disburseEmployeeAdvance carrying the held voucher's id, and never marks the advance disbursed", async () => {
    const repo = createInMemoryEmployeeAdvanceRepository();
    const requested = await requestEmployeeAdvance(
      { id: "adv-1", number: "ADV-000001", employeeId: "emp-1", amount: Money.fromMajor("900.00"), installmentCount: 3, firstDeductionDate: "2026-02-01" },
      repo,
    );
    const approved = approveEmployeeAdvance(requested, "user-1");
    await repo.update(approved);

    await expect(
      disburseEmployeeAdvance(
        "adv-1",
        { treasuryAccountId: "1010", branchId: "MAIN" },
        { advances: repo, treasury: heldTreasuryPort("CV-000042"), accounts: { employeeAdvanceAccountId: "1160" } },
      ),
    ).rejects.toMatchObject({ code: "TREASURY_DISBURSEMENT_HELD", voucherId: "CV-000042" });

    // Approving used to be unconditional in the sibling defect this same
    // module guards against (see LeaveBalanceExceededError below) — the
    // matching invariant here is that a HELD voucher must not silently mark
    // the advance disbursed. No cash moved, so the status must not move either.
    const stillApproved = await repo.findById("adv-1");
    expect(stillApproved?.status).toBe("approved");
    expect(stillApproved?.disbursementVoucherId).toBeNull();
  });

  it("propagates out of disbursePayrollRun the same way, leaving the run's status untouched", async () => {
    const run = payrollRun();
    const runs = createInMemoryPayrollRunRepository(run);

    await expect(
      disbursePayrollRun(
        "run-1",
        { treasuryAccountId: "1010", branchId: "MAIN" },
        { runs, treasury: heldTreasuryPort("CV-000099"), accounts: { salariesPayableAccountId: "2170" } },
      ),
    ).rejects.toMatchObject({ code: "TREASURY_DISBURSEMENT_HELD", voucherId: "CV-000099" });

    const stillApproved = await runs.findById("run-1");
    expect(stillApproved?.status).toBe("approved");
    expect(stillApproved?.disbursedAt).toBeNull();
  });
});

describe("LeaveBalanceExceededError — approving must not silently go negative", () => {
  const balance: Pick<LeaveBalance, "entitled" | "carriedOver" | "used"> = {
    entitled: Qty.fromMajor("21"),
    carriedOver: Qty.fromMajor("3"),
    used: Qty.fromMajor("18"),
  };
  // available = 21 + 3 - 18 = 6 days.

  it("carries the exact requested and available day counts a caller needs to explain the refusal", () => {
    try {
      assertLeaveBalanceCovers("annual", 10, balance);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LeaveBalanceExceededError);
      const typed = err as LeaveBalanceExceededError;
      expect(typed.requestedDays).toBe(10);
      expect(typed.availableDays).toBe(6);
    }
  });

  it("passes at the exact boundary — requesting exactly the available balance is allowed", () => {
    expect(() => assertLeaveBalanceCovers("annual", 6, balance)).not.toThrow();
  });

  it("a missing balance row counts as zero available, not as unlimited", () => {
    try {
      assertLeaveBalanceCovers("annual", 1, null);
      expect.unreachable();
    } catch (err) {
      expect((err as LeaveBalanceExceededError).availableDays).toBe(0);
    }
  });

  it("unpaid leave is exempt regardless of how far it exceeds the balance", () => {
    expect(() => assertLeaveBalanceCovers("unpaid", 100, balance)).not.toThrow();
    expect(() => assertLeaveBalanceCovers("unpaid", 100, null)).not.toThrow();
  });
});
