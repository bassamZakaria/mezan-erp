import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { createEmployeeDirectory } from "./employee.js";
import { createInMemoryEmployeeRepository, createInMemoryContractRepository } from "./test-helpers/in-memory-hr-repositories.js";
import { createEmployee } from "./create-employee.js";
import { createContract } from "./create-contract.js";
import {
  requestEmployeeAdvance,
  approveEmployeeAdvance,
  markEmployeeAdvanceDisbursed,
  applyAdvanceRecovery,
  type EmployeeAdvance,
  type EmployeeAdvanceRepository,
} from "./advance.js";
import type { PayrollComponentRepository } from "./payroll-component.js";
import { createPayrollComponent } from "./payroll-component.js";
import { payrollDayDivisor, type Garnishment, type GarnishmentProvider, type PayrollRun, type PayrollRunRepository, type Payslip, type PayslipRepository, type UnpaidLeaveDaysProvider } from "./payroll-run.js";
import { createPayrollRun, calculatePayrollRun, cancelPayrollRun, type PayrollCalculationDeps, type PayrollNumbering } from "./calculate-payroll-run.js";
import {
  DuplicatePayrollPeriodError,
  InvalidPayrollRunError,
  InvalidPayrollRunTransitionError,
  NoPayableEmployeesError,
  PayrollRunNotFoundError,
  StatutoryRulesUnavailableError,
} from "./errors.js";
import type { AttendanceEntry, AttendanceRepository } from "./attendance.js";
import { createOvertimeHoursProvider } from "./attendance-overtime.js";
import { EGYPT_OVERTIME_TABLES, resolveOvertimeTable, type OvertimeTable } from "./egypt-statutory.js";

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

function fakeNumbering(): PayrollNumbering {
  let n = 0;
  return {
    async next(code) {
      n += 1;
      return { formatted: `${code}-${String(n).padStart(6, "0")}` };
    },
  };
}

async function harness(): Promise<{
  runs: PayrollRunRepository;
  payslips: PayslipRepository;
  employeeRepo: ReturnType<typeof createInMemoryEmployeeRepository>;
  contracts: ReturnType<typeof createInMemoryContractRepository>;
  advances: EmployeeAdvanceRepository;
  numbering: PayrollNumbering;
  deps: PayrollCalculationDeps;
}> {
  const runs = createInMemoryPayrollRunRepository();
  const payslips = createInMemoryPayslipRepository();
  const employeeRepo = createInMemoryEmployeeRepository();
  const contracts = createInMemoryContractRepository();
  const advances = createInMemoryEmployeeAdvanceRepository();
  const numbering = fakeNumbering();
  const employees = createEmployeeDirectory(employeeRepo);
  const deps: PayrollCalculationDeps = {
    runs,
    payslips,
    employees,
    contracts,
    advances,
    numbering,
    now: () => "2026-02-01T00:00:00.000Z",
  };
  return { runs, payslips, employeeRepo, contracts, advances, numbering, deps };
}

async function employeeWithContract(
  h: Awaited<ReturnType<typeof harness>>,
  opts: {
    id: string;
    hireDate?: string;
    branchId?: string;
    monthlySalary: string;
    allowances?: { name: string; amount: string; componentId?: string | null }[];
    deductions?: { name: string; amount: string; componentId?: string | null }[];
    contractStart?: string;
    contractEnd?: string | null;
    currency?: string;
    payBasis?: "monthly" | "hourly" | "daily";
    payFrequency?: "monthly" | "biweekly" | "weekly";
  },
) {
  const emp = await createEmployee(
    { id: opts.id, code: opts.id.toUpperCase(), firstName: "F", lastName: opts.id, branchId: opts.branchId ?? "MAIN", hireDate: opts.hireDate ?? "2020-01-01" },
    h.employeeRepo,
  );
  const contract = await createContract(
    {
      id: `ctr-${opts.id}`,
      number: `CTR-${opts.id}`,
      employeeId: opts.id,
      startDate: opts.contractStart ?? "2020-01-01",
      endDate: opts.contractEnd ?? null,
      type: opts.contractEnd !== undefined ? "fixed_term" : "indefinite",
      monthlySalary: Money.fromMajor(opts.monthlySalary),
      currency: opts.currency ?? "EGP",
      payBasis: opts.payBasis ?? "monthly",
      payFrequency: opts.payFrequency ?? "monthly",
      allowances: (opts.allowances ?? []).map((a, i) => ({ id: `${opts.id}-al-${i}`, name: a.name, amount: Money.fromMajor(a.amount), componentId: a.componentId ?? null })),
      deductions: (opts.deductions ?? []).map((d, i) => ({ id: `${opts.id}-de-${i}`, name: d.name, amount: Money.fromMajor(d.amount), componentId: d.componentId ?? null })),
    },
    h.contracts,
  );
  return { emp, contract };
}

describe("createPayrollRun", () => {
  it("rejects an invalid year or month", async () => {
    const h = await harness();
    await expect(createPayrollRun({ id: "r1", year: 1800, month: 1 }, h.deps)).rejects.toThrow(InvalidPayrollRunError);
    await expect(createPayrollRun({ id: "r1", year: 2026, month: 0 }, h.deps)).rejects.toThrow(InvalidPayrollRunError);
    await expect(createPayrollRun({ id: "r1", year: 2026, month: 13 }, h.deps)).rejects.toThrow(InvalidPayrollRunError);
  });

  it("opens a draft run with zero totals and the month's period bounds", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1, now: () => "2026-01-01T00:00:00.000Z" }, h.deps);
    expect(run.status).toBe("draft");
    expect(run.periodStart).toBe("2026-01-01");
    expect(run.periodEnd).toBe("2026-01-31");
    expect(run.totalGross.scaled).toBe(0n);
    expect(run.totalNet.scaled).toBe(0n);
    expect(run.number).toBe("PAYROLL_RUN-000001");
  });

  it("rejects a second live run for the same period + branch scope", async () => {
    const h = await harness();
    await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await expect(createPayrollRun({ id: "r2", year: 2026, month: 1 }, h.deps)).rejects.toThrow(DuplicatePayrollPeriodError);
  });

  it("allows a new run once the earlier one for the period is cancelled", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await cancelPayrollRun(run.id, h.deps);
    await expect(createPayrollRun({ id: "r2", year: 2026, month: 1 }, h.deps)).resolves.toBeTruthy();
  });

  it("allows two runs in the same period scoped to different branches", async () => {
    const h = await harness();
    await createPayrollRun({ id: "r1", year: 2026, month: 1, branchId: "MAIN" }, h.deps);
    await expect(createPayrollRun({ id: "r2", year: 2026, month: 1, branchId: "OTHER" }, h.deps)).resolves.toBeTruthy();
  });
});

describe("calculatePayrollRun", () => {
  it("rejects an unknown run", async () => {
    const h = await harness();
    await expect(calculatePayrollRun("missing", h.deps)).rejects.toThrow(PayrollRunNotFoundError);
  });

  it("rejects calculating a run in a status the state machine forbids (e.g. approved)", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await h.runs.update({ ...run, status: "approved" });
    await expect(calculatePayrollRun(run.id, h.deps)).rejects.toThrow(InvalidPayrollRunTransitionError);
  });

  it("throws NoPayableEmployeesError, with warnings, when nothing is payable", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await expect(calculatePayrollRun(run.id, h.deps)).rejects.toThrow(NoPayableEmployeesError);
  });

  it("excludes an employee with no active contract overlapping the period, with a warning", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await createEmployee({ id: "emp-1", code: "EMP-1", firstName: "F", lastName: "L", branchId: "MAIN", hireDate: "2020-01-01" }, h.employeeRepo);
    await expect(calculatePayrollRun(run.id, h.deps)).rejects.toThrow(NoPayableEmployeesError);
  });

  it("excludes a non-monthly pay basis, with a warning", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3000.00", payBasis: "daily" });
    await expect(calculatePayrollRun(run.id, h.deps)).rejects.toThrow(NoPayableEmployeesError);
  });

  it("excludes a contract whose currency differs from the run's currency, with a warning", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3000.00", currency: "USD" });
    await expect(calculatePayrollRun(run.id, h.deps)).rejects.toThrow(NoPayableEmployeesError);
  });

  it("still pays a non-monthly pay frequency, computing a full month's salary and recording a warning", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3000.00", payFrequency: "weekly" });
    const calculated = await calculatePayrollRun(run.id, h.deps);
    expect(calculated.employeeCount).toBe(1);
    expect(calculated.totalGross.toString()).toBe("3000.000000");
    expect(calculated.warnings.some((w) => w.includes("تكرار الدفع"))).toBe(true);
  });

  it("pays the full month for an employee whose contract covers it entirely", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "6000.00" });
    const calculated = await calculatePayrollRun(run.id, h.deps);
    const payslips = await h.payslips.listByRunId(run.id);
    expect(payslips).toHaveLength(1);
    expect(payslips[0]!.grossEarnings.toString()).toBe("6000.000000");
    expect(payslips[0]!.paidDays).toBe(31);
    expect(payslips[0]!.periodDays).toBe(31);
    expect(payslips[0]!.netPay.toString()).toBe("6000.000000");
    expect(calculated.warnings.some((w) => w.includes("بالتناسب"))).toBe(false);
  });

  it("prorates a mid-month hire EXACTLY via largest-remainder allocation, on the FIXED_30 default divisor (D185)", async () => {
    const h = await harness();
    // January has 31 days; hired 2026-01-22 => paid 10 of 31 CALENDAR days —
    // but D185 puts the WAGE proration on the tenant's day-divisor setting
    // (FIXED_30 by default, unset here), the same basis unpaid leave already
    // uses, so the rate is amount/30 for the 10 days actually worked, not
    // amount/31.
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, {
      id: "emp-1",
      hireDate: "2026-01-22",
      contractStart: "2026-01-22",
      monthlySalary: "1000.00",
      allowances: [{ name: "بدل مواصلات", amount: "310.00" }],
    });

    const calculated = await calculatePayrollRun(run.id, h.deps);
    const [payslip] = await h.payslips.listByRunId(run.id);

    // allocate(1000.00, [10, 20]): total scaled 1_000_000_000; numerator0 = 10_000_000_000,
    // base0 = 333_333_333 rem 10; numerator1 = 20_000_000_000, base1 = 666_666_666 rem 20 ->
    // the single leftover unit goes to the higher remainder (index 1, the UNPAID portion),
    // so the PAID (index 0) share is exactly 333.333333.
    const basicLine = payslip!.lines.find((l) => l.source === "contract_basic")!;
    expect(basicLine.amount.toString()).toBe("333.333333");

    // allocate(310.00, [10, 20]): same remainder shape, base0 = 103_333_333.
    const allowanceLine = payslip!.lines.find((l) => l.source === "contract_allowance")!;
    expect(allowanceLine.amount.toString()).toBe("103.333333");

    expect(payslip!.paidDays).toBe(10);
    expect(payslip!.grossEarnings.toString()).toBe("436.666666");
    expect(calculated.warnings.some((w) => w.includes("احتُسب 10 من 31 يوماً بالتناسب"))).toBe(true);
  });

  it("D185: a mid-month joiner is prorated by CALENDAR days when the tenant's divisor setting is CALENDAR_DAYS", async () => {
    const h = await harness();
    // Same hire as above, but on CALENDAR_DAYS — today's pre-D185 behaviour,
    // unchanged: the rate is amount/31 for the 10 days actually worked.
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, {
      id: "emp-1",
      hireDate: "2026-01-22",
      contractStart: "2026-01-22",
      monthlySalary: "1000.00",
      allowances: [{ name: "بدل مواصلات", amount: "310.00" }],
    });

    await calculatePayrollRun(run.id, { ...h.deps, dayDivisorBasis: "CALENDAR_DAYS" });
    const [payslip] = await h.payslips.listByRunId(run.id);

    // allocate(1000.00, [10, 21]): base0 = 322_580_645 rem 5, base1 = 677_419_354 rem 26 ->
    // the leftover unit goes to index 1, so the PAID share is exactly 322.580645.
    const basicLine = payslip!.lines.find((l) => l.source === "contract_basic")!;
    expect(basicLine.amount.toString()).toBe("322.580645");
    const allowanceLine = payslip!.lines.find((l) => l.source === "contract_allowance")!;
    expect(allowanceLine.amount.toString()).toBe("100.000000");
    expect(payslip!.grossEarnings.toString()).toBe("422.580645");
  });

  it("does NOT prorate fixed deduction lines — they apply at their full contract amount", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, {
      id: "emp-1",
      hireDate: "2026-01-22",
      contractStart: "2026-01-22",
      monthlySalary: "1000.00",
      deductions: [{ name: "تأمينات", amount: "50.00" }],
    });
    await calculatePayrollRun(run.id, h.deps);
    const [payslip] = await h.payslips.listByRunId(run.id);
    const deductionLine = payslip!.lines.find((l) => l.source === "contract_deduction")!;
    expect(deductionLine.amount.toString()).toBe("50.000000");
  });

  it("excludes an employee whose contract covers the period but who was hired after it ends (zero paid days), with a warning", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    // contract starts well before the period (so it IS picked as the active contract),
    // but the employee's own hireDate falls after the period ends -> paidDays === 0.
    await employeeWithContract(h, { id: "emp-1", hireDate: "2026-06-01", monthlySalary: "1000.00" });
    await expect(calculatePayrollRun(run.id, h.deps)).rejects.toThrow(NoPayableEmployeesError);
  });

  it("excludes the one employee whose deductions exceed their dues, naming them, and pays everyone else", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "1000.00", deductions: [{ name: "خصم كبير", amount: "1000.01" }] });
    await employeeWithContract(h, { id: "emp-2", monthlySalary: "1000.00" });
    const calculated = await calculatePayrollRun(run.id, h.deps);
    const payslips = await h.payslips.listByRunId(run.id);
    expect(payslips.map((p) => p.employeeId)).toEqual(["emp-2"]);
    expect(calculated.employeeCount).toBe(1);
    expect(calculated.warnings.some((w) => w.includes("تتجاوز المستحقات") && w.includes("تم استبعاده"))).toBe(true);
  });

  it("refuses the run outright when the exclusion leaves nobody to pay, rather than calculating an empty one", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "1000.00", deductions: [{ name: "خصم كبير", amount: "1000.01" }] });
    await expect(calculatePayrollRun(run.id, h.deps)).rejects.toThrow(NoPayableEmployeesError);
  });

  it("accepts deductions exactly equal to gross earnings (net pay of exactly zero, boundary)", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "1000.00", deductions: [{ name: "خصم كامل", amount: "1000.00" }] });
    const calculated = await calculatePayrollRun(run.id, h.deps);
    const [payslip] = await h.payslips.listByRunId(run.id);
    expect(payslip!.netPay.scaled).toBe(0n);
    expect(calculated.totalNet.scaled).toBe(0n);
  });

  it("routes an allowance/deduction to its payroll component's GL account when bound", async () => {
    const h = await harness();
    const components: PayrollComponentRepository = {
      async findById() {
        return null;
      },
      async findByCode() {
        return null;
      },
      async list() {
        return [createPayrollComponent({ id: "pc-transport", code: "TRANSPORT", nameAr: "بدل مواصلات", kind: "earning", glAccountId: "5121" })];
      },
      async create() {},
      async update() {},
    };
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, {
      id: "emp-1",
      monthlySalary: "1000.00",
      allowances: [{ name: "بدل مواصلات", amount: "200.00", componentId: "pc-transport" }],
    });
    await calculatePayrollRun(run.id, { ...h.deps, payrollComponents: components });
    const [payslip] = await h.payslips.listByRunId(run.id);
    const allowanceLine = payslip!.lines.find((l) => l.source === "contract_allowance")!;
    expect(allowanceLine.glAccountId).toBe("5121");
  });

  it("without an unpaid-leave provider bound, deducts nothing and records unpaidLeaveSource 'none' with a warning", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3100.00" });
    const calculated = await calculatePayrollRun(run.id, h.deps);
    expect(calculated.unpaidLeaveSource).toBe("none");
    expect(calculated.warnings.some((w) => w.includes("لم يُربط مصدر أيام الإجازات"))).toBe(true);
    const [payslip] = await h.payslips.listByRunId(run.id);
    expect(payslip!.lines.some((l) => l.source === "unpaid_leave")).toBe(false);
  });

  it("with an unpaid-leave provider and the CALENDAR_DAYS divisor, deducts the month's real day rate for the reported day count", async () => {
    const h = await harness();
    const unpaidLeave: UnpaidLeaveDaysProvider = { async unpaidDaysFor() { return 3; } };
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    // 31-day month, full-month contract: gross 3100.00, so allocate(3100, [3, 28]).
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3100.00" });
    const calculated = await calculatePayrollRun(run.id, { ...h.deps, unpaidLeave, dayDivisorBasis: "CALENDAR_DAYS" });
    expect(calculated.unpaidLeaveSource).toBe("provider");
    const [payslip] = await h.payslips.listByRunId(run.id);
    const unpaidLine = payslip!.lines.find((l) => l.source === "unpaid_leave")!;
    expect(unpaidLine.nameAr).toBe("إجازة بدون أجر (3 يوم)");
    // 3100.00 / 31 * 3 = 300.000000 exactly.
    expect(unpaidLine.amount.toString()).toBe("300.000000");
  });

  it("clamps a reported unpaid-leave day count to the employee's paid days (never over-deducts)", async () => {
    const h = await harness();
    const unpaidLeave: UnpaidLeaveDaysProvider = { async unpaidDaysFor() { return 999; } };
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3100.00" });
    await calculatePayrollRun(run.id, { ...h.deps, unpaidLeave });
    const [payslip] = await h.payslips.listByRunId(run.id);
    const unpaidLine = payslip!.lines.find((l) => l.source === "unpaid_leave")!;
    // clamped to 31 paid days -> the whole gross is deducted.
    expect(unpaidLine.amount.toString()).toBe(payslip!.grossEarnings.toString());
  });

  it("adds no unpaid-leave line when the reported day count rounds to zero", async () => {
    const h = await harness();
    const unpaidLeave: UnpaidLeaveDaysProvider = { async unpaidDaysFor() { return 0.4; } };
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3100.00" });
    await calculatePayrollRun(run.id, { ...h.deps, unpaidLeave });
    const [payslip] = await h.payslips.listByRunId(run.id);
    expect(payslip!.lines.some((l) => l.source === "unpaid_leave")).toBe(false);
  });

  async function disbursedAdvance(h: Awaited<ReturnType<typeof harness>>, opts: { id: string; employeeId: string; number: string; amount: string; count: number; firstDeductionDate: string; currency?: string }) {
    const requested = await requestEmployeeAdvance(
      { id: opts.id, number: opts.number, employeeId: opts.employeeId, amount: Money.fromMajor(opts.amount), installmentCount: opts.count, firstDeductionDate: opts.firstDeductionDate, currency: opts.currency },
      h.advances,
    );
    const approved = approveEmployeeAdvance(requested, "user-1");
    const disbursed = markEmployeeAdvanceDisbursed(approved, { voucherId: "cv-1", journalEntryId: null });
    await h.advances.update(disbursed);
    return disbursed;
  }

  it("recovers a disbursed advance instalment due in the period, exactly", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3000.00" });
    await disbursedAdvance(h, { id: "adv-1", employeeId: "emp-1", number: "ADV-000001", amount: "900.00", count: 3, firstDeductionDate: "2026-01-01" });

    await calculatePayrollRun(run.id, h.deps);
    const [payslip] = await h.payslips.listByRunId(run.id);
    const recoveryLine = payslip!.lines.find((l) => l.source === "advance_recovery")!;
    expect(recoveryLine.amount.toString()).toBe("300.000000");
    expect(recoveryLine.referenceId).toBe("adv-1");
    expect(payslip!.netPay.scaled).toBe(payslip!.grossEarnings.scaled - payslip!.totalDeductions.scaled);
  });

  it("skips an advance in a different currency from the run, with a warning", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3000.00" });
    await disbursedAdvance(h, { id: "adv-1", employeeId: "emp-1", number: "ADV-000001", amount: "900.00", count: 3, firstDeductionDate: "2026-01-01", currency: "USD" });

    const calculated = await calculatePayrollRun(run.id, h.deps);
    const [payslip] = await h.payslips.listByRunId(run.id);
    expect(payslip!.lines.some((l) => l.source === "advance_recovery")).toBe(false);
    expect(calculated.warnings.some((w) => w.includes("ADV-000001"))).toBe(true);
  });

  it("recovers advances oldest-number first and stops once net pay is exhausted, warning about the partial one", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    // D183 caps total advance recovery at 10% of gross (900.00 here) — a
    // large contract deduction narrows net pay down to 400.00 before the
    // advances are considered, so net pay (not the statutory cap) is still
    // what cannot cover both full instalments.
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "9000.00", deductions: [{ name: "قسط قرض", amount: "8600.00" }] });
    await disbursedAdvance(h, { id: "adv-1", employeeId: "emp-1", number: "ADV-000001", amount: "900.00", count: 3, firstDeductionDate: "2026-01-01" }); // instalment due = 300.00
    await disbursedAdvance(h, { id: "adv-2", employeeId: "emp-1", number: "ADV-000002", amount: "600.00", count: 1, firstDeductionDate: "2026-01-01" }); // instalment due = 600.00

    const calculated = await calculatePayrollRun(run.id, h.deps);
    const [payslip] = await h.payslips.listByRunId(run.id);
    const recoveryLines = payslip!.lines.filter((l) => l.source === "advance_recovery");
    expect(recoveryLines).toHaveLength(2);
    expect(recoveryLines[0]!.referenceId).toBe("adv-1"); // oldest number recovered first
    expect(recoveryLines[0]!.amount.toString()).toBe("300.000000"); // full instalment
    expect(recoveryLines[0]!.capped).toBe(false);
    expect(recoveryLines[1]!.referenceId).toBe("adv-2");
    expect(recoveryLines[1]!.amount.toString()).toBe("100.000000"); // whatever net remains
    expect(recoveryLines[1]!.capped).toBe(false); // net pay limited it, not the D183 10% cap
    expect(payslip!.netPay.scaled).toBe(0n);
    expect(calculated.warnings.some((w) => w.includes("ADV-000002") && w.includes("جزئياً"))).toBe(true);
  });

  it("gross - deductions = net EXACTLY for every payslip, and the run totals reconcile the same way", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, {
      id: "emp-1",
      monthlySalary: "3000.00",
      allowances: [{ name: "بدل", amount: "150.00" }],
      deductions: [{ name: "خصم", amount: "75.00" }],
    });
    await employeeWithContract(h, { id: "emp-2", monthlySalary: "5250.00" });

    const calculated = await calculatePayrollRun(run.id, h.deps);
    const payslips = await h.payslips.listByRunId(run.id);
    expect(payslips).toHaveLength(2);
    for (const p of payslips) {
      expect(p.netPay.scaled).toBe(p.grossEarnings.scaled - p.totalDeductions.scaled);
    }
    const sumGross = payslips.reduce((acc, p) => acc + p.grossEarnings.scaled, 0n);
    const sumDeductions = payslips.reduce((acc, p) => acc + p.totalDeductions.scaled, 0n);
    const sumNet = payslips.reduce((acc, p) => acc + p.netPay.scaled, 0n);
    expect(calculated.totalGross.scaled).toBe(sumGross);
    expect(calculated.totalDeductions.scaled).toBe(sumDeductions);
    expect(calculated.totalNet.scaled).toBe(sumNet);
    expect(calculated.totalNet.scaled).toBe(calculated.totalGross.scaled - calculated.totalDeductions.scaled);
  });

  it("recalculating a run replaces its payslips wholesale (delete then recreate)", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "1000.00" });
    const first = await calculatePayrollRun(run.id, h.deps);
    const firstPayslips = await h.payslips.listByRunId(run.id);

    const second = await calculatePayrollRun(run.id, h.deps);
    const secondPayslips = await h.payslips.listByRunId(run.id);

    expect(secondPayslips).toHaveLength(1);
    expect(secondPayslips[0]!.id).not.toBe(firstPayslips[0]!.id);
    expect(second.employeeCount).toBe(first.employeeCount);
  });

  it("scopes to a run's branch, excluding employees in other branches", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1, branchId: "MAIN" }, h.deps);
    await employeeWithContract(h, { id: "emp-1", branchId: "MAIN", monthlySalary: "1000.00" });
    await employeeWithContract(h, { id: "emp-2", branchId: "OTHER", monthlySalary: "1000.00" });
    const calculated = await calculatePayrollRun(run.id, h.deps);
    expect(calculated.employeeCount).toBe(1);
  });
});

describe("cancelPayrollRun", () => {
  it("rejects an unknown run", async () => {
    const h = await harness();
    await expect(cancelPayrollRun("missing", h.deps)).rejects.toThrow(PayrollRunNotFoundError);
  });

  it("rejects cancelling a run the state machine forbids (e.g. disbursed)", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await h.runs.update({ ...run, status: "disbursed" });
    await expect(cancelPayrollRun(run.id, h.deps)).rejects.toThrow(InvalidPayrollRunTransitionError);
  });

  it("cancels a draft run, zeroing totals and deleting its payslips", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "1000.00" });
    await calculatePayrollRun(run.id, h.deps);
    expect(await h.payslips.listByRunId(run.id)).toHaveLength(1);

    const cancelled = await cancelPayrollRun(run.id, h.deps);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.employeeCount).toBe(0);
    expect(cancelled.totalGross.scaled).toBe(0n);
    expect(cancelled.totalNet.scaled).toBe(0n);
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(await h.payslips.listByRunId(run.id)).toHaveLength(0);
  });
});

describe("calculatePayrollRun — garnishments ahead of advances", () => {
  async function advance(h: Awaited<ReturnType<typeof harness>>, id: string, number: string, amount: string, count: number) {
    const requested = await requestEmployeeAdvance(
      { id, number, employeeId: "emp-1", amount: Money.fromMajor(amount), installmentCount: count, firstDeductionDate: "2026-01-01" },
      h.advances,
    );
    const disbursed = markEmployeeAdvanceDisbursed(approveEmployeeAdvance(requested, "user-1"), { voucherId: "cv-1", journalEntryId: null });
    await h.advances.update(disbursed);
  }

  function order(overrides: Partial<Garnishment> = {}): Garnishment {
    return {
      id: "grn-1",
      employeeId: "emp-1",
      reference: "1842/2026",
      labelAr: "حجز تنفيذي",
      monthlyAmount: Money.fromMajor("300.00"),
      currency: "EGP",
      startDate: "2026-01-01",
      endDate: null,
      outstanding: Money.fromMajor("3000.00"),
      active: true,
      ...overrides,
    };
  }

  function provider(orders: readonly Garnishment[]): GarnishmentProvider {
    return { listActiveFor: async (employeeId) => orders.filter((o) => o.employeeId === employeeId) };
  }

  it("takes the court order (within its 25% cap) before the employer's advance, and the advance carries the shortfall when net will not stretch", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    // 50,000.00 wage: 25% garnishment ceiling is 12,500.00 (comfortably above
    // the order's own 300.00 instalment) and the D183 10% advance-recovery
    // ceiling is 5,000.00 (comfortably above what net pay actually leaves) —
    // neither statutory cap binds here. A large contract deduction narrows
    // net pay down to 1,700.00 BEFORE the advance is even considered, so this
    // test still isolates ORDERING + NET-PAY exhaustion, not either cap (see
    // the "D181" describe block below for the garnishment cap, and the
    // "D183" describe block for the advance-recovery cap).
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "50000.00", deductions: [{ name: "قسط قرض", amount: "48000.00" }] });
    await advance(h, "adv-1", "ADV-000001", "5000.00", 1); // one instalment due in full: 5,000.00

    const calculated = await calculatePayrollRun(run.id, { ...h.deps, garnishments: provider([order()]) });
    const [payslip] = await h.payslips.listByRunId(run.id);
    const sources = payslip!.lines.filter((l) => l.kind === "deduction").map((l) => l.source);
    expect(sources).toEqual(["garnishment", "contract_deduction", "advance_recovery"]);

    const garnishment = payslip!.lines.find((l) => l.source === "garnishment")!;
    expect(garnishment.amount.toString()).toBe("300.000000");
    expect(garnishment.referenceId).toBe("grn-1");
    expect(garnishment.glAccountId).toBe("2193");
    expect(garnishment.capped).toBe(false);

    const recovery = payslip!.lines.find((l) => l.source === "advance_recovery")!;
    expect(recovery.amount.toString()).toBe("1700.000000"); // 50000 - 300 - 48000, all of what is left
    expect(recovery.capped).toBe(false); // net pay limited it, not the D183 10% cap
    expect(payslip!.netPay.scaled).toBe(0n);
    expect(calculated.warnings.some((w) => w.includes("ADV-000001") && w.includes("جزئياً"))).toBe(true);
  });

  it("D181: caps a single order at 25% of the wage even when its own instalment and outstanding balance are both far larger", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "250.00" }); // 25% ceiling = 62.50

    const calculated = await calculatePayrollRun(run.id, { ...h.deps, garnishments: provider([order()]) }); // instalment 300.00, outstanding 3000.00
    const [payslip] = await h.payslips.listByRunId(run.id);
    const garnishment = payslip!.lines.find((l) => l.source === "garnishment")!;
    expect(garnishment.amount.toString()).toBe("62.500000");
    expect(garnishment.capped).toBe(true);
    expect(payslip!.netPay.toString()).toBe("187.500000");
    expect(calculated.warnings.some((w) => w.includes("1842/2026") && w.includes("الحد الأقصى القانوني"))).toBe(true);
  });

  it("withholds only what is still outstanding when that is less than the monthly instalment", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3000.00" });

    await calculatePayrollRun(run.id, { ...h.deps, garnishments: provider([order({ outstanding: Money.fromMajor("120.50") })]) });
    const [payslip] = await h.payslips.listByRunId(run.id);
    expect(payslip!.lines.find((l) => l.source === "garnishment")!.amount.toString()).toBe("120.500000");
    expect(payslip!.netPay.toString()).toBe("2879.500000");
  });

  it("skips an order in another currency with a named warning rather than withholding at par", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3000.00" });

    const calculated = await calculatePayrollRun(run.id, { ...h.deps, garnishments: provider([order({ currency: "USD" })]) });
    const [payslip] = await h.payslips.listByRunId(run.id);
    expect(payslip!.lines.some((l) => l.source === "garnishment")).toBe(false);
    expect(calculated.warnings.some((w) => w.includes("1842/2026") && w.includes("USD"))).toBe(true);
  });

  it("D181: shares the 25% non-nafaqa ceiling across multiple orders, in the order the register hands them over", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "500.00" }); // 25% ceiling = 125.00 for BOTH orders together

    const calculated = await calculatePayrollRun(run.id, {
      ...h.deps,
      garnishments: provider([order({ id: "grn-a", reference: "A" }), order({ id: "grn-b", reference: "B" })]),
    });
    const [payslip] = await h.payslips.listByRunId(run.id);
    const lines = payslip!.lines.filter((l) => l.source === "garnishment");
    // grn-a exhausts the whole shared ceiling; grn-b gets nothing (not "net
    // exhaustion" — net pay still has 375.00 left, the STATUTORY cap is what stops it).
    expect(lines.map((l) => [l.referenceId, l.amount.toString(), l.capped])).toEqual([["grn-a", "125.000000", true]]);
    expect(payslip!.netPay.toString()).toBe("375.000000");
    expect(calculated.warnings.some((w) => w.includes("B") && w.includes("الحد الأقصى القانوني"))).toBe(true);
  });
});

describe("calculatePayrollRun — D181: نفقة ranks first and may reach 50% of the wage", () => {
  function order(overrides: Partial<Garnishment> = {}): Garnishment {
    return {
      id: "grn-1",
      employeeId: "emp-1",
      reference: "1842/2026",
      labelAr: "حجز تنفيذي",
      monthlyAmount: Money.fromMajor("300.00"),
      currency: "EGP",
      startDate: "2026-01-01",
      endDate: null,
      outstanding: Money.fromMajor("3000.00"),
      active: true,
      ...overrides,
    };
  }

  function provider(orders: readonly Garnishment[]): GarnishmentProvider {
    return { listActiveFor: async (employeeId) => orders.filter((o) => o.employeeId === employeeId) };
  }

  it("lets a نفقة order reach 50% of the wage, above the 25% ceiling every other kind is held to", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "1000.00" }); // 50% ceiling = 500.00

    const calculated = await calculatePayrollRun(run.id, {
      ...h.deps,
      garnishments: provider([order({ kind: "alimony", monthlyAmount: Money.fromMajor("500.00"), outstanding: Money.fromMajor("6000.00") })]),
    });
    const [payslip] = await h.payslips.listByRunId(run.id);
    const line = payslip!.lines.find((l) => l.source === "garnishment")!;
    expect(line.amount.toString()).toBe("500.000000"); // the full instalment — 50% of 1000, not capped at 25%
    expect(line.capped).toBe(false);
    expect(calculated.warnings.some((w) => w.includes("الحد الأقصى القانوني"))).toBe(false);
  });

  it("caps a نفقة order at 50% of the wage once its instalment would exceed that", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "1000.00" }); // 50% ceiling = 500.00

    const calculated = await calculatePayrollRun(run.id, {
      ...h.deps,
      garnishments: provider([order({ kind: "alimony", monthlyAmount: Money.fromMajor("700.00"), outstanding: Money.fromMajor("6000.00") })]),
    });
    const [payslip] = await h.payslips.listByRunId(run.id);
    const line = payslip!.lines.find((l) => l.source === "garnishment")!;
    expect(line.amount.toString()).toBe("500.000000");
    expect(line.capped).toBe(true);
    expect(payslip!.netPay.toString()).toBe("500.000000");
    expect(calculated.warnings.some((w) => w.includes("1842/2026") && w.includes("الحد الأقصى القانوني"))).toBe(true);
  });

  it("honours نفقة first — it is withheld before any other order, and the other order only gets the room left under the COMBINED 50% ceiling", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "1000.00" }); // 50% ceiling = 500.00, 25% ceiling = 250.00

    const calculated = await calculatePayrollRun(run.id, {
      ...h.deps,
      garnishments: provider([
        // Registered AFTER the نفقة order, to prove ranking is by KIND, not registration order.
        order({ id: "grn-other", reference: "OTHER", kind: "court_order", monthlyAmount: Money.fromMajor("400.00"), outstanding: Money.fromMajor("4000.00") }),
        order({ id: "grn-nafaqa", reference: "NAFAQA", kind: "alimony", monthlyAmount: Money.fromMajor("400.00"), outstanding: Money.fromMajor("4000.00") }),
      ]),
    });
    const [payslip] = await h.payslips.listByRunId(run.id);
    const lines = payslip!.lines.filter((l) => l.source === "garnishment");
    // نفقة goes FIRST despite being listed second, taking its full 400.00
    // (inside its own 500.00 ceiling); the other order's own 25% ceiling
    // (250.00) is then squeezed to the 100.00 left under the COMBINED 50%
    // ceiling (500.00 - 400.00 already taken by نفقة).
    expect(lines.map((l) => [l.referenceId, l.amount.toString(), l.capped])).toEqual([
      ["grn-nafaqa", "400.000000", false],
      ["grn-other", "100.000000", true],
    ]);
    expect(payslip!.netPay.toString()).toBe("500.000000"); // 1000 - 400 - 100
  });
});

describe("calculatePayrollRun — D182: court orders rank ahead of contract deductions", () => {
  function order(overrides: Partial<Garnishment> = {}): Garnishment {
    return {
      id: "grn-1",
      employeeId: "emp-1",
      reference: "1842/2026",
      labelAr: "حجز تنفيذي",
      monthlyAmount: Money.fromMajor("300.00"),
      currency: "EGP",
      startDate: "2026-01-01",
      endDate: null,
      outstanding: Money.fromMajor("3000.00"),
      active: true,
      ...overrides,
    };
  }

  function provider(orders: readonly Garnishment[]): GarnishmentProvider {
    return { listActiveFor: async (employeeId) => orders.filter((o) => o.employeeId === employeeId) };
  }

  it("lists the court order's line ahead of the contract deduction's, and honours both when the wage covers them", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "2000.00", deductions: [{ name: "تأمينات", amount: "300.00" }] }); // 25% ceiling = 500.00

    await calculatePayrollRun(run.id, { ...h.deps, garnishments: provider([order()]) });
    const [payslip] = await h.payslips.listByRunId(run.id);
    const sources = payslip!.lines.filter((l) => l.kind === "deduction").map((l) => l.source);
    expect(sources).toEqual(["garnishment", "contract_deduction"]);
    expect(payslip!.netPay.toString()).toBe("1400.000000"); // 2000 - 300 - 300
  });

  it("protects the court order's (capped) share ahead of a voluntary contract deduction — the employee is excluded rather than the order shorted", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    // 25% ceiling = 250.00, so the order takes 250.00 (capped from its own
    // 300.00 instalment) BEFORE the 800.00 contract deduction is even
    // considered — leaving only 750.00 for a deduction that needs 800.00.
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "1000.00", deductions: [{ name: "قسط قرض", amount: "800.00" }] });
    await employeeWithContract(h, { id: "emp-2", monthlySalary: "1000.00" });
    const calculated = await calculatePayrollRun(run.id, { ...h.deps, garnishments: provider([order()]) });
    expect((await h.payslips.listByRunId(run.id)).map((p) => p.employeeId)).toEqual(["emp-2"]);
    expect(calculated.warnings.some((w) => w.includes("تتجاوز المستحقات"))).toBe(true);
  });
});

describe("calculatePayrollRun — D183: advance-recovery instalments are capped at 10% of the wage (Labour Law 12/2003 Art. 43)", () => {
  async function disbursedAdvance(h: Awaited<ReturnType<typeof harness>>, opts: { id: string; number: string; amount: string; count: number; firstDeductionDate: string }) {
    const requested = await requestEmployeeAdvance(
      { id: opts.id, number: opts.number, employeeId: "emp-1", amount: Money.fromMajor(opts.amount), installmentCount: opts.count, firstDeductionDate: opts.firstDeductionDate },
      h.advances,
    );
    const disbursed = markEmployeeAdvanceDisbursed(approveEmployeeAdvance(requested, "user-1"), { voucherId: "cv-1", journalEntryId: null });
    await h.advances.update(disbursed);
  }

  it("caps a single instalment at 10% of gross when the instalment itself would take more", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "1000.00" }); // 10% ceiling = 100.00
    await disbursedAdvance(h, { id: "adv-1", number: "ADV-000001", amount: "900.00", count: 3, firstDeductionDate: "2026-01-01" }); // instalment due = 300.00

    const calculated = await calculatePayrollRun(run.id, h.deps);
    const [payslip] = await h.payslips.listByRunId(run.id);
    const recovery = payslip!.lines.find((l) => l.source === "advance_recovery")!;
    expect(recovery.amount.toString()).toBe("100.000000");
    expect(recovery.capped).toBe(true);
    expect(payslip!.netPay.toString()).toBe("900.000000"); // 1000 - 100
    expect(calculated.warnings.some((w) => w.includes("ADV-000001") && w.includes("الحد الأقصى القانوني للاستقطاع"))).toBe(true);
  });

  it("does not cap an instalment that already falls at or under 10% of the wage", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3000.00" }); // 10% ceiling = 300.00
    await disbursedAdvance(h, { id: "adv-1", number: "ADV-000001", amount: "900.00", count: 3, firstDeductionDate: "2026-01-01" }); // instalment due = 300.00, exactly the ceiling

    const calculated = await calculatePayrollRun(run.id, h.deps);
    const [payslip] = await h.payslips.listByRunId(run.id);
    const recovery = payslip!.lines.find((l) => l.source === "advance_recovery")!;
    expect(recovery.amount.toString()).toBe("300.000000");
    expect(recovery.capped).toBe(false);
    expect(calculated.warnings.some((w) => w.includes("الحد الأقصى القانوني للاستقطاع"))).toBe(false);
  });

  it("carries the uncapped remainder forward: the SAME instalment is recovered again next period once the capped amount is applied", async () => {
    const h = await harness();
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "2000.00" }); // 10% ceiling = 200.00 each period
    await disbursedAdvance(h, { id: "adv-1", number: "ADV-000001", amount: "1000.00", count: 1, firstDeductionDate: "2026-01-01" }); // one instalment, due in full: 1,000.00

    const runJan = await createPayrollRun({ id: "r-jan", year: 2026, month: 1 }, h.deps);
    await calculatePayrollRun(runJan.id, h.deps);
    const [januarySlip] = await h.payslips.listByRunId(runJan.id);
    const januaryRecovery = januarySlip!.lines.find((l) => l.source === "advance_recovery")!;
    expect(januaryRecovery.amount.toString()).toBe("200.000000");
    expect(januaryRecovery.capped).toBe(true);

    // Mirrors what post-payroll-run.ts does on approval: only what was
    // ACTUALLY recovered counts down the balance — never the full scheduled
    // instalment — so the shortfall remains outstanding for next period.
    const advanceAfterJan = (await h.advances.listByEmployeeId("emp-1"))[0]!;
    const updated = applyAdvanceRecovery(advanceAfterJan, januaryRecovery.amount);
    await h.advances.update(updated);
    expect(updated.status).toBe("disbursed"); // 800.00 still outstanding, not yet مسددة

    const runFeb = await createPayrollRun({ id: "r-feb", year: 2026, month: 2 }, h.deps);
    await calculatePayrollRun(runFeb.id, h.deps);
    const [februarySlip] = await h.payslips.listByRunId(runFeb.id);
    const februaryRecovery = februarySlip!.lines.find((l) => l.source === "advance_recovery")!;
    // The SAME instalment (never fully recovered) is picked up again, capped
    // again at 10% of February's gross — the balance counts down by exactly
    // what was recovered each period, never by the instalment's full amount.
    expect(februaryRecovery.referenceId).toBe("adv-1");
    expect(februaryRecovery.amount.toString()).toBe("200.000000");
    expect(februaryRecovery.capped).toBe(true);
  });
});

describe("calculatePayrollRun — D184: a fully unpaid period nets zero, whatever the ÷30 divisor would otherwise leave", () => {
  const days = (n: number): UnpaidLeaveDaysProvider => ({ unpaidDaysFor: async () => n });

  it("28 unpaid days in a 28-day February (2026 is not a leap year) deducts the whole gross, not 28/30 of it", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 2 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "2800.00" });
    await calculatePayrollRun(run.id, { ...h.deps, unpaidLeave: days(28) });
    const [payslip] = await h.payslips.listByRunId(run.id);
    expect(payslip!.periodDays).toBe(28);
    const unpaid = payslip!.lines.find((l) => l.source === "unpaid_leave")!;
    // The pre-fix ÷30 formula would have deducted only 28/30 of the wage
    // (~2613.33), leaving the employee paid for days they never worked.
    expect(unpaid.amount.toString()).toBe("2800.000000");
    expect(payslip!.netPay.scaled).toBe(0n);
  });

  it("31 unpaid days in a 31-day month (January) also deducts the whole gross — the fix never OVER-deducts either", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3100.00" });
    await calculatePayrollRun(run.id, { ...h.deps, unpaidLeave: days(31) });
    const [payslip] = await h.payslips.listByRunId(run.id);
    expect(payslip!.periodDays).toBe(31);
    const unpaid = payslip!.lines.find((l) => l.source === "unpaid_leave")!;
    expect(unpaid.amount.toString()).toBe("3100.000000");
    expect(payslip!.netPay.scaled).toBe(0n);
  });
});

describe("calculatePayrollRun — the day divisor prices a day of unpaid leave", () => {
  const days = (n: number): UnpaidLeaveDaysProvider => ({ unpaidDaysFor: async () => n });

  it("defaults to FIXED_30: three days of a 3,100 salary in a 31-day month is 310.00, not 300.00", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3100.00" });
    await calculatePayrollRun(run.id, { ...h.deps, unpaidLeave: days(3) });
    const [payslip] = await h.payslips.listByRunId(run.id);
    expect(payslip!.lines.find((l) => l.source === "unpaid_leave")!.amount.toString()).toBe("310.000000");
  });

  it("CALENDAR_DAYS in February: two days of a 2,800 salary is 200.00, where FIXED_30 would take 186.67", async () => {
    const calendar = await harness();
    const r1 = await createPayrollRun({ id: "r1", year: 2026, month: 2 }, calendar.deps);
    await employeeWithContract(calendar, { id: "emp-1", monthlySalary: "2800.00" });
    await calculatePayrollRun(r1.id, { ...calendar.deps, unpaidLeave: days(2), dayDivisorBasis: "CALENDAR_DAYS" });
    const [cal] = await calendar.payslips.listByRunId(r1.id);
    expect(cal!.lines.find((l) => l.source === "unpaid_leave")!.amount.toString()).toBe("200.000000");

    const fixed = await harness();
    const r2 = await createPayrollRun({ id: "r2", year: 2026, month: 2 }, fixed.deps);
    await employeeWithContract(fixed, { id: "emp-1", monthlySalary: "2800.00" });
    await calculatePayrollRun(r2.id, { ...fixed.deps, unpaidLeave: days(2), dayDivisorBasis: "FIXED_30" });
    const [fix] = await fixed.payslips.listByRunId(r2.id);
    expect(fix!.lines.find((l) => l.source === "unpaid_leave")!.amount.toString()).toBe("186.666667");
  });

  it("prices the day on basic PLUS allowances, the whole monthly wage", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 4 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "2700.00", allowances: [{ name: "بدل", amount: "300.00" }] });
    await calculatePayrollRun(run.id, { ...h.deps, unpaidLeave: days(1) });
    const [payslip] = await h.payslips.listByRunId(run.id);
    expect(payslip!.lines.find((l) => l.source === "unpaid_leave")!.amount.toString()).toBe("100.000000");
  });

  it("never deducts more than was earned: 30 FIXED_30 days in a 31-day month take the whole gross, not 31/30 of it", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3100.00" });
    await calculatePayrollRun(run.id, { ...h.deps, unpaidLeave: days(31) });
    const [payslip] = await h.payslips.listByRunId(run.id);
    expect(payslip!.lines.find((l) => l.source === "unpaid_leave")!.amount.toString()).toBe(payslip!.grossEarnings.toString());
    expect(payslip!.netPay.scaled).toBe(0n);
  });

  it("caps a mid-month joiner's deduction at what they actually earned", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 1 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "3000.00", hireDate: "2026-01-30", contractStart: "2026-01-30" });
    await calculatePayrollRun(run.id, { ...h.deps, unpaidLeave: days(2) });
    const [payslip] = await h.payslips.listByRunId(run.id);
    const unpaid = payslip!.lines.find((l) => l.source === "unpaid_leave")!;
    // D185: the two paid days are now ALSO priced on the FIXED_30 default
    // divisor (3,000 / 30 × 2 = 200.00 exactly), the same basis unpaid leave
    // already used — so both figures naturally agree at 200.00; both unpaid
    // days fall inside those two paid days, so the deduction is the whole
    // period's contract earnings (D184), which here is that same 200.00.
    expect(payslip!.grossEarnings.toString()).toBe("200.000000");
    expect(unpaid.amount.toString()).toBe("200.000000");
    expect(payslip!.netPay.scaled).toBe(0n);
  });
});

describe("payrollDayDivisor", () => {
  it("is 30 under FIXED_30 whatever the month's length", () => {
    expect([28, 29, 30, 31].map((n) => payrollDayDivisor("FIXED_30", n))).toEqual([30, 30, 30, 30]);
  });

  it("is the period's real length under CALENDAR_DAYS", () => {
    expect([28, 29, 30, 31].map((n) => payrollDayDivisor("CALENDAR_DAYS", n))).toEqual([28, 29, 30, 31]);
  });
});

describe("calculatePayrollRun — statutory computation is gated by the tenant switch", () => {
  it("OFF (the default): no tax, insurance or levy line, no table resolved, and the run records none", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2027, month: 6 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "10000.00" });
    const calculated = await calculatePayrollRun(run.id, h.deps);
    const [payslip] = await h.payslips.listByRunId(run.id);
    expect(calculated.statutoryTableCodes).toEqual([]);
    expect(payslip!.lines.map((l) => l.source)).toEqual(["contract_basic"]);
    expect(payslip!.netPay.toString()).toBe("10000.000000");
    expect(payslip!.insurableWage.scaled).toBe(0n);
  });

  it("ON: insurance, tax and the levy are withheld, each line naming the dated row it came from", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 6 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "10000.00" });
    const calculated = await calculatePayrollRun(run.id, { ...h.deps, statutoryEnabled: true });
    const [payslip] = await h.payslips.listByRunId(run.id);
    const bySource = new Map(payslip!.lines.map((l) => [l.source, l]));
    expect(bySource.get("social_insurance_employee")!.amount.toString()).toBe("1100.000000");
    expect(bySource.get("social_insurance_employee")!.referenceId).toBe("EG_SOCIAL_INSURANCE_2026");
    expect(bySource.get("social_insurance_employer")!.amount.toString()).toBe("1875.000000");
    expect(bySource.get("income_tax")!.amount.toString()).toBe("592.500000");
    expect(bySource.get("income_tax")!.referenceId).toBe("EG_SALARY_TAX_2024");
    expect(bySource.get("statutory_levy")!.amount.toString()).toBe("5.000000");
    expect(payslip!.netPay.toString()).toBe("8302.500000");
    expect(payslip!.totalEmployerCost?.toString()).toBe("11875.000000");
    expect(calculated.statutoryTableCodes).toContain("EG_SOCIAL_INSURANCE_2026");
  });

  it("ON for a year whose limits are unpublished: the run refuses rather than computing on an old ceiling", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2027, month: 6 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "10000.00" });
    await expect(calculatePayrollRun(run.id, { ...h.deps, statutoryEnabled: true })).rejects.toThrow(StatutoryRulesUnavailableError);
  });

  it("ON: an employee with the disability exemption withholds less tax on the same pay", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 6 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "10000.00" });
    const current = (await h.employeeRepo.findById("emp-1"))!;
    await h.employeeRepo.update({ ...current, taxDisabilityExemption: true });
    await calculatePayrollRun(run.id, { ...h.deps, statutoryEnabled: true });
    const [payslip] = await h.payslips.listByRunId(run.id);
    expect(payslip!.lines.find((l) => l.source === "income_tax")!.amount.toString()).toBe("425.830000");
  });
});

describe("calculatePayrollRun — overtime from attendance with the statutory switch on (D186–D188)", () => {
  function attendanceRows(rows: AttendanceEntry[]): Pick<AttendanceRepository, "list"> {
    return {
      async list(filter) {
        return rows.filter((r) => r.employeeId === filter?.employeeId && (!filter?.from || r.date >= filter.from) && (!filter?.to || r.date <= filter.to));
      },
    };
  }

  function worked(date: string, overrides: Partial<AttendanceEntry> = {}): AttendanceEntry {
    return {
      id: `att-${date}`,
      employeeId: "emp-1",
      date,
      checkIn: "09:00",
      checkOut: "17:00",
      workedMinutes: 480,
      approvedOvertimeMinutes: null,
      holidayCompensation: "pay",
      status: "present",
      notes: null,
      createdAt: `${date}T17:00:00.000Z`,
      updatedAt: `${date}T17:00:00.000Z`,
      ...overrides,
    };
  }

  it("prices each day by the table in force on it, names that table on the line, and records every table used", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 6 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "9000.00" });
    const base = EGYPT_OVERTIME_TABLES[1]!;
    const tables: OvertimeTable[] = [
      { ...base, code: "TEST_BEFORE", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-14" },
      { ...base, code: "TEST_AFTER", effectiveFrom: "2026-06-15", effectiveTo: null, dayPremiumBp: 5000 },
    ];
    const overtime = createOvertimeHoursProvider(
      attendanceRows([worked("2026-06-10", { approvedOvertimeMinutes: 60 }), worked("2026-06-17", { approvedOvertimeMinutes: 60 })]),
      () => ({ standardDailyHours: 8, weeklyOffDays: [5, 6], tableFor: (date) => resolveOvertimeTable(date, tables) }),
    );
    const calculated = await calculatePayrollRun(run.id, { ...h.deps, statutoryEnabled: true, overtime });
    const [payslip] = await h.payslips.listByRunId(run.id);
    const lines = payslip!.lines.filter((l) => l.source === "overtime");
    expect(lines.map((l) => [l.referenceId, l.amount.toString()])).toEqual([
      ["TEST_BEFORE", "50.630000"],
      ["TEST_AFTER", "56.250000"],
    ]);
    expect(calculated.statutoryTableCodes).toEqual(expect.arrayContaining(["TEST_BEFORE", "TEST_AFTER"]));
  });

  it("a rest day and a holiday are paid by the day, and the missing replacement rest day is a warning on the run", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 6 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "9000.00" });
    const holidays = [{ id: "h1", date: "2026-06-10", nameEn: "Holiday", nameAr: "عطلة", recurringAnnual: false, createdAt: "2026-01-01T00:00:00.000Z" }];
    const overtime = createOvertimeHoursProvider(
      attendanceRows([worked("2026-06-05", { approvedOvertimeMinutes: 480 }), worked("2026-06-10", { approvedOvertimeMinutes: 480 }), worked("2026-06-16", { checkOut: "19:00", workedMinutes: 600 })]),
      () => ({ standardDailyHours: 8, weeklyOffDays: [5, 6], holidays }),
    );
    const calculated = await calculatePayrollRun(run.id, { ...h.deps, statutoryEnabled: true, overtime });
    const [payslip] = await h.payslips.listByRunId(run.id);
    expect(payslip!.lines.filter((l) => l.source === "overtime").map((l) => l.amount.toString())).toEqual(["300.000000", "600.000000"]);
    expect(calculated.warnings.some((w) => w.includes("2026-06-05") && w.includes("راحة بديلة") && w.includes("2026-06-12"))).toBe(true);
  });

  it("an ineligible employee's approved hours are reported, not paid", async () => {
    const h = await harness();
    const run = await createPayrollRun({ id: "r1", year: 2026, month: 6 }, h.deps);
    await employeeWithContract(h, { id: "emp-1", monthlySalary: "9000.00" });
    const overtime = createOvertimeHoursProvider(attendanceRows([worked("2026-06-16", { approvedOvertimeMinutes: 120 })]), () => ({
      standardDailyHours: 8,
      overtimeEligible: false,
    }));
    const calculated = await calculatePayrollRun(run.id, { ...h.deps, statutoryEnabled: true, overtime });
    const [payslip] = await h.payslips.listByRunId(run.id);
    expect(payslip!.lines.some((l) => l.source === "overtime")).toBe(false);
    expect(calculated.warnings.some((w) => w.includes("غير مستحق للأجر الإضافي"))).toBe(true);
  });
});
