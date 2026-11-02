import { InvalidPayrollComponentError } from "./errors.js";
import type { PayslipLineKind } from "./payroll-run.js";
import type { ReasonInput } from "../bilingual-reasons.js";

/**
 * مكوّنات الرواتب — the tenant's registry of earning, deduction and
 * employer-contribution components, each routed to its own GL account (R10.7,
 * the payroll half of the account-routing screen R6.1).
 *
 * Before this, a contract's allowance and deduction lines were free text with
 * an amount: "بدل انتقال" and "خصم تأمين" landed in the same two accounts —
 * 5120 for everything earned and 2190 for everything withheld — so the books
 * could never separate a transport allowance from overtime, or a social-
 * insurance withholding from a disciplinary penalty. A component binds the
 * line to a REAL entity whose `glAccountId` the payroll posting reads, and the
 * payslip line carries that account instead of falling back to the run default.
 */

export type PayrollComponentKind = PayslipLineKind;

export interface PayrollComponent {
  readonly id: string;
  /** Stable tenant-facing code, unique across the registry. */
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly kind: PayrollComponentKind;
  /**
   * The GL account this component posts to: the DEBIT account for an earning
   * or employer contribution, the CREDIT account for a deduction. Null falls
   * back to the run's default account for that kind.
   */
  readonly glAccountId: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PayrollComponentFilter {
  readonly kind?: PayrollComponentKind | null;
  readonly active?: boolean | null;
}

/** Persistence port for payroll components. The domain depends on this interface only. */
export interface PayrollComponentRepository {
  findById(id: string): Promise<PayrollComponent | null>;
  findByCode(code: string): Promise<PayrollComponent | null>;
  list(filter?: PayrollComponentFilter): Promise<PayrollComponent[]>;
  create(component: PayrollComponent): Promise<void>;
  update(component: PayrollComponent): Promise<void>;
}

export interface CreatePayrollComponentCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly kind: PayrollComponentKind;
  readonly glAccountId?: string | null;
  readonly active?: boolean;
}

function validate(component: Pick<PayrollComponent, "code" | "nameAr">): ReasonInput[] {
  const reasons: ReasonInput[] = [];
  if (component.code.trim().length === 0) reasons.push({ ar: "كود المكوّن مطلوب", en: "The component code is required" });
  if (component.nameAr.trim().length === 0) reasons.push({ ar: "اسم المكوّن بالعربية مطلوب", en: "The Arabic component name is required" });
  return reasons;
}

export function createPayrollComponent(
  command: CreatePayrollComponentCommand,
  now: () => string = () => new Date().toISOString(),
): PayrollComponent {
  const timestamp = now();
  const component: PayrollComponent = {
    id: command.id,
    code: command.code.trim(),
    nameAr: command.nameAr.trim(),
    nameEn: command.nameEn?.trim() || null,
    kind: command.kind,
    glAccountId: command.glAccountId ?? null,
    active: command.active ?? true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const reasons = validate(component);
  if (reasons.length > 0) throw new InvalidPayrollComponentError(reasons);
  return component;
}

export type PayrollComponentPatch = Partial<Pick<PayrollComponent, "nameAr" | "nameEn" | "glAccountId" | "active">>;

export function updatePayrollComponent(
  current: PayrollComponent,
  patch: PayrollComponentPatch,
  now: () => string = () => new Date().toISOString(),
): PayrollComponent {
  const next: PayrollComponent = { ...current, ...patch, updatedAt: now() };
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidPayrollComponentError(reasons);
  return next;
}

/**
 * Resolves the GL account a contract line should post to. A line bound to no
 * component — or to one the registry no longer holds — resolves to null, which
 * the posting reads as "use the run's default for this kind".
 */
export function componentAccountId(components: readonly PayrollComponent[], componentId: string | null): string | null {
  if (componentId === null) return null;
  return components.find((component) => component.id === componentId)?.glAccountId ?? null;
}
