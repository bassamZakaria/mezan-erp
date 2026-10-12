import { Money } from "../money/index.js";
import { InvalidGarnishmentError } from "./errors.js";
import type { Garnishment, GarnishmentKind, GarnishmentProvider } from "./payroll-run.js";

export type { GarnishmentKind } from "./payroll-run.js";

/**
 * الحجز على الأجر — a court-ordered or agreed deduction from wages.
 *
 * NOT an employee advance, and the difference is the whole point: an advance is
 * money the employer lent and is recovering, so it sits on the balance sheet as
 * an asset (1160). A garnishment is money the employer never lent — it belongs
 * to a third party the moment it is withheld, so it is a LIABILITY (2193) owed
 * to whoever the order names.
 *
 * That is also why payroll takes garnishments BEFORE advance recovery: an
 * employer cannot prefer its own loan over an order it is legally compelled to
 * honour. Where the net will not stretch to both, the advance instalment is the
 * one that carries forward.
 */

export interface GarnishmentKindDefinition {
  readonly code: GarnishmentKind;
  readonly labelAr: string;
}

export const GARNISHMENT_KIND_DEFINITIONS: readonly GarnishmentKindDefinition[] = [
  { code: "court_order", labelAr: "حكم قضائي" },
  { code: "alimony", labelAr: "نفقة" },
  { code: "debt_settlement", labelAr: "تسوية دين" },
  { code: "union_dues", labelAr: "اشتراك نقابي" },
  { code: "other", labelAr: "أخرى" },
] as const;

export function getGarnishmentKindLabel(kind: GarnishmentKind): string {
  return GARNISHMENT_KIND_DEFINITIONS.find((d) => d.code === kind)?.labelAr ?? kind;
}

export interface GarnishmentRecord extends Garnishment {
  readonly kind: GarnishmentKind;
  /** The total the order is for; `outstanding` counts down from it as payroll withholds. */
  readonly totalAmount: Money;
  readonly recovered: Money;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GarnishmentFilter {
  readonly employeeId?: string | null;
  readonly active?: boolean | null;
}

export interface GarnishmentRepository {
  findById(id: string): Promise<GarnishmentRecord | null>;
  list(filter?: GarnishmentFilter): Promise<GarnishmentRecord[]>;
  listByEmployeeId(employeeId: string): Promise<GarnishmentRecord[]>;
  create(record: GarnishmentRecord): Promise<void>;
  update(record: GarnishmentRecord): Promise<void>;
}

export interface CreateGarnishmentCommand {
  readonly id: string;
  readonly employeeId: string;
  readonly kind: GarnishmentKind;
  /** The order's own reference — case number, agreement number. Free text, but required. */
  readonly reference: string;
  readonly labelAr: string;
  readonly totalAmount: Money;
  readonly monthlyAmount: Money;
  readonly currency: string;
  readonly startDate: string;
  readonly endDate?: string | null;
  readonly notes?: string | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validate(command: CreateGarnishmentCommand): string[] {
  const reasons: string[] = [];
  if (command.employeeId.trim().length === 0) reasons.push("الموظف مطلوب");
  if (command.reference.trim().length === 0) reasons.push("رقم السند أو الحكم مطلوب");
  if (command.labelAr.trim().length === 0) reasons.push("بيان الحجز مطلوب");
  if (!DATE_PATTERN.test(command.startDate)) reasons.push("تاريخ البداية مطلوب بصيغة YYYY-MM-DD");
  if (command.endDate && !DATE_PATTERN.test(command.endDate)) reasons.push("تاريخ النهاية غير صالح");
  if (command.endDate && command.endDate < command.startDate) reasons.push("تاريخ النهاية قبل تاريخ البداية");
  if (command.totalAmount.scaled <= 0n) reasons.push("إجمالي مبلغ الحجز يجب أن يكون أكبر من صفر");
  if (command.monthlyAmount.scaled <= 0n) reasons.push("القسط الشهري يجب أن يكون أكبر من صفر");
  if (command.monthlyAmount.scaled > command.totalAmount.scaled) reasons.push("القسط الشهري لا يمكن أن يتجاوز إجمالي مبلغ الحجز");
  if (command.currency.trim().length === 0) reasons.push("العملة مطلوبة");
  return reasons;
}

export function createGarnishment(command: CreateGarnishmentCommand, now: () => string = () => new Date().toISOString()): GarnishmentRecord {
  const reasons = validate(command);
  if (reasons.length > 0) throw new InvalidGarnishmentError(reasons);
  const timestamp = now();
  return {
    id: command.id,
    employeeId: command.employeeId,
    kind: command.kind,
    reference: command.reference.trim(),
    labelAr: command.labelAr.trim(),
    totalAmount: command.totalAmount,
    monthlyAmount: command.monthlyAmount,
    currency: command.currency,
    startDate: command.startDate,
    endDate: command.endDate ?? null,
    outstanding: command.totalAmount,
    recovered: Money.zero(),
    notes: command.notes ?? null,
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Applies what a payroll run actually withheld. An order whose outstanding
 * reaches zero deactivates itself — payroll must never keep deducting against a
 * satisfied order, which is the garnishment equivalent of the "same goods
 * returnable forever" defect.
 */
export function applyGarnishmentRecovery(
  current: GarnishmentRecord,
  amount: Money,
  now: () => string = () => new Date().toISOString(),
): GarnishmentRecord {
  if (amount.scaled <= 0n) return current;
  const applied = amount.scaled > current.outstanding.scaled ? current.outstanding.scaled : amount.scaled;
  const outstanding = Money.fromScaled(current.outstanding.scaled - applied);
  return {
    ...current,
    outstanding,
    recovered: Money.fromScaled(current.recovered.scaled + applied),
    active: outstanding.scaled > 0n && current.active,
    updatedAt: now(),
  };
}

/** Takes back what a payroll run withheld when that run's approval is reversed; an order the withholding had completed is in force again. */
export function reverseGarnishmentRecovery(
  current: GarnishmentRecord,
  amount: Money,
  now: () => string = () => new Date().toISOString(),
): GarnishmentRecord {
  if (amount.scaled <= 0n) return current;
  const undone = amount.scaled > current.recovered.scaled ? current.recovered.scaled : amount.scaled;
  return {
    ...current,
    outstanding: Money.fromScaled(current.outstanding.scaled + undone),
    recovered: Money.fromScaled(current.recovered.scaled - undone),
    active: current.active || current.outstanding.scaled === 0n,
    updatedAt: now(),
  };
}

/** Stops an order early — released, appealed, or superseded. */
export function releaseGarnishment(current: GarnishmentRecord, now: () => string = () => new Date().toISOString()): GarnishmentRecord {
  return { ...current, active: false, updatedAt: now() };
}

/**
 * Binds the register to payroll's seam: only orders that are active, still owed
 * something, and in force on the payroll date are handed over.
 */
export function createGarnishmentProvider(repo: Pick<GarnishmentRepository, "listByEmployeeId">): GarnishmentProvider {
  return {
    async listActiveFor(employeeId, onDate) {
      const records = await repo.listByEmployeeId(employeeId);
      return records.filter(
        (r) => r.active && r.outstanding.scaled > 0n && r.startDate <= onDate && (r.endDate === null || r.endDate >= onDate),
      );
    },
  };
}
