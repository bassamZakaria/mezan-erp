import { Money } from "../money/index.js";
import type { EmployeeDirectory } from "../hr-shared/employee-ref.js";
import type { LeavePolicyRepository } from "../hr-leave-policies/index.js";
import type { LeaveAccrualBatch, LeaveAccrualBatchRepository, LeaveAccrualLine, LeaveAccrualRunType } from "./accrual-batch.js";
import { DuplicateAccrualPeriodError, NoAccruableEmployeesError } from "./errors.js";

export interface CreateAccrualBatchCommand {
  readonly id: string;
  /** ISO date (YYYY-MM-DD) — "تاريخ التشغيل". */
  readonly runDate: string;
  readonly runType: LeaveAccrualRunType;
  readonly executedBy?: string | null;
  readonly now?: () => string;
}

export interface CreateAccrualBatchDeps {
  readonly batches: LeaveAccrualBatchRepository;
  readonly employees: EmployeeDirectory;
  readonly policies: LeavePolicyRepository;
  /** Per-employee daily leave-value rate for the GL posting. Contract/payroll salary data doesn't exist in this module's scope yet — a caller with real salary data supplies a real resolver; the wiring default returns `Money.zero()` so the batch still runs (crediting balances) without a bogus monetary figure. */
  readonly dailyRate: (employeeId: string) => Promise<Money>;
}

function periodOf(runDate: string): string {
  return runDate.slice(0, 7);
}

function scaleMoneyByDays(rate: Money, days: number): Money {
  return Money.fromScaled(Math.round(rate.toScaledNumber() * days));
}

/**
 * Builds a مسودة (draft) accrual batch for the period containing `runDate`:
 * rejects a duplicate non-cancelled batch for the same period (idempotent per
 * period), then for every active employee × every leave type with a periodic
 * accrual policy (`accrualFrequency !== "NONE"`), computes the days due —
 * `baseBalanceDays / 12` for a MONTHLY-accrual type every run, the full
 * `baseBalanceDays` for an ANNUAL-accrual type only on a January run — and
 * keeps only non-zero lines. Rejects an empty result.
 */
export async function createAccrualBatch(
  cmd: CreateAccrualBatchCommand,
  deps: CreateAccrualBatchDeps,
): Promise<LeaveAccrualBatch> {
  const period = periodOf(cmd.runDate);

  const existing = await deps.batches.findByPeriod(period);
  if (existing && existing.status !== "cancelled") {
    throw new DuplicateAccrualPeriodError(period);
  }

  const month = Number(period.slice(5, 7));
  const employees = await deps.employees.listActive();
  const effectivePolicies = (await deps.policies.listEffective(cmd.runDate)).filter(
    (p) => p.accrualFrequency !== "NONE",
  );

  const lines: LeaveAccrualLine[] = [];
  for (const employee of employees) {
    const rate = await deps.dailyRate(employee.id);
    for (const policy of effectivePolicies) {
      let creditedDays = 0;
      if (policy.accrualFrequency === "MONTHLY") {
        creditedDays = Math.round((policy.baseBalanceDays / 12) * 100) / 100;
      } else if (policy.accrualFrequency === "ANNUAL" && month === 1) {
        creditedDays = policy.baseBalanceDays;
      }
      if (creditedDays <= 0) continue;
      lines.push({
        employeeId: employee.id,
        leaveTypeCode: policy.leaveTypeCode,
        creditedDays,
        value: scaleMoneyByDays(rate, creditedDays),
      });
    }
  }

  if (lines.length === 0) {
    throw new NoAccruableEmployeesError(period);
  }

  const batch: LeaveAccrualBatch = {
    id: cmd.id,
    period,
    runDate: cmd.runDate,
    runType: cmd.runType,
    status: "draft",
    lines,
    totalDays: lines.reduce((sum, l) => sum + l.creditedDays, 0),
    totalValue: Money.sum(lines.map((l) => l.value)),
    journalEntryId: null,
    executedBy: cmd.executedBy ?? null,
    createdAt: cmd.now?.() ?? new Date().toISOString(),
    postedAt: null,
  };
  await deps.batches.create(batch);
  return batch;
}
