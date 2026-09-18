import { Money, allocate } from "../money/index.js";
import type { EmployeeDirectory, EmployeeRef } from "../hr-shared/employee-ref.js";
import { getPayBasisLabel, getPayFrequencyLabel, type Contract, type ContractRepository } from "./contract.js";
import { componentAccountId, type PayrollComponentRepository } from "./payroll-component.js";
import {
  amountDueBy,
  type EmployeeAdvance,
  type EmployeeAdvanceRepository,
} from "./advance.js";
import {
  canTransitionPayrollRun,
  inclusiveDays,
  payrollDayDivisor,
  payrollPeriodBounds,
  PAYROLL_GL_ACCOUNTS,
  type Garnishment,
  type GarnishmentProvider,
  type PayrollDayDivisorBasis,
  type PayrollRun,
  type PayrollRunRepository,
  type Payslip,
  type PayslipLine,
  type PayslipRepository,
  type UnpaidLeaveDaysProvider,
} from "./payroll-run.js";
import {
  DuplicatePayrollPeriodError,
  InvalidPayrollRunError,
  InvalidPayrollRunTransitionError,
  NegativeNetPayError,
  NoPayableEmployeesError,
  PayrollRunNotFoundError,
} from "./errors.js";

/**
 * The payroll calculation engine (docs/archive/catalog/06 "الرواتب").
 *
 * WHAT IT COMPUTES — and nothing else:
 *   - gross = the active contract's monthly salary + its allowance lines,
 *     each PRORATED by the days the contract was actually live inside the
 *     period (hire mid-month, contract start/end mid-month);
 *   - deductions = an unpaid-leave deduction if and only if an unpaid-leave
 *     day source is bound (each day priced at the monthly wage over the
 *     tenant's day divisor), then wage garnishments, then the contract's own
 *     deduction lines (fixed monthly amounts, NOT prorated), then
 *     advance-recovery instalments falling due — COURT ORDERS RANK FIRST
 *     among these: a legal order outranks both the employer's own voluntary
 *     contract deductions and its own loan (advance recovery). Garnishments
 *     are themselves capped under Labour Law 12/2003 Art. 44 — see
 *     `calculatePayrollRun` below for the 25%/50% ceilings;
 *   - net = gross − deductions.
 *
 * Every proration and split runs through `allocate` (largest remainder) so the
 * parts sum EXACTLY to the whole — payroll never loses or invents a unit.
 *
 * WHAT IT DOES NOT COMPUTE: income tax, social insurance (employee or
 * employer share), overtime, seniority bonuses, end-of-service. The catalog
 * specifies no formula for any of them, so this engine produces no line for
 * them rather than a plausible-looking wrong one. They slot in as additional
 * `PayslipLine`s when their rules are actually specified, and are enumerated
 * for the screens in `PAYROLL_UNIMPLEMENTED_RULES` (payroll-run.ts).
 */

export interface PayrollNumbering {
  next(code: string): Promise<{ readonly formatted: string }>;
}

export interface CreatePayrollRunCommand {
  readonly id: string;
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  readonly branchId?: string | null;
  readonly currency?: string;
  readonly now?: () => string;
}

export interface PayrollCalculationDeps {
  readonly runs: PayrollRunRepository;
  readonly payslips: PayslipRepository;
  readonly employees: EmployeeDirectory;
  readonly contracts: Pick<ContractRepository, "listByEmployeeId">;
  readonly advances: Pick<EmployeeAdvanceRepository, "listByEmployeeId">;
  readonly numbering: PayrollNumbering;
  /** Bound by the attendance/leave side of HR; absent = no unpaid-leave day is deducted (recorded on the run). */
  readonly unpaidLeave?: UnpaidLeaveDaysProvider;
  /** Court-ordered and agreed wage deductions that are not employee advances. */
  readonly garnishments?: GarnishmentProvider;
  /** GL routing registry for earning/deduction components (R10.7); absent = every line falls back to the run's default accounts. */
  readonly payrollComponents?: Pick<PayrollComponentRepository, "list">;
  /** أساس قسمة اليوم — how a monthly salary breaks into days. Defaults to the Egyptian FIXED_30 convention. */
  readonly dayDivisorBasis?: PayrollDayDivisorBasis;
  readonly idGen?: () => string;
  readonly now?: () => string;
}

/** Opens a مسودة (draft) run for one month. Rejects a second live run for the same period + branch scope. */
export async function createPayrollRun(
  cmd: CreatePayrollRunCommand,
  deps: Pick<PayrollCalculationDeps, "runs" | "numbering">,
): Promise<PayrollRun> {
  const reasons: string[] = [];
  if (!Number.isInteger(cmd.year) || cmd.year < 1900) reasons.push("السنة مطلوبة");
  if (!Number.isInteger(cmd.month) || cmd.month < 1 || cmd.month > 12) reasons.push("الشهر يجب أن يكون بين 1 و 12");
  if (reasons.length > 0) throw new InvalidPayrollRunError(reasons);

  const branchId = cmd.branchId ?? null;
  const existing = await deps.runs.findByPeriod(cmd.year, cmd.month, branchId);
  if (existing && existing.status !== "cancelled") {
    throw new DuplicatePayrollPeriodError(cmd.year, cmd.month, branchId);
  }

  const bounds = payrollPeriodBounds(cmd.year, cmd.month);
  const number = (await deps.numbering.next("PAYROLL_RUN")).formatted;
  const run: PayrollRun = {
    id: cmd.id,
    number,
    year: cmd.year,
    month: cmd.month,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    branchId,
    currency: cmd.currency ?? "EGP",
    status: "draft",
    employeeCount: 0,
    totalGross: Money.zero(),
    totalDeductions: Money.zero(),
    totalEmployerContributions: Money.zero(),
    totalNet: Money.zero(),
    unpaidLeaveSource: "none",
    warnings: [],
    journalEntryId: null,
    disbursementVoucherId: null,
    calculatedAt: null,
    approvedAt: null,
    approvedBy: null,
    disbursedAt: null,
    cancelledAt: null,
    createdAt: cmd.now?.() ?? new Date().toISOString(),
  };
  await deps.runs.create(run);
  return run;
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

/** The contract in force for the period: active, and overlapping [periodStart, periodEnd]. Latest start wins. */
function pickContract(contracts: readonly Contract[], periodStart: string, periodEnd: string): Contract | null {
  const candidates = contracts.filter(
    (c) => c.status === "active" && c.startDate <= periodEnd && (c.endDate === null || c.endDate >= periodStart),
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0))[0] ?? null;
}

/** Prorates a monthly amount over the days the contract was live. Exact — the two parts always sum to `amount`. */
function prorate(amount: Money, paidDays: number, periodDays: number): Money {
  if (paidDays >= periodDays) return amount;
  return allocate(amount, [paidDays, periodDays - paidDays])[0] as Money;
}

/** A percentage of `base`, floored to the scaled unit — a cap must never be crossed by rounding up. */
function ceilingOf(base: bigint, percent: bigint): bigint {
  return (base * percent) / 100n;
}

interface GarnishmentWithholdingResult {
  /** What was actually withheld this period. */
  readonly take: bigint;
  /** What the order is due this period, before any cap or net-pay limit. */
  readonly owed: bigint;
  /** True when the statutory ceiling — not net pay — kept `take` below `owed`. */
  readonly cappedByLaw: boolean;
  /** True when net pay left after the cap — not the cap itself — further reduced `take`. */
  readonly cappedByNet: boolean;
}

/**
 * Resolves one order against a shared statutory ceiling for its group (نفقة or
 * everything else) and the wage still available. `withheldInGroup` is the
 * running total already taken by earlier orders in the SAME group this
 * period, so the ceiling is shared across every order of that kind, not
 * reset per order.
 */
function resolveGarnishmentWithholding(
  order: Garnishment,
  ceiling: bigint,
  withheldInGroup: bigint,
  available: bigint,
): GarnishmentWithholdingResult | null {
  const owed = order.outstanding.scaled < order.monthlyAmount.scaled ? order.outstanding.scaled : order.monthlyAmount.scaled;
  if (owed <= 0n) return null;
  const roomUnderCap = ceiling - withheldInGroup;
  if (roomUnderCap <= 0n) return { take: 0n, owed, cappedByLaw: true, cappedByNet: false };
  const underCap = owed < roomUnderCap ? owed : roomUnderCap;
  const take = underCap < available ? underCap : available;
  return {
    take: take < 0n ? 0n : take,
    owed,
    cappedByLaw: underCap < owed,
    cappedByNet: take < underCap,
  };
}

interface EmployeePayrollInput {
  readonly employee: EmployeeRef;
  readonly contract: Contract;
  readonly paidDays: number;
}

/**
 * Calculates (or recalculates) a run: replaces its payslips wholesale and
 * moves it to محتسب (calculated). Advance balances are NOT touched here — a
 * recalculation must be free of side effects; recovery is applied when the run
 * is approved and its journal entry posts.
 */
export async function calculatePayrollRun(runId: string, deps: PayrollCalculationDeps): Promise<PayrollRun> {
  const run = await deps.runs.findById(runId);
  if (!run) throw new PayrollRunNotFoundError(runId);
  if (!canTransitionPayrollRun(run.status, "calculated")) {
    throw new InvalidPayrollRunTransitionError(run.status, "calculated");
  }

  const now = deps.now?.() ?? new Date().toISOString();
  const idGen = deps.idGen ?? (() => `${runId}:${Math.random().toString(36).slice(2)}`);
  const periodDays = inclusiveDays(run.periodStart, run.periodEnd);
  const divisor = payrollDayDivisor(deps.dayDivisorBasis ?? "FIXED_30", periodDays);
  const warnings: string[] = [];

  const employees = (await deps.employees.listActive()).filter((e) => run.branchId === null || e.branchId === run.branchId);

  const inputs: EmployeePayrollInput[] = [];
  for (const employee of employees) {
    const contract = pickContract(await deps.contracts.listByEmployeeId(employee.id), run.periodStart, run.periodEnd);
    if (!contract) {
      warnings.push(`${employee.fullNameAr} (${employee.code}): لا يوجد عقد ساري خلال الفترة — تم استبعاده.`);
      continue;
    }
    if (contract.payBasis !== "monthly") {
      warnings.push(`${employee.fullNameAr} (${employee.code}): أساس الدفع "${getPayBasisLabel(contract.payBasis)}" يحتاج بيانات حضور — تم استبعاده.`);
      continue;
    }
    if (contract.currency !== run.currency) {
      warnings.push(`${employee.fullNameAr} (${employee.code}): عملة العقد (${contract.currency}) تختلف عن عملة الدورة (${run.currency}) — تم استبعاده.`);
      continue;
    }
    if (contract.payFrequency !== "monthly") {
      warnings.push(`${employee.fullNameAr} (${employee.code}): تكرار الدفع "${getPayFrequencyLabel(contract.payFrequency)}" — احتُسب راتب شهر كامل للفترة.`);
    }
    const paidStart = maxDate(maxDate(run.periodStart, contract.startDate), employee.hireDate);
    const paidEnd = minDate(run.periodEnd, contract.endDate ?? run.periodEnd);
    const paidDays = inclusiveDays(paidStart, paidEnd);
    if (paidDays <= 0) {
      warnings.push(`${employee.fullNameAr} (${employee.code}): لا توجد أيام مستحقة خلال الفترة — تم استبعاده.`);
      continue;
    }
    if (paidDays < periodDays) {
      warnings.push(`${employee.fullNameAr} (${employee.code}): احتُسب ${paidDays} من ${periodDays} يوماً بالتناسب.`);
    }
    inputs.push({ employee, contract, paidDays });
  }

  if (inputs.length === 0) throw new NoPayableEmployeesError(runId);

  if (!deps.unpaidLeave) {
    warnings.push("لم يُربط مصدر أيام الإجازات بدون أجر — لم تُخصم أي أيام إجازة بدون أجر في هذه الدورة.");
  }

  const components = (await deps.payrollComponents?.list()) ?? [];

  const payslips: Payslip[] = [];
  for (const { employee, contract, paidDays } of inputs) {
    const lines: PayslipLine[] = [];

    lines.push({
      id: idGen(),
      kind: "earning",
      source: "contract_basic",
      nameAr: "الراتب الأساسي",
      amount: prorate(contract.monthlySalary, paidDays, periodDays),
      glAccountId: null,
      referenceId: null,
      capped: false,
    });
    for (const allowance of contract.allowances) {
      lines.push({
        id: idGen(),
        kind: "earning",
        source: "contract_allowance",
        nameAr: allowance.name,
        amount: prorate(allowance.amount, paidDays, periodDays),
        glAccountId: componentAccountId(components, allowance.componentId),
        referenceId: null,
        capped: false,
      });
    }

    // The wage base every statutory calculation below reads off — the gross
    // earnings this engine already computes above, UNREDUCED by any
    // deduction. Both the unpaid-leave clamp and the garnishment cap measure
    // against this same figure.
    const grossEarnings = Money.sum(lines.filter((l) => l.kind === "earning").map((l) => l.amount));

    if (deps.unpaidLeave) {
      const reported = await deps.unpaidLeave.unpaidDaysFor(employee.id, run.periodStart, run.periodEnd);
      const unpaidDays = Math.min(Math.max(Math.round(reported), 0), paidDays);
      if (unpaidDays > 0) {
        const monthlyWage = contract.monthlySalary.add(Money.sum(contract.allowances.map((a) => a.amount)));
        const atDayRate = unpaidDays >= divisor ? monthlyWage : (allocate(monthlyWage, [unpaidDays, divisor - unpaidDays])[0] as Money);
        // D184: the ÷30 (FIXED_30) divisor under-deducts once EVERY paid day
        // in the period was unpaid but the period itself is shorter than 30
        // days (February) — e.g. 28 unpaid days of a 28-day February would
        // only bill 28/30, leaving the employee 2/30 of a month they never
        // worked. Once unpaid days cover the whole paid period, the
        // deduction is that period's own gross earnings, never a
        // divisor-based fraction of it.
        const fullyUnpaid = unpaidDays >= paidDays;
        const deduction = fullyUnpaid ? grossEarnings : atDayRate.scaled > grossEarnings.scaled ? grossEarnings : atDayRate;
        lines.push({
          id: idGen(),
          kind: "deduction",
          source: "unpaid_leave",
          nameAr: `إجازة بدون أجر (${unpaidDays} يوم)`,
          amount: deduction,
          glAccountId: null,
          referenceId: null,
          capped: false,
        });
      }
    }

    // D182: court orders rank ahead of the employer's own voluntary/contract
    // deductions (Labour Law 12/2003 obliges the employer to honour a legal
    // order before its own agreed deductions), so garnishments are resolved
    // against the wage BEFORE contract deductions are even totalled.
    let available = grossEarnings.scaled - Money.sum(lines.filter((l) => l.kind === "deduction").map((l) => l.amount)).scaled;

    const eligibleOrders: Garnishment[] = [];
    for (const order of (await deps.garnishments?.listActiveFor(employee.id, run.periodEnd)) ?? []) {
      if (order.currency !== run.currency) {
        warnings.push(`${employee.fullNameAr} (${employee.code}): الحجز ${order.reference} بعملة ${order.currency} — لم يُخصم.`);
        continue;
      }
      eligibleOrders.push(order);
    }

    /**
     * D181 — Labour Law 12/2003 Art. 44: wage attachment is capped at 25% of
     * the wage; where there is a نفقة (alimony/family-maintenance) order the
     * combined attachment may reach 50%, and نفقة is satisfied first. So:
     * نفقة orders share a 50% ceiling and go first; every other order shares
     * a 25% ceiling; and the two ceilings combined never exceed 50%.
     */
    const nafaqaCeiling = ceilingOf(grossEarnings.scaled, 50n);
    const nonNafaqaCeiling = ceilingOf(grossEarnings.scaled, 25n);

    const nafaqaOrders = eligibleOrders.filter((o) => o.kind === "alimony");
    const otherOrders = eligibleOrders.filter((o) => o.kind !== "alimony");

    function withholdGroup(orders: readonly Garnishment[], ceiling: bigint, ceilingLabelAr: string): bigint {
      let withheld = 0n;
      for (const order of orders) {
        if (available <= 0n) break;
        const result = resolveGarnishmentWithholding(order, ceiling, withheld, available);
        if (result === null) continue;
        const { take, cappedByLaw, cappedByNet } = result;
        if (take <= 0n) {
          if (cappedByLaw) {
            warnings.push(`${employee.fullNameAr} (${employee.code}): الحجز ${order.reference} بلغ الحد الأقصى القانوني ${ceilingLabelAr} — يُرحّل الباقي.`);
          }
          continue;
        }
        available -= take;
        withheld += take;
        if (cappedByLaw) {
          warnings.push(`${employee.fullNameAr} (${employee.code}): الحجز ${order.reference} خُصم بحدود الحد الأقصى القانوني ${ceilingLabelAr} — يُرحّل الباقي.`);
        }
        if (cappedByNet) {
          warnings.push(`${employee.fullNameAr} (${employee.code}): الحجز ${order.reference} خُصم جزئياً بحدود صافي الراتب المتاح — يُرحّل الباقي.`);
        }
        lines.push({
          id: idGen(),
          kind: "deduction",
          source: "garnishment",
          nameAr: `${order.labelAr} (${order.reference})`,
          amount: Money.fromScaled(take),
          glAccountId: PAYROLL_GL_ACCOUNTS.garnishmentPayableAccountId,
          referenceId: order.id,
          capped: cappedByLaw,
        });
      }
      return withheld;
    }

    const nafaqaWithheld = withholdGroup(nafaqaOrders, nafaqaCeiling, "(50% نفقة)");
    const otherCeiling = nonNafaqaCeiling < nafaqaCeiling - nafaqaWithheld ? nonNafaqaCeiling : nafaqaCeiling - nafaqaWithheld;
    withholdGroup(otherOrders, otherCeiling, "(25% للحجز على الأجر)");

    for (const deduction of contract.deductions) {
      lines.push({
        id: idGen(),
        kind: "deduction",
        source: "contract_deduction",
        nameAr: deduction.name,
        amount: deduction.amount,
        glAccountId: componentAccountId(components, deduction.componentId),
        referenceId: null,
        capped: false,
      });
    }

    const fixedDeductions = Money.sum(lines.filter((l) => l.kind === "deduction").map((l) => l.amount));
    available = grossEarnings.scaled - fixedDeductions.scaled;
    if (available < 0n) {
      throw new NegativeNetPayError(employee.id, grossEarnings.toString(), fixedDeductions.toString());
    }

    const advances = (await deps.advances.listByEmployeeId(employee.id))
      .filter((a: EmployeeAdvance) => a.status === "disbursed")
      .sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
    for (const advance of advances) {
      if (available <= 0n) break;
      if (advance.currency !== run.currency) {
        warnings.push(`${employee.fullNameAr} (${employee.code}): السلفة ${advance.number} بعملة ${advance.currency} — لم تُخصم.`);
        continue;
      }
      const due = amountDueBy(advance, run.periodEnd).scaled;
      if (due <= 0n) continue;
      const take = due < available ? due : available;
      available -= take;
      if (take < due) {
        warnings.push(`${employee.fullNameAr} (${employee.code}): قسط السلفة ${advance.number} خُصم جزئياً بحدود صافي الراتب المتاح — يُرحّل الباقي.`);
      }
      lines.push({
        id: idGen(),
        kind: "deduction",
        source: "advance_recovery",
        nameAr: `سداد سلفة ${advance.number}`,
        amount: Money.fromScaled(take),
        glAccountId: null,
        referenceId: advance.id,
        capped: false,
      });
    }

    const totalDeductions = Money.sum(lines.filter((l) => l.kind === "deduction").map((l) => l.amount));
    const employerContributions = Money.sum(lines.filter((l) => l.kind === "employer_contribution").map((l) => l.amount));
    const netPay = Money.fromScaled(grossEarnings.scaled - totalDeductions.scaled);

    payslips.push({
      id: idGen(),
      number: (await deps.numbering.next("PAYSLIP")).formatted,
      runId: run.id,
      employeeId: employee.id,
      contractId: contract.id,
      currency: run.currency,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      periodDays,
      paidDays,
      lines,
      grossEarnings,
      totalDeductions,
      employerContributions,
      netPay,
      createdAt: now,
    });
  }

  await deps.payslips.deleteByRunId(run.id);
  for (const payslip of payslips) await deps.payslips.create(payslip);

  const calculated: PayrollRun = {
    ...run,
    status: "calculated",
    employeeCount: payslips.length,
    totalGross: Money.sum(payslips.map((p) => p.grossEarnings)),
    totalDeductions: Money.sum(payslips.map((p) => p.totalDeductions)),
    totalEmployerContributions: Money.sum(payslips.map((p) => p.employerContributions)),
    totalNet: Money.sum(payslips.map((p) => p.netPay)),
    unpaidLeaveSource: deps.unpaidLeave ? "provider" : "none",
    warnings,
    calculatedAt: now,
  };
  await deps.runs.update(calculated);
  return calculated;
}

/** Cancels a run that has not been approved yet (ملغى). */
export async function cancelPayrollRun(runId: string, deps: Pick<PayrollCalculationDeps, "runs" | "payslips" | "now">): Promise<PayrollRun> {
  const run = await deps.runs.findById(runId);
  if (!run) throw new PayrollRunNotFoundError(runId);
  if (!canTransitionPayrollRun(run.status, "cancelled")) {
    throw new InvalidPayrollRunTransitionError(run.status, "cancelled");
  }
  await deps.payslips.deleteByRunId(run.id);
  const cancelled: PayrollRun = {
    ...run,
    status: "cancelled",
    employeeCount: 0,
    totalGross: Money.zero(),
    totalDeductions: Money.zero(),
    totalEmployerContributions: Money.zero(),
    totalNet: Money.zero(),
    cancelledAt: deps.now?.() ?? new Date().toISOString(),
  };
  await deps.runs.update(cancelled);
  return cancelled;
}
