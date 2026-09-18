import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { requestEmployeeAdvance, approveEmployeeAdvance, type EmployeeAdvance, type EmployeeAdvanceRepository } from "./advance.js";
import type { PayrollRun, PayrollRunRepository } from "./payroll-run.js";
import {
  disburseEmployeeAdvance,
  disbursePayrollRun,
  type TreasuryDisbursementPort,
  type TreasuryDisbursementRequest,
  type TreasuryDisbursementResult,
} from "./hr-disbursement.js";
import {
  EmployeeAdvanceNotFoundError,
  InvalidEmployeeAdvanceError,
  InvalidPayrollRunError,
  InvalidPayrollRunTransitionError,
  PayrollRunNotFoundError,
  TreasuryDisbursementUnavailableError,
} from "./errors.js";

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

function createInMemoryPayrollRunRepository(): PayrollRunRepository {
  const rows = new Map<string, PayrollRun>();
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

function recordingTreasuryPort(result: Partial<TreasuryDisbursementResult> = {}): {
  port: TreasuryDisbursementPort;
  calls: TreasuryDisbursementRequest[];
} {
  const calls: TreasuryDisbursementRequest[] = [];
  return {
    calls,
    port: {
      async disburse(request) {
        calls.push(request);
        return { voucherId: "cv-1", voucherNo: "CV-000001", journalEntryId: "je-1", ...result };
      },
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
    overtimeSource: "none",
    statutoryTableCodes: [],
    totalEmployerCost: Money.zero(),
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

describe("disburseEmployeeAdvance", () => {
  async function approvedAdvance(): Promise<{ advance: EmployeeAdvance; repo: EmployeeAdvanceRepository }> {
    const repo = createInMemoryEmployeeAdvanceRepository();
    const requested = await requestEmployeeAdvance(
      { id: "adv-1", number: "ADV-000001", employeeId: "emp-1", amount: Money.fromMajor("900.00"), installmentCount: 3, firstDeductionDate: "2026-02-01" },
      repo,
    );
    const approved = approveEmployeeAdvance(requested, "user-1");
    await repo.update(approved);
    return { advance: approved, repo };
  }

  it("rejects an unknown advance", async () => {
    const repo = createInMemoryEmployeeAdvanceRepository();
    const { port } = recordingTreasuryPort();
    await expect(
      disburseEmployeeAdvance("missing", { treasuryAccountId: "1010", branchId: "MAIN" }, { advances: repo, treasury: port, accounts: { employeeAdvanceAccountId: "1160" } }),
    ).rejects.toThrow(EmployeeAdvanceNotFoundError);
  });

  it("rejects a missing treasury account or branch", async () => {
    const { advance, repo } = await approvedAdvance();
    const { port } = recordingTreasuryPort();
    await expect(
      disburseEmployeeAdvance(advance.id, { treasuryAccountId: "", branchId: "MAIN" }, { advances: repo, treasury: port, accounts: { employeeAdvanceAccountId: "1160" } }),
    ).rejects.toThrow(InvalidEmployeeAdvanceError);
    await expect(
      disburseEmployeeAdvance(advance.id, { treasuryAccountId: "1010", branchId: "" }, { advances: repo, treasury: port, accounts: { employeeAdvanceAccountId: "1160" } }),
    ).rejects.toThrow(InvalidEmployeeAdvanceError);
  });

  it("rejects when no treasury disbursement port is wired", async () => {
    const { advance, repo } = await approvedAdvance();
    await expect(
      disburseEmployeeAdvance(advance.id, { treasuryAccountId: "1010", branchId: "MAIN" }, { advances: repo, accounts: { employeeAdvanceAccountId: "1160" } }),
    ).rejects.toThrow(TreasuryDisbursementUnavailableError);
  });

  it("pays the advance out of treasury, debiting the employee-advance ASSET account, and flips the advance to disbursed", async () => {
    const { advance, repo } = await approvedAdvance();
    const { port, calls } = recordingTreasuryPort({ voucherId: "cv-9", journalEntryId: "je-9" });
    const disbursed = await disburseEmployeeAdvance(
      advance.id,
      { treasuryAccountId: "1010", branchId: "MAIN" },
      { advances: repo, treasury: port, accounts: { employeeAdvanceAccountId: "1160" }, now: () => "2026-01-15T00:00:00.000Z" },
    );

    expect(disbursed.status).toBe("disbursed");
    expect(disbursed.disbursementVoucherId).toBe("cv-9");
    expect(disbursed.disbursementJournalEntryId).toBe("je-9");
    expect(disbursed.disbursedAt).toBe("2026-01-15T00:00:00.000Z");
    expect(await repo.findById(advance.id)).toEqual(disbursed);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      counterpartyGlAccountId: "1160",
      treasuryAccountId: "1010",
      branchId: "MAIN",
      paymentMethod: "cash",
      referenceNo: advance.number,
    });
    expect(calls[0]!.amount.toString()).toBe("900.000000");
    expect(calls[0]!.memo).toContain(advance.number);
  });

  it("honours an explicit payment method and reference number", async () => {
    const { advance, repo } = await approvedAdvance();
    const { port, calls } = recordingTreasuryPort();
    await disburseEmployeeAdvance(
      advance.id,
      { treasuryAccountId: "1010", branchId: "MAIN", paymentMethod: "bank", referenceNo: "custom-ref" },
      { advances: repo, treasury: port, accounts: { employeeAdvanceAccountId: "1160" } },
    );
    expect(calls[0]!.paymentMethod).toBe("bank");
    expect(calls[0]!.referenceNo).toBe("custom-ref");
  });
});

describe("disbursePayrollRun", () => {
  it("rejects an unknown run", async () => {
    const runs = createInMemoryPayrollRunRepository();
    const { port } = recordingTreasuryPort();
    await expect(
      disbursePayrollRun("missing", { treasuryAccountId: "1010", branchId: "MAIN" }, { runs, treasury: port, accounts: { salariesPayableAccountId: "2170" } }),
    ).rejects.toThrow(PayrollRunNotFoundError);
  });

  it("rejects disbursing a run that has not been approved", async () => {
    const runs = createInMemoryPayrollRunRepository();
    await runs.create(payrollRun({ status: "calculated", approvedAt: null, approvedBy: null }));
    const { port } = recordingTreasuryPort();
    await expect(
      disbursePayrollRun("run-1", { treasuryAccountId: "1010", branchId: "MAIN" }, { runs, treasury: port, accounts: { salariesPayableAccountId: "2170" } }),
    ).rejects.toThrow(InvalidPayrollRunTransitionError);
  });

  it("rejects a missing treasury account or branch", async () => {
    const runs = createInMemoryPayrollRunRepository();
    await runs.create(payrollRun());
    const { port } = recordingTreasuryPort();
    await expect(
      disbursePayrollRun("run-1", { treasuryAccountId: "", branchId: "MAIN" }, { runs, treasury: port, accounts: { salariesPayableAccountId: "2170" } }),
    ).rejects.toThrow(InvalidPayrollRunError);
  });

  it("rejects disbursing a run with a zero net pay", async () => {
    const runs = createInMemoryPayrollRunRepository();
    await runs.create(payrollRun({ totalNet: Money.zero() }));
    const { port } = recordingTreasuryPort();
    await expect(
      disbursePayrollRun("run-1", { treasuryAccountId: "1010", branchId: "MAIN" }, { runs, treasury: port, accounts: { salariesPayableAccountId: "2170" } }),
    ).rejects.toThrow(InvalidPayrollRunError);
  });

  it("rejects when no treasury disbursement port is wired", async () => {
    const runs = createInMemoryPayrollRunRepository();
    await runs.create(payrollRun());
    await expect(
      disbursePayrollRun("run-1", { treasuryAccountId: "1010", branchId: "MAIN" }, { runs, accounts: { salariesPayableAccountId: "2170" } }),
    ).rejects.toThrow(TreasuryDisbursementUnavailableError);
  });

  it("settles the run's net pay out of treasury against رواتب مستحقة, and flips the run to disbursed", async () => {
    const runs = createInMemoryPayrollRunRepository();
    const run = payrollRun();
    await runs.create(run);
    const { port, calls } = recordingTreasuryPort({ voucherId: "cv-77" });

    const disbursed = await disbursePayrollRun(
      "run-1",
      { treasuryAccountId: "1010", branchId: "MAIN" },
      { runs, treasury: port, accounts: { salariesPayableAccountId: "2170" }, now: () => "2026-02-01T00:00:00.000Z" },
    );

    expect(disbursed.status).toBe("disbursed");
    expect(disbursed.disbursementVoucherId).toBe("cv-77");
    expect(disbursed.disbursedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(await runs.findById("run-1")).toEqual(disbursed);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      counterpartyGlAccountId: "2170",
      treasuryAccountId: "1010",
      branchId: "MAIN",
      paymentMethod: "bank",
      referenceNo: run.number,
      date: run.periodEnd,
    });
    expect(calls[0]!.amount.toString()).toBe(run.totalNet.toString());
  });
});
