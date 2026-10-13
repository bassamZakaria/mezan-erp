import { EmployeeRefStatus } from "../hr-shared/employee-ref.js";
import { Money } from "../money/index.js";
import type { Contract } from "./contract.js";
import type { Employee } from "./employee.js";
import { resolveEndOfServiceTable } from "./egypt-statutory.js";
import { endOfServiceGratuity, serviceYearsBetween, type EndOfServiceResult } from "./statutory-payroll.js";
import { EmployeeStillEmployedError } from "./errors.js";
import { availableLeaveDays, type LeaveBalance } from "./leave-balance.js";
import { payrollDayDivisor, type PayrollDayDivisorBasis } from "./payroll-run.js";

/**
 * مستحقات نهاية الخدمة — what an employee is owed on the day they leave.
 *
 * Three separate amounts that a single "final settlement" figure would hide:
 *
 *   - GRATUITY (مكافأة نهاية الخدمة), on the statutory tier table: half a month
 *     of wage for each of the first five service years, a full month for each
 *     year after — and ONLY for an employee who has reached the table's
 *     minimum age and holds no pension entitlement covering the service.
 *     Otherwise it is zero and the statement says why.
 *   - LEAVE PAYOUT (بدل رصيد الإجازات), for leave types whose policy says the
 *     remaining balance is cashed out — priced at the daily rate, using the
 *     tenant's own day divisor so it agrees with every other payroll figure.
 *   - OUTSTANDING ADVANCES, which are recovered from the settlement rather than
 *     written off.
 *
 * This produces a settlement STATEMENT, not a posting. It is deliberately a
 * pure calculation the termination screen can show before anyone commits to it:
 * the money moves when a voucher is raised against the figures shown.
 */

export interface EndOfServiceSettlementInput {
  readonly employee: Pick<Employee, "id" | "hireDate" | "priorServiceYears" | "status" | "terminatedAt" | "birthDate" | "hasPensionEntitlement">;
  readonly contract: Pick<Contract, "monthlySalary" | "currency" | "allowances">;
  /** Last day of service, "YYYY-MM-DD". */
  readonly lastWorkingDay: string;
  /** Balances whose policy pays out on termination; the caller filters, because only the policy knows. */
  readonly payableLeaveBalances: readonly LeaveBalance[];
  /** Sum still owed on disbursed advances, in the contract currency. */
  readonly outstandingAdvances?: Money;
  readonly dayDivisorBasis?: PayrollDayDivisorBasis;
  /** Calendar days in the final month, for a CALENDAR_DAYS divisor. */
  readonly periodDays?: number;
  /**
   * Whether allowances count toward the gratuity wage. The law computes on the
   * "comprehensive wage", but which allowances are part of it is a contract
   * question, so it is the caller's call and it is recorded on the result.
   */
  readonly includeAllowancesInWage?: boolean;
}

export interface EndOfServiceSettlement {
  readonly employeeId: string;
  readonly lastWorkingDay: string;
  readonly currency: string;
  readonly serviceYears: number;
  readonly priorServiceYears: number;
  /** The monthly wage the gratuity was computed on, and whether allowances were in it. */
  readonly settlementWage: Money;
  readonly allowancesIncluded: boolean;
  readonly gratuity: EndOfServiceResult;
  readonly leavePayoutDays: string;
  readonly leavePayout: Money;
  readonly outstandingAdvances: Money;
  /** gratuity + leave payout − outstanding advances. Never negative; a shortfall is reported instead. */
  readonly netSettlement: Money;
  /** Set when advances exceed what is owed — the employer must collect the difference separately. */
  readonly advanceShortfall: Money;
  readonly statutoryTableCode: string;
  readonly citationAr: string;
  readonly verified: boolean;
}

export function calculateEndOfServiceSettlement(input: EndOfServiceSettlementInput): EndOfServiceSettlement {
  if (input.employee.status !== EmployeeRefStatus.Terminated && input.employee.terminatedAt === null) {
    throw new EmployeeStillEmployedError(input.employee.id);
  }

  const endOfService = resolveEndOfServiceTable(input.lastWorkingDay);
  const includeAllowances = input.includeAllowancesInWage ?? true;
  const allowanceTotal = includeAllowances ? Money.sum(input.contract.allowances.map((a) => a.amount)) : Money.zero();
  const settlementWage = input.contract.monthlySalary.add(allowanceTotal);

  const serviceYears = serviceYearsBetween(input.employee.hireDate, input.lastWorkingDay, input.employee.priorServiceYears);
  const gratuity = endOfServiceGratuity(settlementWage, serviceYears, endOfService, {
    birthDate: input.employee.birthDate,
    onDate: input.lastWorkingDay,
    hasPensionEntitlement: input.employee.hasPensionEntitlement,
  });

  const divisor = payrollDayDivisor(input.dayDivisorBasis ?? "FIXED_30", input.periodDays ?? 30);
  const dailyRate = divisor > 0 ? Money.fromScaled(settlementWage.scaled / BigInt(divisor)) : Money.zero();

  let payoutDayUnits = 0n;
  for (const balance of input.payableLeaveBalances) {
    const available = availableLeaveDays(balance);
    if (available.isNegative() || available.isZero()) continue;
    payoutDayUnits += available.scaled;
  }
  const leavePayout = Money.fromScaled((dailyRate.scaled * payoutDayUnits) / 1_000_000n);

  const outstandingAdvances = input.outstandingAdvances ?? Money.zero();
  const grossDue = gratuity.gratuity.scaled + leavePayout.scaled;
  const net = grossDue - outstandingAdvances.scaled;

  return {
    employeeId: input.employee.id,
    lastWorkingDay: input.lastWorkingDay,
    currency: input.contract.currency,
    serviceYears,
    priorServiceYears: input.employee.priorServiceYears,
    settlementWage,
    allowancesIncluded: includeAllowances,
    gratuity,
    leavePayoutDays: formatDays(payoutDayUnits),
    leavePayout,
    outstandingAdvances,
    netSettlement: Money.fromScaled(net > 0n ? net : 0n),
    advanceShortfall: Money.fromScaled(net < 0n ? -net : 0n),
    statutoryTableCode: endOfService.code,
    citationAr: endOfService.citationAr,
    verified: endOfService.verified,
  };
}

function formatDays(scaledDays: bigint): string {
  const whole = scaledDays / 1_000_000n;
  const frac = scaledDays % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}
