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
  type GarnishmentProvider,
  type OvertimeHoursProvider,
  type PayrollDayDivisorBasis,
  type PayrollRun,
  type PayrollRunRepository,
  type Payslip,
  type PayslipLine,
  type PayslipRepository,
  type UnpaidLeaveDaysProvider,
  type WorkedTimeProvider,
} from "./payroll-run.js";
import {
  resolveEgyptStatutoryRules,
  formatRateBp,
  type EgyptStatutoryRules,
} from "./egypt-statutory.js";
import {
  hourlyRate,
  monthlyIncomeTax,
  overtimePay,
  payrollLevies,
  socialInsuranceFor,
} from "./statutory-payroll.js";
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
 * WHAT IT COMPUTES, in the order the arithmetic has to happen:
 *
 *   1. EARNINGS — the contract's pay for the period. A monthly contract is
 *      prorated by the days it was actually live; an hourly or daily contract
 *      is priced off the days and hours attendance actually recorded.
 *      Allowances prorate with the basic.
 *   2. OVERTIME — hours from attendance, each at the statutory premium for the
 *      kind of hour it was (نهاري / ليلي / يوم راحة).
 *   3. UNPAID LEAVE — days with no pay, deducted before anything statutory,
 *      because they reduce the wage the state assesses.
 *   4. SOCIAL INSURANCE — on the الأجر التأميني: the contractual wage clamped
 *      between the year's floor and ceiling, NOT on gross. Both the employee's
 *      share and the employer's are computed; only the employee's touches net.
 *   5. SALARY TAX — annualised, personal exemption applied, the year's brackets
 *      walked (including the elimination tiers above EGP 600,000), divided back
 *      to the month.
 *   6. LEVIES — the small statutory percentages, currently the Martyrs Fund.
 *   7. CONTRACT DEDUCTIONS, GARNISHMENTS, ADVANCE RECOVERY — in that order, so
 *      a court order is satisfied before the employer recovers its own loan.
 *
 * Every proration and split runs through `allocate` (largest remainder) so the
 * parts sum EXACTLY to the whole — payroll never loses or invents a unit.
 *
 * The statutory rates are not in this file. They are dated tables in
 * `egypt-statutory.ts`, resolved for the period's END date, and a period no
 * table covers makes this function THROW rather than compute on a superseded
 * ceiling. What remains genuinely unimplemented is enumerated for the screens
 * in `PAYROLL_UNIMPLEMENTED_RULES` (payroll-run.ts).
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
  /** Bound by attendance; absent = no overtime line is produced (recorded on the run). */
  readonly overtime?: OvertimeHoursProvider;
  /** Bound by attendance; required for hourly and daily contracts, which have no monthly amount to prorate. */
  readonly workedTime?: WorkedTimeProvider;
  /** Court-ordered and agreed wage deductions that are not employee advances. */
  readonly garnishments?: GarnishmentProvider;
  /** GL routing registry for earning/deduction components (R10.7); absent = every line falls back to the run's default accounts. */
  readonly payrollComponents?: Pick<PayrollComponentRepository, "list">;
  /** أساس قسمة اليوم — how a monthly salary breaks into days. Defaults to the Egyptian FIXED_30 convention. */
  readonly dayDivisorBasis?: PayrollDayDivisorBasis;
  /** Standard contracted hours in a working day; falls back to the statutory 8. */
  readonly standardDailyHours?: number;
  /** Rate to convert a foreign-currency contract into the run's currency, keyed "FROM:TO". */
  readonly exchangeRates?: ReadonlyMap<string, string>;
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
    totalEmployerCost: Money.zero(),
    unpaidLeaveSource: "none",
    overtimeSource: "none",
    statutoryTableCodes: [],
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
  if (paidDays <= 0) return Money.zero();
  return allocate(amount, [paidDays, periodDays - paidDays])[0] as Money;
}

/** Converts a contract amount into the run's currency. Returns null when no rate covers the pair. */
function convert(amount: Money, from: string, to: string, rates: ReadonlyMap<string, string> | undefined): Money | null {
  if (from === to) return amount;
  const raw = rates?.get(`${from}:${to}`);
  if (!raw) return null;
  const rate = Money.fromMajor(raw);
  return Money.fromScaled((amount.scaled * rate.scaled) / 1_000_000n);
}

interface EmployeePayrollInput {
  readonly employee: EmployeeRef;
  readonly contract: Contract;
  readonly paidDays: number;
  /** The contract's monthly amount expressed in the run's currency. */
  readonly monthlySalary: Money;
  readonly allowances: readonly { readonly name: string; readonly amount: Money; readonly componentId: string | null }[];
  readonly deductions: readonly { readonly name: string; readonly amount: Money; readonly componentId: string | null }[];
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

  // Resolved against the period END: a run for December 2025 computes on the
  // 2025 ceiling even if it is calculated in January. Throws when no dated
  // table covers the period, which is the whole point of dating them.
  const statutory: EgyptStatutoryRules = resolveEgyptStatutoryRules(run.periodEnd);

  const now = deps.now?.() ?? new Date().toISOString();
  const idGen = deps.idGen ?? (() => `${runId}:${Math.random().toString(36).slice(2)}`);
  const periodDays = inclusiveDays(run.periodStart, run.periodEnd);
  const dayDivisorBasis = deps.dayDivisorBasis ?? "FIXED_30";
  const divisor = payrollDayDivisor(dayDivisorBasis, periodDays);
  const dailyHours = deps.standardDailyHours ?? statutory.overtime.standardDailyHours;
  const warnings: string[] = [];

  const employees = (await deps.employees.listActive()).filter((e) => run.branchId === null || e.branchId === run.branchId);

  const inputs: EmployeePayrollInput[] = [];
  for (const employee of employees) {
    const contract = pickContract(await deps.contracts.listByEmployeeId(employee.id), run.periodStart, run.periodEnd);
    if (!contract) {
      warnings.push(`${employee.fullNameAr} (${employee.code}): لا يوجد عقد ساري خلال الفترة — تم استبعاده.`);
      continue;
    }
    if (contract.payBasis !== "monthly" && !deps.workedTime) {
      warnings.push(
        `${employee.fullNameAr} (${employee.code}): أساس الدفع "${getPayBasisLabel(contract.payBasis)}" يحتاج بيانات حضور ولم يُربط مصدر الحضور — تم استبعاده.`,
      );
      continue;
    }
    if (contract.payFrequency !== "monthly") {
      warnings.push(
        `${employee.fullNameAr} (${employee.code}): تكرار الدفع "${getPayFrequencyLabel(contract.payFrequency)}" — احتُسب راتب شهر كامل للفترة.`,
      );
    }

    const monthlySalary = convert(contract.monthlySalary, contract.currency, run.currency, deps.exchangeRates);
    if (monthlySalary === null) {
      warnings.push(
        `${employee.fullNameAr} (${employee.code}): لا يوجد سعر صرف من ${contract.currency} إلى ${run.currency} — تم استبعاده.`,
      );
      continue;
    }
    if (contract.currency !== run.currency) {
      warnings.push(
        `${employee.fullNameAr} (${employee.code}): حُوِّل العقد من ${contract.currency} إلى ${run.currency} بسعر الصرف المسجّل في ${run.periodEnd}.`,
      );
    }

    const allowances: { name: string; amount: Money; componentId: string | null }[] = [];
    const deductions: { name: string; amount: Money; componentId: string | null }[] = [];
    let lineConversionFailed = false;
    for (const allowance of contract.allowances) {
      const amount = convert(allowance.amount, contract.currency, run.currency, deps.exchangeRates);
      if (amount === null) {
        lineConversionFailed = true;
        break;
      }
      allowances.push({ name: allowance.name, amount, componentId: allowance.componentId });
    }
    for (const deduction of contract.deductions) {
      const amount = convert(deduction.amount, contract.currency, run.currency, deps.exchangeRates);
      if (amount === null) {
        lineConversionFailed = true;
        break;
      }
      deductions.push({ name: deduction.name, amount, componentId: deduction.componentId });
    }
    if (lineConversionFailed) {
      warnings.push(`${employee.fullNameAr} (${employee.code}): تعذّر تحويل بنود العقد إلى ${run.currency} — تم استبعاده.`);
      continue;
    }

    const paidStart = maxDate(maxDate(run.periodStart, contract.startDate), employee.hireDate);
    const paidEnd = minDate(run.periodEnd, contract.endDate ?? run.periodEnd);
    const paidDays = inclusiveDays(paidStart, paidEnd);
    if (paidDays <= 0) {
      warnings.push(`${employee.fullNameAr} (${employee.code}): لا توجد أيام مستحقة خلال الفترة — تم استبعاده.`);
      continue;
    }
    if (paidDays < periodDays && contract.payBasis === "monthly") {
      warnings.push(`${employee.fullNameAr} (${employee.code}): احتُسب ${paidDays} من ${periodDays} يوماً بالتناسب.`);
    }
    inputs.push({ employee, contract, paidDays, monthlySalary, allowances, deductions });
  }

  if (inputs.length === 0) throw new NoPayableEmployeesError(runId);

  if (!deps.unpaidLeave) {
    warnings.push("لم يُربط مصدر أيام الإجازات بدون أجر — لم تُخصم أي أيام إجازة بدون أجر في هذه الدورة.");
  }
  if (!deps.overtime) {
    warnings.push("لم يُربط مصدر ساعات العمل الإضافي — لم يُحتسب أي أجر إضافي في هذه الدورة.");
  }

  const components = (await deps.payrollComponents?.list()) ?? [];

  const payslips: Payslip[] = [];
  for (const { employee, contract, paidDays, monthlySalary, allowances, deductions } of inputs) {
    const lines: PayslipLine[] = [];

    // --- 1. Contract earnings ------------------------------------------------
    // The monthly-equivalent contractual wage, which is BOTH the proration base
    // and the insurable-wage base. For an hourly or daily contract there is no
    // monthly figure, so the period's actual worked time supplies it.
    let contractualMonthly = monthlySalary;
    let basicEarned: Money;
    if (contract.payBasis === "monthly") {
      basicEarned = prorate(monthlySalary, paidDays, periodDays);
    } else {
      const worked = (await deps.workedTime?.workedTimeFor(employee.id, run.periodStart, run.periodEnd)) ?? { days: 0, hours: 0 };
      const units = contract.payBasis === "daily" ? worked.days : worked.hours;
      basicEarned = Money.fromScaled((monthlySalary.scaled * BigInt(Math.round(units * 1000))) / 1000n);
      // A daily/hourly contract's "monthly wage" for insurance and tax is what
      // it actually earned this period — there is no other figure to use.
      contractualMonthly = basicEarned;
      if (units <= 0) {
        warnings.push(`${employee.fullNameAr} (${employee.code}): لا توجد ساعات أو أيام حضور مسجّلة للفترة — احتُسب صفر.`);
      }
    }

    lines.push({
      id: idGen(),
      kind: "earning",
      source: "contract_basic",
      nameAr: "الراتب الأساسي",
      amount: basicEarned,
      glAccountId: null,
      referenceId: null,
    });
    for (const allowance of allowances) {
      const amount = contract.payBasis === "monthly" ? prorate(allowance.amount, paidDays, periodDays) : allowance.amount;
      contractualMonthly = contractualMonthly.add(contract.payBasis === "monthly" ? allowance.amount : amount);
      lines.push({
        id: idGen(),
        kind: "earning",
        source: "contract_allowance",
        nameAr: allowance.name,
        amount,
        glAccountId: componentAccountId(components, allowance.componentId),
        referenceId: null,
      });
    }

    /** Basic + allowances as earned this period — the base unpaid leave is deducted from. */
    const contractEarnings = Money.sum(lines.filter((l) => l.kind === "earning").map((l) => l.amount));

    // --- 2. Overtime ---------------------------------------------------------
    if (deps.overtime) {
      const hours = await deps.overtime.overtimeHoursFor(employee.id, run.periodStart, run.periodEnd);
      const rate = hourlyRate(contractualMonthly, divisor, dailyHours);
      for (const line of overtimePay(rate, { day: hours.day, night: hours.night, restDay: hours.restDay }, statutory.overtime)) {
        lines.push({
          id: idGen(),
          kind: "earning",
          source: "overtime",
          nameAr: line.labelAr,
          amount: line.amount,
          glAccountId: null,
          referenceId: null,
        });
      }
    }

    const grossEarnings = Money.sum(lines.filter((l) => l.kind === "earning").map((l) => l.amount));

    // --- 3. Unpaid leave -----------------------------------------------------
    let unpaidLeaveDeduction = Money.zero();
    if (deps.unpaidLeave) {
      const reported = await deps.unpaidLeave.unpaidDaysFor(employee.id, run.periodStart, run.periodEnd);
      const unpaidDays = Math.min(Math.max(Math.round(reported), 0), paidDays);
      if (unpaidDays > 0) {
        unpaidLeaveDeduction = allocate(contractEarnings, [unpaidDays, Math.max(paidDays - unpaidDays, 0)])[0] as Money;
        lines.push({
          id: idGen(),
          kind: "deduction",
          source: "unpaid_leave",
          nameAr: `إجازة بدون أجر (${unpaidDays} يوم)`,
          amount: unpaidLeaveDeduction,
          glAccountId: null,
          referenceId: null,
        });
      }
    }

    /** What the state assesses: everything earned, less the days that carried no pay. */
    const taxableGross = Money.fromScaled(grossEarnings.scaled - unpaidLeaveDeduction.scaled);

    // --- 4. Social insurance -------------------------------------------------
    // The floor and ceiling are MONTHLY caps, so the full contractual monthly
    // wage is clamped first and the resulting contribution is prorated after.
    // Clamping a prorated wage would push every mid-month joiner onto the floor.
    const insurance = socialInsuranceFor(contractualMonthly, statutory.socialInsurance);
    const insuranceProration = (amount: Money): Money =>
      contract.payBasis === "monthly" ? prorate(amount, paidDays, periodDays) : amount;

    const employeeInsurance = insuranceProration(insurance.employeeTotal);
    if (employeeInsurance.scaled > 0n) {
      lines.push({
        id: idGen(),
        kind: "deduction",
        source: "social_insurance_employee",
        nameAr: `التأمينات الاجتماعية — حصة الموظف (${formatRateBp(insurance.employeeShares.reduce((s, x) => s + x.rateBp, 0))}%)`,
        amount: employeeInsurance,
        glAccountId: PAYROLL_GL_ACCOUNTS.socialInsurancePayableAccountId,
        referenceId: null,
      });
    }
    const employerInsurance = insuranceProration(insurance.employerTotal);
    if (employerInsurance.scaled > 0n) {
      lines.push({
        id: idGen(),
        kind: "employer_contribution",
        source: "social_insurance_employer",
        nameAr: `التأمينات الاجتماعية — حصة صاحب العمل (${formatRateBp(insurance.employerShares.reduce((s, x) => s + x.rateBp, 0))}%)`,
        amount: employerInsurance,
        // On an employer contribution `glAccountId` names the DEBIT (expense)
        // account; null takes the default 5130. Its credit side is routed by
        // source in post-payroll-run.ts, because the money is owed to the
        // insurance authority, not to the general withholdings pool.
        glAccountId: null,
        referenceId: null,
      });
    }
    if (insurance.cappedByCeiling) {
      warnings.push(
        `${employee.fullNameAr} (${employee.code}): الأجر التأميني بلغ الحد الأقصى ${statutory.socialInsurance.monthlyWageCeiling} — لا اشتراك على ما زاد.`,
      );
    }

    // --- 5. Salary tax -------------------------------------------------------
    const tax = monthlyIncomeTax(
      { monthlyTaxableGross: taxableGross, monthlyEmployeeInsurance: employeeInsurance },
      statutory.incomeTax,
    );
    if (tax.monthlyTax.scaled > 0n) {
      lines.push({
        id: idGen(),
        kind: "deduction",
        source: "income_tax",
        nameAr: `ضريبة كسب العمل (${formatRateBp(tax.effectiveRateBp)}% فعلي)`,
        amount: tax.monthlyTax,
        glAccountId: PAYROLL_GL_ACCOUNTS.salaryTaxPayableAccountId,
        referenceId: null,
      });
    }

    // --- 6. Levies -----------------------------------------------------------
    for (const levy of payrollLevies(taxableGross, insurance.insurableWage, statutory.levies)) {
      lines.push({
        id: idGen(),
        kind: levy.side === "employer" ? "employer_contribution" : "deduction",
        source: "statutory_levy",
        nameAr: `${levy.labelAr} (${formatRateBp(levy.rateBp)}%)`,
        amount: levy.amount,
        glAccountId: PAYROLL_GL_ACCOUNTS.deductionLiabilityAccountId,
        referenceId: null,
      });
    }

    // --- 7. Contract deductions ----------------------------------------------
    for (const deduction of deductions) {
      lines.push({
        id: idGen(),
        kind: "deduction",
        source: "contract_deduction",
        nameAr: deduction.name,
        amount: deduction.amount,
        glAccountId: componentAccountId(components, deduction.componentId),
        referenceId: null,
      });
    }

    const fixedDeductions = Money.sum(lines.filter((l) => l.kind === "deduction").map((l) => l.amount));
    let available = grossEarnings.scaled - fixedDeductions.scaled;
    if (available < 0n) {
      throw new NegativeNetPayError(employee.id, grossEarnings.toString(), fixedDeductions.toString());
    }

    // --- 8. Garnishments, then advances --------------------------------------
    // A court order outranks the employer's own loan, so it is taken first.
    for (const order of (await deps.garnishments?.listActiveFor(employee.id, run.periodEnd)) ?? []) {
      if (available <= 0n) break;
      if (order.currency !== run.currency) {
        warnings.push(`${employee.fullNameAr} (${employee.code}): الحجز ${order.reference} بعملة ${order.currency} — لم يُخصم.`);
        continue;
      }
      const owed = order.outstanding.scaled < order.monthlyAmount.scaled ? order.outstanding.scaled : order.monthlyAmount.scaled;
      if (owed <= 0n) continue;
      const take = owed < available ? owed : available;
      available -= take;
      if (take < owed) {
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
      });
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
      insurableWage: insurance.insurableWage,
      insurableWageCapped: insurance.cappedByCeiling,
      annualTaxableIncome: tax.annualTaxableIncome,
      totalEmployerCost: Money.fromScaled(grossEarnings.scaled + employerContributions.scaled),
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
    totalEmployerCost: Money.sum(payslips.map((p) => p.totalEmployerCost)),
    unpaidLeaveSource: deps.unpaidLeave ? "provider" : "none",
    overtimeSource: deps.overtime ? "provider" : "none",
    statutoryTableCodes: [
      statutory.incomeTax.code,
      statutory.socialInsurance.code,
      statutory.levies.code,
      statutory.overtime.code,
      statutory.endOfService.code,
    ],
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
    totalEmployerCost: Money.zero(),
    cancelledAt: deps.now?.() ?? new Date().toISOString(),
  };
  await deps.runs.update(cancelled);
  return cancelled;
}
