import { Qty } from "../money/index.js";
import type { EmployeeDirectory } from "../hr-shared/employee-ref.js";
import { InvalidLeaveAccrualBatchError, InvalidLeaveBalanceError, LeaveBalanceExceededError } from "./errors.js";
import { accrualDaysPerPeriod, type LeaveAccrualFrequency, type LeavePolicy, type LeavePolicyRepository } from "./leave-policy.js";
import { isUnpaidLeaveType, type LeaveRequestRepository, type LeaveType } from "./leave-request.js";
import type { ReasonInput } from "../bilingual-reasons.js";

/**
 * Leave balances + accrual batches — docs/archive/catalog/06-crm-hr.md
 * "استحقاقات الإجازات" (`/hr/leave/batches`). A balance is one employee's
 * running position in one leave type for one year; an accrual batch is the
 * periodic run that credits entitlement across every eligible employee.
 */

export interface LeaveBalance {
  readonly id: string;
  readonly employeeId: string;
  readonly leaveType: LeaveType;
  /** Calendar year the balance belongs to. */
  readonly year: number;
  /** Days credited by accrual runs so far this year. */
  readonly entitled: Qty;
  /** Days rolled in from the previous year under the policy's carry-over rule. */
  readonly carriedOver: Qty;
  /** Days consumed by approved leave requests. */
  readonly used: Qty;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function availableLeaveDays(balance: Pick<LeaveBalance, "entitled" | "carriedOver" | "used">): Qty {
  return balance.entitled.add(balance.carriedOver).subtract(balance.used);
}

export interface LeaveBalanceFilter {
  readonly employeeId?: string | null;
  readonly leaveType?: LeaveType | null;
  readonly year?: number | null;
}

/** Persistence port for leave balances. The domain depends on this interface only. */
export interface LeaveBalanceRepository {
  findById(id: string): Promise<LeaveBalance | null>;
  find(employeeId: string, leaveType: LeaveType, year: number): Promise<LeaveBalance | null>;
  list(filter?: LeaveBalanceFilter): Promise<LeaveBalance[]>;
  create(balance: LeaveBalance): Promise<void>;
  update(balance: LeaveBalance): Promise<void>;
}

export interface CreateLeaveBalanceCommand {
  readonly id: string;
  readonly employeeId: string;
  readonly leaveType: LeaveType;
  readonly year: number;
  readonly entitled?: Qty;
  readonly carriedOver?: Qty;
  readonly used?: Qty;
}

function validateBalance(balance: Pick<LeaveBalance, "employeeId" | "year" | "entitled" | "carriedOver" | "used">): ReasonInput[] {
  const reasons: ReasonInput[] = [];
  if (balance.employeeId.trim().length === 0) reasons.push({ ar: "الموظف مطلوب", en: "The employee is required" });
  if (!Number.isInteger(balance.year) || balance.year < 2000) reasons.push({ ar: "السنة غير صالحة", en: "The year is invalid" });
  if (balance.entitled.isNegative()) reasons.push({ ar: "الرصيد المستحق لا يمكن أن يكون سالباً", en: "The entitled balance cannot be negative" });
  if (balance.carriedOver.isNegative()) reasons.push({ ar: "الرصيد المرحّل لا يمكن أن يكون سالباً", en: "The carried-over balance cannot be negative" });
  if (balance.used.isNegative()) reasons.push({ ar: "الرصيد المستخدم لا يمكن أن يكون سالباً", en: "The used balance cannot be negative" });
  return reasons;
}

export function createLeaveBalance(command: CreateLeaveBalanceCommand, now: () => string = () => new Date().toISOString()): LeaveBalance {
  const timestamp = now();
  const balance: LeaveBalance = {
    id: command.id,
    employeeId: command.employeeId,
    leaveType: command.leaveType,
    year: command.year,
    entitled: command.entitled ?? Qty.zero(),
    carriedOver: command.carriedOver ?? Qty.zero(),
    used: command.used ?? Qty.zero(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const reasons = validateBalance(balance);
  if (reasons.length > 0) throw new InvalidLeaveBalanceError(reasons);
  return balance;
}

export type LeaveBalancePatch = Partial<Pick<LeaveBalance, "entitled" | "carriedOver" | "used">>;

export function adjustLeaveBalance(current: LeaveBalance, patch: LeaveBalancePatch, now: () => string = () => new Date().toISOString()): LeaveBalance {
  const next: LeaveBalance = { ...current, ...patch, updatedAt: now() };
  const reasons = validateBalance(next);
  if (reasons.length > 0) throw new InvalidLeaveBalanceError(reasons);
  return next;
}

// --- Accrual batches -------------------------------------------------------

export type LeaveAccrualRunType = "manual" | "scheduled";

export interface LeaveAccrualLine {
  readonly employeeId: string;
  readonly leaveType: LeaveType;
  readonly days: Qty;
}

export interface LeaveAccrualBatch {
  readonly id: string;
  /** LAB-###### numbering-engine number. */
  readonly number: string;
  /**
   * Period identity the run is idempotent on — "YYYY-MM" for a monthly
   * accrual, "YYYY" for an annual one. The repository enforces uniqueness on
   * this column: re-running a period must never double-credit a balance.
   */
  readonly periodKey: string;
  readonly frequency: LeaveAccrualFrequency;
  readonly runType: LeaveAccrualRunType;
  readonly runDate: string;
  readonly notes: string | null;
  readonly employeeCount: number;
  readonly totalDays: Qty;
  readonly lines: readonly LeaveAccrualLine[];
  readonly runBy: string | null;
  readonly createdAt: string;
}

export interface LeaveAccrualBatchFilter {
  readonly runType?: LeaveAccrualRunType | null;
}

/** Persistence port for accrual batches. The domain depends on this interface only. */
export interface LeaveAccrualBatchRepository {
  findById(id: string): Promise<LeaveAccrualBatch | null>;
  findByPeriodKey(periodKey: string): Promise<LeaveAccrualBatch | null>;
  list(filter?: LeaveAccrualBatchFilter): Promise<LeaveAccrualBatch[]>;
  create(batch: LeaveAccrualBatch): Promise<void>;
}

const MONTHLY_PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const ANNUAL_PERIOD = /^\d{4}$/;

/** Derives the period key a `runDate` falls in for the given accrual frequency. */
export function accrualPeriodKey(runDate: string, frequency: LeaveAccrualFrequency): string {
  return frequency === "monthly" ? runDate.slice(0, 7) : runDate.slice(0, 4);
}

export interface RunLeaveAccrualCommand {
  readonly id: string;
  /** LAB-###### — assigned by the caller via the numbering engine. */
  readonly number: string;
  readonly runDate: string;
  readonly frequency: Exclude<LeaveAccrualFrequency, "none">;
  readonly runType?: LeaveAccrualRunType;
  readonly notes?: string | null;
  readonly runBy?: string | null;
}

export interface RunLeaveAccrualDeps {
  readonly batches: LeaveAccrualBatchRepository;
  readonly balances: LeaveBalanceRepository;
  readonly policies: LeavePolicyRepository;
  readonly employees: EmployeeDirectory;
  readonly generateId: () => string;
}

export interface RunLeaveAccrualResult {
  readonly batch: LeaveAccrualBatch;
  /**
   * False when a batch for this period already existed — nothing was credited.
   * The idempotency guarantee the catalog's "run now" button depends on.
   */
  readonly created: boolean;
}

function validateRun(command: RunLeaveAccrualCommand, periodKey: string): ReasonInput[] {
  const reasons: ReasonInput[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(command.runDate)) reasons.push({ ar: "تاريخ التشغيل مطلوب بصيغة YYYY-MM-DD", en: "The run date is required in the format YYYY-MM-DD" });
  const valid = command.frequency === "monthly" ? MONTHLY_PERIOD.test(periodKey) : ANNUAL_PERIOD.test(periodKey);
  if (!valid) reasons.push({ ar: "فترة الاستحقاق غير صالحة", en: "The accrual period is invalid" });
  return reasons;
}

/**
 * Runs one leave-accrual cycle across every non-terminated employee, crediting
 * each active policy's per-period entitlement onto the matching balance.
 *
 * Idempotent per `periodKey`: a batch already recorded for the period short
 * circuits and returns `created: false` WITHOUT touching a single balance, so
 * a double-click, a retried request or a scheduler catch-up cannot double-credit.
 */
export async function runLeaveAccrual(
  command: RunLeaveAccrualCommand,
  deps: RunLeaveAccrualDeps,
  now: () => string = () => new Date().toISOString(),
): Promise<RunLeaveAccrualResult> {
  const periodKey = accrualPeriodKey(command.runDate, command.frequency);
  const reasons = validateRun(command, periodKey);
  if (reasons.length > 0) throw new InvalidLeaveAccrualBatchError(reasons);

  const existing = await deps.batches.findByPeriodKey(periodKey);
  if (existing) return { batch: existing, created: false };

  const year = Number(periodKey.slice(0, 4));
  const policies = (await deps.policies.list()).filter((p): p is LeavePolicy => p.active && p.accrualFrequency === command.frequency);
  const employees = await deps.employees.listActive();

  const lines: LeaveAccrualLine[] = [];
  const creditedEmployees = new Set<string>();
  let totalDays = Qty.zero();

  for (const employee of employees) {
    for (const policy of policies) {
      const days = accrualDaysPerPeriod(policy, command.frequency);
      if (days.isZero()) continue;

      const balance = await deps.balances.find(employee.id, policy.leaveType, year);
      if (balance) {
        await deps.balances.update(adjustLeaveBalance(balance, { entitled: balance.entitled.add(days) }, now));
      } else {
        await deps.balances.create(
          createLeaveBalance({ id: deps.generateId(), employeeId: employee.id, leaveType: policy.leaveType, year, entitled: days }, now),
        );
      }

      lines.push({ employeeId: employee.id, leaveType: policy.leaveType, days });
      creditedEmployees.add(employee.id);
      totalDays = totalDays.add(days);
    }
  }

  const batch: LeaveAccrualBatch = {
    id: command.id,
    number: command.number,
    periodKey,
    frequency: command.frequency,
    runType: command.runType ?? "manual",
    runDate: command.runDate,
    notes: command.notes ?? null,
    employeeCount: creditedEmployees.size,
    totalDays,
    lines,
    runBy: command.runBy ?? null,
    createdAt: now(),
  };
  await deps.batches.create(batch);
  return { batch, created: true };
}

/**
 * Refuses an approval the employee's balance cannot cover.
 *
 * Unpaid leave is exempt by definition — it draws on no entitlement — and a
 * missing balance row counts as zero available, which is the case that used to
 * slip through: with no row at all, nothing was there to compare against.
 */
export function assertLeaveBalanceCovers(
  leaveType: LeaveType,
  requestedDays: number,
  balance: Pick<LeaveBalance, "entitled" | "carriedOver" | "used"> | null,
): void {
  if (isUnpaidLeaveType(leaveType)) return;
  const available = balance ? Number(availableLeaveDays(balance).toString()) : 0;
  if (requestedDays > available) throw new LeaveBalanceExceededError(requestedDays, available);
}

/**
 * Consumes `days` of an employee's balance for an approved leave request. A
 * missing balance row is created at zero first, so approving leave the tenant
 * never accrued for still records the consumption (the balance simply goes
 * negative, which the matrix surfaces).
 */
export async function consumeLeaveBalance(
  employeeId: string,
  leaveType: LeaveType,
  year: number,
  days: Qty,
  deps: Pick<LeaveBalanceRepository, "find" | "create" | "update">,
  generateId: () => string,
  now: () => string = () => new Date().toISOString(),
): Promise<LeaveBalance> {
  const existing = await deps.find(employeeId, leaveType, year);
  if (!existing) {
    const created = createLeaveBalance({ id: generateId(), employeeId, leaveType, year, used: days }, now);
    await deps.create(created);
    return created;
  }
  const next = adjustLeaveBalance(existing, { used: existing.used.add(days) }, now);
  await deps.update(next);
  return next;
}

/**
 * Returns `days` to an employee's balance when an APPROVED leave request is
 * cancelled — the reverse of `consumeLeaveBalance`.
 *
 * Without it the balance keeps counting leave that was never taken: the
 * request reads ملغى while the matrix still shows the days as used. Consumption
 * never goes below zero, so a balance whose row was rebuilt after the approval
 * cannot be driven negative by the release.
 */
export async function releaseLeaveBalance(
  employeeId: string,
  leaveType: LeaveType,
  year: number,
  days: Qty,
  deps: Pick<LeaveBalanceRepository, "find" | "update">,
  now: () => string = () => new Date().toISOString(),
): Promise<LeaveBalance | null> {
  const existing = await deps.find(employeeId, leaveType, year);
  if (!existing) return null;
  const released = existing.used.subtract(days);
  const next = adjustLeaveBalance(existing, { used: released.isNegative() ? Qty.zero() : released }, now);
  await deps.update(next);
  return next;
}

/**
 * Binds the leave layer behind payroll's `UnpaidLeaveDaysProvider` seam
 * (`payroll-run.ts`): the number of APPROVED unpaid-leave days that fall
 * inside a payroll period, which the run prorates the month's salary by.
 * Only the portion of a request that overlaps the period counts.
 */
export function createUnpaidLeaveDaysProvider(repo: Pick<LeaveRequestRepository, "listByEmployeeId">): {
  unpaidDaysFor(employeeId: string, periodStart: string, periodEnd: string): Promise<number>;
} {
  return {
    async unpaidDaysFor(employeeId, periodStart, periodEnd) {
      const requests = await repo.listByEmployeeId(employeeId);
      return requests
        .filter((r) => r.status === "approved" && isUnpaidLeaveType(r.leaveType) && r.startDate <= periodEnd && r.endDate >= periodStart)
        .reduce((sum, r) => {
          if (r.halfDay) return sum + r.days;
          const from = r.startDate > periodStart ? r.startDate : periodStart;
          const to = r.endDate < periodEnd ? r.endDate : periodEnd;
          const start = new Date(`${from}T00:00:00Z`).getTime();
          const end = new Date(`${to}T00:00:00Z`).getTime();
          return sum + Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
        }, 0);
    },
  };
}
