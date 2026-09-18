import { describe, it, expect, beforeEach } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import type { JournalPostingDeps } from "../gl/index.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { requestEmployeeAdvance, approveEmployeeAdvance, markEmployeeAdvanceDisbursed, type EmployeeAdvance, type EmployeeAdvanceRepository } from "./advance.js";
import type { PayrollRun, PayrollRunRepository, Payslip, PayslipLine, PayslipRepository } from "./payroll-run.js";
import { PAYROLL_GL_ACCOUNTS } from "./payroll-run.js";
import { approvePayrollRun, type PostPayrollRunDeps } from "./post-payroll-run.js";
import { createGarnishment, type GarnishmentRecord, type GarnishmentRepository } from "./garnishment.js";
import {
  EmployeeAdvanceNotFoundError,
  GarnishmentNotFoundError,
  InvalidPayrollRunTransitionError,
  NoPayableEmployeesError,
  PayrollRunNotFoundError,
} from "./errors.js";

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
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

function createInMemoryPayslipRepository(): PayslipRepository {
  const rows = new Map<string, Payslip>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async listByRunId(runId) {
      return [...rows.values()].filter((p) => p.runId === runId);
    },
    async listByEmployeeId(employeeId) {
      return [...rows.values()].filter((p) => p.employeeId === employeeId);
    },
    async create(payslip) {
      rows.set(payslip.id, payslip);
    },
    async deleteByRunId(runId) {
      for (const [id, p] of rows) if (p.runId === runId) rows.delete(id);
    },
  };
}

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
    status: "calculated",
    employeeCount: 1,
    totalGross: Money.zero(),
    totalDeductions: Money.zero(),
    totalEmployerContributions: Money.zero(),
    totalNet: Money.zero(),
    unpaidLeaveSource: "none",
    overtimeSource: "none",
    statutoryTableCodes: [],
    totalEmployerCost: Money.zero(),
    warnings: [],
    journalEntryId: null,
    disbursementVoucherId: null,
    calculatedAt: "2026-01-31T00:00:00.000Z",
    approvedAt: null,
    approvedBy: null,
    disbursedAt: null,
    cancelledAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function line(overrides: Partial<PayslipLine> & Pick<PayslipLine, "kind" | "source" | "amount">): PayslipLine {
  return { id: `line-${Math.random()}`, nameAr: "بند", glAccountId: null, referenceId: null, capped: false, ...overrides };
}

function payslip(overrides: Partial<Payslip> & Pick<Payslip, "id" | "employeeId" | "lines" | "grossEarnings" | "totalDeductions" | "netPay">): Payslip {
  return {
    number: `PS-${overrides.id}`,
    runId: "run-1",
    contractId: "ctr-1",
    currency: "EGP",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    periodDays: 31,
    paidDays: 31,
    employerContributions: Money.zero(),
    insurableWage: Money.zero(),
    insurableWageCapped: false,
    annualTaxableIncome: Money.zero(),
    totalEmployerCost: Money.zero(),
    createdAt: "2026-01-31T00:00:00.000Z",
    ...overrides,
  };
}

interface Harness {
  deps: PostPayrollRunDeps;
  gl: JournalPostingDeps;
  ledger: InMemoryLedgerRepository;
  runs: PayrollRunRepository;
  payslips: PayslipRepository;
  advances: EmployeeAdvanceRepository;
}

async function harness(): Promise<Harness> {
  const ledger = new InMemoryLedgerRepository();
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();

  await accounts.create(account("5120", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("2170", { type: "liability", naturalBalance: "credit" }));
  await accounts.create(account("1160", { type: "asset", naturalBalance: "debit" }));
  await accounts.create(account("2190", { type: "liability", naturalBalance: "credit" }));
  await accounts.create(account("5130", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("5121", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("2193", { type: "liability", naturalBalance: "credit" }));
  await periods.create({ id: "fp-2026-01", year: 2026, periodNumber: 1, startDate: "2026-01-01", endDate: "2026-01-31", status: "open" });

  const gl: JournalPostingDeps = {
    ledger,
    accounts,
    periods,
    numbering: new NextNumberService(new InMemorySequenceStore()),
    now: () => "2026-01-31T10:00:00.000Z",
    actor: "u1",
  };

  const runs = createInMemoryPayrollRunRepository();
  const payslips = createInMemoryPayslipRepository();
  const advances = createInMemoryEmployeeAdvanceRepository();

  const deps: PostPayrollRunDeps = {
    runs,
    payslips,
    advances,
    gl,
    accounts: PAYROLL_GL_ACCOUNTS,
    now: () => "2026-01-31T12:00:00.000Z",
  };

  return { deps, gl, ledger, runs, payslips, advances };
}

describe("approvePayrollRun", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await harness();
  });

  it("rejects an unknown run", async () => {
    await expect(approvePayrollRun("missing", "user-1", h.deps)).rejects.toThrow(PayrollRunNotFoundError);
  });

  it("rejects a run in a status the state machine forbids (e.g. draft)", async () => {
    await h.runs.create(payrollRun({ status: "draft" }));
    await expect(approvePayrollRun("run-1", "user-1", h.deps)).rejects.toThrow(InvalidPayrollRunTransitionError);
  });

  it("rejects a calculated run with no payslips", async () => {
    await h.runs.create(payrollRun());
    await expect(approvePayrollRun("run-1", "user-1", h.deps)).rejects.toThrow(NoPayableEmployeesError);
  });

  it("posts ONE balanced entry: Dr salary expense, Cr salaries payable, for a single earning-only payslip", async () => {
    await h.runs.create(payrollRun());
    await h.payslips.create(
      payslip({
        id: "ps-1",
        employeeId: "emp-1",
        lines: [line({ kind: "earning", source: "contract_basic", amount: Money.fromMajor("3000.00") })],
        grossEarnings: Money.fromMajor("3000.00"),
        totalDeductions: Money.zero(),
        netPay: Money.fromMajor("3000.00"),
      }),
    );

    const approved = await approvePayrollRun("run-1", "user-1", h.deps);
    expect(approved.status).toBe("approved");
    expect(approved.journalEntryId).toBe("PAYROLL-JE:run-1");
    expect(approved.approvedAt).toBe("2026-01-31T12:00:00.000Z");
    expect(approved.approvedBy).toBe("user-1");

    const entry = await h.ledger.findById("PAYROLL-JE:run-1");
    expect(entry).not.toBeNull();
    expect(entry!.status).toBe("posted");
    expect(entry!.date).toBe(payrollRun().periodEnd);

    const totalDebit = entry!.lines.reduce((acc, l) => acc.add(l.debit), Money.zero());
    const totalCredit = entry!.lines.reduce((acc, l) => acc.add(l.credit), Money.zero());
    expect(totalDebit.equals(totalCredit)).toBe(true);
    expect(totalDebit.toString()).toBe("3000.000000");

    expect(entry!.lines).toHaveLength(2);
    expect(entry!.lines.find((l) => l.accountId === "5120")!.debit.toString()).toBe("3000.000000");
    expect(entry!.lines.find((l) => l.accountId === "2170")!.credit.toString()).toBe("3000.000000");
  });

  it("groups earnings/deductions/employer contributions across MULTIPLE payslips onto ONE balanced entry", async () => {
    await h.runs.create(payrollRun());
    await h.payslips.create(
      payslip({
        id: "ps-1",
        employeeId: "emp-1",
        lines: [
          line({ kind: "earning", source: "contract_basic", amount: Money.fromMajor("3000.00") }),
          line({ kind: "deduction", source: "contract_deduction", amount: Money.fromMajor("100.00") }),
          line({ kind: "employer_contribution", source: "contract_deduction", amount: Money.fromMajor("300.00") }),
        ],
        grossEarnings: Money.fromMajor("3000.00"),
        totalDeductions: Money.fromMajor("100.00"),
        employerContributions: Money.fromMajor("300.00"),
        netPay: Money.fromMajor("2900.00"),
      }),
    );
    await h.payslips.create(
      payslip({
        id: "ps-2",
        employeeId: "emp-2",
        lines: [line({ kind: "earning", source: "contract_basic", amount: Money.fromMajor("2000.00") })],
        grossEarnings: Money.fromMajor("2000.00"),
        totalDeductions: Money.zero(),
        netPay: Money.fromMajor("2000.00"),
      }),
    );

    await approvePayrollRun("run-1", "user-1", h.deps);
    const entry = await h.ledger.findById("PAYROLL-JE:run-1");

    const totalDebit = entry!.lines.reduce((acc, l) => acc.add(l.debit), Money.zero());
    const totalCredit = entry!.lines.reduce((acc, l) => acc.add(l.credit), Money.zero());
    expect(totalDebit.equals(totalCredit)).toBe(true);

    // Dr 5120 = 3000 + 2000 = 5000 (both payslips' basic earnings pooled)
    expect(entry!.lines.find((l) => l.accountId === "5120")!.debit.toString()).toBe("5000.000000");
    // Dr 5130 employer contribution expense
    expect(entry!.lines.find((l) => l.accountId === "5130")!.debit.toString()).toBe("300.000000");
    // Cr 2190 employer contribution liability
    expect(entry!.lines.find((l) => l.accountId === "2190")!.credit.toString()).toBe("400.000000"); // 100 deduction + 300 employer liability, same account
    // Cr 2170 salaries payable = 2900 + 2000 = 4900 (net pay pooled)
    expect(entry!.lines.find((l) => l.accountId === "2170")!.credit.toString()).toBe("4900.000000");
  });

  it("routes an earning line to its own GL account instead of the run's default when it carries one", async () => {
    await h.runs.create(payrollRun());
    await h.payslips.create(
      payslip({
        id: "ps-1",
        employeeId: "emp-1",
        lines: [
          line({ kind: "earning", source: "contract_basic", amount: Money.fromMajor("3000.00") }),
          line({ kind: "earning", source: "contract_allowance", amount: Money.fromMajor("200.00"), glAccountId: "5121" }),
        ],
        grossEarnings: Money.fromMajor("3200.00"),
        totalDeductions: Money.zero(),
        netPay: Money.fromMajor("3200.00"),
      }),
    );
    await approvePayrollRun("run-1", "user-1", h.deps);
    const entry = await h.ledger.findById("PAYROLL-JE:run-1");
    expect(entry!.lines.find((l) => l.accountId === "5120")!.debit.toString()).toBe("3000.000000");
    expect(entry!.lines.find((l) => l.accountId === "5121")!.debit.toString()).toBe("200.000000");
  });

  it("credits advance recovery to the employee-advance ASSET account specifically, not the general deduction liability", async () => {
    const advanceRepo = h.advances;
    const requested = await requestEmployeeAdvance(
      { id: "adv-1", number: "ADV-000001", employeeId: "emp-1", amount: Money.fromMajor("900.00"), installmentCount: 3, firstDeductionDate: "2026-01-01" },
      advanceRepo,
    );
    const approved = approveEmployeeAdvance(requested, "user-1");
    const disbursed = markEmployeeAdvanceDisbursed(approved, { voucherId: "cv-1", journalEntryId: null });
    await advanceRepo.update(disbursed);

    await h.runs.create(payrollRun());
    await h.payslips.create(
      payslip({
        id: "ps-1",
        employeeId: "emp-1",
        lines: [
          line({ kind: "earning", source: "contract_basic", amount: Money.fromMajor("3000.00") }),
          line({ kind: "deduction", source: "advance_recovery", amount: Money.fromMajor("300.00"), referenceId: "adv-1" }),
        ],
        grossEarnings: Money.fromMajor("3000.00"),
        totalDeductions: Money.fromMajor("300.00"),
        netPay: Money.fromMajor("2700.00"),
      }),
    );

    await approvePayrollRun("run-1", "user-1", h.deps);
    const entry = await h.ledger.findById("PAYROLL-JE:run-1");
    expect(entry!.lines.find((l) => l.accountId === "1160")!.credit.toString()).toBe("300.000000");
    expect(entry!.lines.find((l) => l.accountId === "2190")).toBeUndefined();

    const updatedAdvance = await advanceRepo.findById("adv-1");
    expect(updatedAdvance!.installments[0]!.recovered.toString()).toBe("300.000000");
    expect(updatedAdvance!.status).toBe("disbursed"); // 300 of 900 recovered, not yet repaid
  });

  it("aggregates advance-recovery lines for the SAME advance across multiple payslips before applying recovery once", async () => {
    const requested = await requestEmployeeAdvance(
      { id: "adv-1", number: "ADV-000001", employeeId: "emp-1", amount: Money.fromMajor("300.00"), installmentCount: 1, firstDeductionDate: "2026-01-01" },
      h.advances,
    );
    const approved = approveEmployeeAdvance(requested, "user-1");
    const disbursed = markEmployeeAdvanceDisbursed(approved, { voucherId: "cv-1", journalEntryId: null });
    await h.advances.update(disbursed);

    await h.runs.create(payrollRun());
    // Two payslips referencing the same advance (e.g. a correction split); recovery combines to exactly 300.00.
    await h.payslips.create(
      payslip({
        id: "ps-1",
        employeeId: "emp-1",
        lines: [
          line({ kind: "earning", source: "contract_basic", amount: Money.fromMajor("1000.00") }),
          line({ kind: "deduction", source: "advance_recovery", amount: Money.fromMajor("200.00"), referenceId: "adv-1" }),
        ],
        grossEarnings: Money.fromMajor("1000.00"),
        totalDeductions: Money.fromMajor("200.00"),
        netPay: Money.fromMajor("800.00"),
      }),
    );
    await h.payslips.create(
      payslip({
        id: "ps-2",
        employeeId: "emp-1",
        lines: [
          line({ kind: "earning", source: "contract_basic", amount: Money.fromMajor("500.00") }),
          line({ kind: "deduction", source: "advance_recovery", amount: Money.fromMajor("100.00"), referenceId: "adv-1" }),
        ],
        grossEarnings: Money.fromMajor("500.00"),
        totalDeductions: Money.fromMajor("100.00"),
        netPay: Money.fromMajor("400.00"),
      }),
    );

    await approvePayrollRun("run-1", "user-1", h.deps);
    const entry = await h.ledger.findById("PAYROLL-JE:run-1");
    // the two 200/100 recovery lines pool onto ONE 1160 credit of exactly 300.00.
    expect(entry!.lines.find((l) => l.accountId === "1160")!.credit.toString()).toBe("300.000000");

    const updatedAdvance = await h.advances.findById("adv-1");
    expect(updatedAdvance!.installments[0]!.recovered.toString()).toBe("300.000000");
    expect(updatedAdvance!.status).toBe("repaid");
  });

  it("flips the advance to repaid once the combined recovery reaches its full amount", async () => {
    const requested = await requestEmployeeAdvance(
      { id: "adv-1", number: "ADV-000001", employeeId: "emp-1", amount: Money.fromMajor("300.00"), installmentCount: 1, firstDeductionDate: "2026-01-01" },
      h.advances,
    );
    const approved = approveEmployeeAdvance(requested, "user-1");
    const disbursed = markEmployeeAdvanceDisbursed(approved, { voucherId: "cv-1", journalEntryId: null });
    await h.advances.update(disbursed);

    await h.runs.create(payrollRun());
    await h.payslips.create(
      payslip({
        id: "ps-1",
        employeeId: "emp-1",
        lines: [
          line({ kind: "earning", source: "contract_basic", amount: Money.fromMajor("1000.00") }),
          line({ kind: "deduction", source: "advance_recovery", amount: Money.fromMajor("300.00"), referenceId: "adv-1" }),
        ],
        grossEarnings: Money.fromMajor("1000.00"),
        totalDeductions: Money.fromMajor("300.00"),
        netPay: Money.fromMajor("700.00"),
      }),
    );

    await approvePayrollRun("run-1", "user-1", h.deps);
    const updatedAdvance = await h.advances.findById("adv-1");
    expect(updatedAdvance!.status).toBe("repaid");
    expect(updatedAdvance!.repaidAt).toBe("2026-01-31T12:00:00.000Z");
  });

  it("throws EmployeeAdvanceNotFoundError when a recovery line references an advance the repository no longer holds, AFTER the entry already posted", async () => {
    await h.runs.create(payrollRun());
    await h.payslips.create(
      payslip({
        id: "ps-1",
        employeeId: "emp-1",
        lines: [
          line({ kind: "earning", source: "contract_basic", amount: Money.fromMajor("1000.00") }),
          line({ kind: "deduction", source: "advance_recovery", amount: Money.fromMajor("300.00"), referenceId: "adv-ghost" }),
        ],
        grossEarnings: Money.fromMajor("1000.00"),
        totalDeductions: Money.fromMajor("300.00"),
        netPay: Money.fromMajor("700.00"),
      }),
    );

    await expect(approvePayrollRun("run-1", "user-1", h.deps)).rejects.toThrow(EmployeeAdvanceNotFoundError);
    // the journal entry was already posted before the advance lookup ran.
    const entry = await h.ledger.findById("PAYROLL-JE:run-1");
    expect(entry).not.toBeNull();
    expect(entry!.status).toBe("posted");
  });

  it("a deduction with no glAccountId falls back to the deduction-liability default account", async () => {
    await h.runs.create(payrollRun());
    await h.payslips.create(
      payslip({
        id: "ps-1",
        employeeId: "emp-1",
        lines: [
          line({ kind: "earning", source: "contract_basic", amount: Money.fromMajor("1000.00") }),
          line({ kind: "deduction", source: "contract_deduction", amount: Money.fromMajor("50.00") }),
        ],
        grossEarnings: Money.fromMajor("1000.00"),
        totalDeductions: Money.fromMajor("50.00"),
        netPay: Money.fromMajor("950.00"),
      }),
    );
    await approvePayrollRun("run-1", "user-1", h.deps);
    const entry = await h.ledger.findById("PAYROLL-JE:run-1");
    expect(entry!.lines.find((l) => l.accountId === "2190")!.credit.toString()).toBe("50.000000");
  });
});

describe("approvePayrollRun — garnishments and branch attribution", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await harness();
  });

  function register(): GarnishmentRepository & { rows: Map<string, GarnishmentRecord> } {
    const rows = new Map<string, GarnishmentRecord>();
    return {
      rows,
      async findById(id) {
        return rows.get(id) ?? null;
      },
      async list() {
        return [...rows.values()];
      },
      async listByEmployeeId(employeeId) {
        return [...rows.values()].filter((r) => r.employeeId === employeeId);
      },
      async create(record) {
        rows.set(record.id, record);
      },
      async update(record) {
        rows.set(record.id, record);
      },
    };
  }

  function garnishedSlip(id: string, employeeId: string, withheld: string, net: string): Payslip {
    return payslip({
      id,
      employeeId,
      lines: [
        line({ kind: "earning", source: "contract_basic", amount: Money.fromMajor("1000.00") }),
        line({ kind: "deduction", source: "garnishment", amount: Money.fromMajor(withheld), glAccountId: "2193", referenceId: "grn-1" }),
      ],
      grossEarnings: Money.fromMajor("1000.00"),
      totalDeductions: Money.fromMajor(withheld),
      netPay: Money.fromMajor(net),
    });
  }

  it("credits the garnishment to 2193 and counts the order down by what the run actually withheld, once", async () => {
    const orders = register();
    await orders.create(
      createGarnishment(
        {
          id: "grn-1",
          employeeId: "emp-1",
          kind: "court_order",
          reference: "1842/2026",
          labelAr: "حجز",
          totalAmount: Money.fromMajor("500.00"),
          monthlyAmount: Money.fromMajor("300.00"),
          currency: "EGP",
          startDate: "2026-01-01",
        },
        () => "2026-01-01T00:00:00.000Z",
      ),
    );
    await h.runs.create(payrollRun());
    await h.payslips.create(garnishedSlip("ps-1", "emp-1", "300.00", "700.00"));

    await approvePayrollRun("run-1", "user-1", { ...h.deps, garnishments: orders });

    const entry = await h.ledger.findById("PAYROLL-JE:run-1");
    expect(entry!.lines.find((l) => l.accountId === "2193")!.credit.toString()).toBe("300.000000");
    const order = orders.rows.get("grn-1")!;
    expect(order.outstanding.toString()).toBe("200.000000");
    expect(order.recovered.toString()).toBe("300.000000");
    expect(order.active).toBe(true);
  });

  it("D181: counts the order down by only what the run actually withheld when the statutory cap reduced it, so the shortfall carries forward", async () => {
    const orders = register();
    await orders.create(
      createGarnishment(
        {
          id: "grn-1",
          employeeId: "emp-1",
          kind: "court_order",
          reference: "1842/2026",
          labelAr: "حجز",
          totalAmount: Money.fromMajor("5000.00"),
          monthlyAmount: Money.fromMajor("500.00"),
          currency: "EGP",
          startDate: "2026-01-01",
        },
        () => "2026-01-01T00:00:00.000Z",
      ),
    );
    await h.runs.create(payrollRun());
    // The order's own instalment is 500.00, but the payroll engine capped
    // this period's withholding at 125.00 (calculate-payroll-run.test.ts
    // proves the cap itself) — the payslip records only what was withheld.
    await h.payslips.create(garnishedSlip("ps-1", "emp-1", "125.00", "875.00"));

    await approvePayrollRun("run-1", "user-1", { ...h.deps, garnishments: orders });

    const order = orders.rows.get("grn-1")!;
    expect(order.outstanding.toString()).toBe("4875.000000"); // 5000 - 125, NOT 5000 - 500
    expect(order.recovered.toString()).toBe("125.000000");
    expect(order.active).toBe(true); // still owed — the 375.00 shortfall carries to next month
  });

  it("refuses to approve when a payslip names an order the register does not hold, rather than posting a liability nobody owns", async () => {
    await h.runs.create(payrollRun());
    await h.payslips.create(garnishedSlip("ps-1", "emp-1", "300.00", "700.00"));
    await expect(approvePayrollRun("run-1", "user-1", { ...h.deps, garnishments: register() })).rejects.toThrow(GarnishmentNotFoundError);
  });

  it("stamps each line with the employee's branch when the run spans every branch (DEC-20), and still balances", async () => {
    await h.runs.create(payrollRun({ branchId: null }));
    const earningOnly = (id: string, employeeId: string, amount: string) =>
      payslip({
        id,
        employeeId,
        lines: [line({ kind: "earning", source: "contract_basic", amount: Money.fromMajor(amount) })],
        grossEarnings: Money.fromMajor(amount),
        totalDeductions: Money.zero(),
        netPay: Money.fromMajor(amount),
      });
    await h.payslips.create(earningOnly("ps-1", "emp-cairo", "3000.00"));
    await h.payslips.create(earningOnly("ps-2", "emp-alex", "2000.00"));
    await h.payslips.create(earningOnly("ps-3", "emp-unknown", "500.00"));
    const branches: Record<string, string> = { "emp-cairo": "CAIRO", "emp-alex": "ALEX" };
    const employees = {
      findById: async (id: string) => (branches[id] ? ({ id, branchId: branches[id] } as never) : null),
    };

    await approvePayrollRun("run-1", "user-1", { ...h.deps, employees });

    const entry = await h.ledger.findById("PAYROLL-JE:run-1");
    const expense = entry!.lines.filter((l) => l.accountId === "5120").map((l) => [l.branchId, l.debit.toString()]);
    expect(expense).toEqual([
      ["CAIRO", "3000.000000"],
      ["ALEX", "2000.000000"],
      [null, "500.000000"],
    ]);
    const debit = entry!.lines.reduce((acc, l) => acc.add(l.debit), Money.zero());
    const credit = entry!.lines.reduce((acc, l) => acc.add(l.credit), Money.zero());
    expect(debit.equals(credit)).toBe(true);
    for (const branch of ["CAIRO", "ALEX", null]) {
      const own = entry!.lines.filter((l) => l.branchId === branch);
      expect(own.reduce((a, l) => a.add(l.debit), Money.zero()).equals(own.reduce((a, l) => a.add(l.credit), Money.zero()))).toBe(true);
    }
  });

  it("uses the run's own branch for every line when the run is scoped to one branch", async () => {
    await h.runs.create(payrollRun({ branchId: "CAIRO" }));
    await h.payslips.create(garnishedSlip("ps-1", "emp-1", "300.00", "700.00"));
    await approvePayrollRun("run-1", "user-1", h.deps);
    const entry = await h.ledger.findById("PAYROLL-JE:run-1");
    expect(entry!.lines.every((l) => l.branchId === "CAIRO")).toBe(true);
  });
});
