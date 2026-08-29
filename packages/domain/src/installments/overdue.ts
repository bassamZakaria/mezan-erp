/**
 * معالجة المتأخرات (docs/archive/catalog/05 §"خطط الأقساط") — the overdue batch:
 * flips any `pending` installment whose due date has passed into `overdue`,
 * and (per the product's own confirm-dialog copy: "تطبيق غرامات التأخير —
 * تلقائي") applies a late-payment penalty.
 *
 * LATE-FEE CONFIG IS UNDEFINED (docs/archive/catalog/05 §"إعدادات الأقساط — NOT
 * FOUND AS A DEDICATED SCREEN"): the recon confirms the batch is supposed to
 * apply penalties, but no settings screen/field for the rate, grace period,
 * or flat-vs-percent shape was found anywhere — flagged there as possibly
 * platform-managed (same pattern as the loyalty-points toggle) or simply not
 * yet built. `computeLateFee` below is therefore an explicit STUB that always
 * returns zero; `LateFeeConfig`'s fields are typed and threaded through so
 * wiring the real rule is a drop-in change once product defines it — nothing
 * else in this module needs to change.
 */

import { Money } from "../money/index.js";
import type { InstallmentLine, InstallmentPlanDocument } from "./installment-plan-document.js";

export interface LateFeeConfig {
  /** TODO(late-fee-config): undefined by product — days past due before a fee applies. Unused by the stub. */
  readonly graceDays?: number;
  /** TODO(late-fee-config): undefined by product — percentage of the installment amount. Unused by the stub. */
  readonly feePercent?: number;
  /** TODO(late-fee-config): undefined by product — flat fee per overdue installment. Unused by the stub. */
  readonly flatFee?: Money;
}

export interface OverdueProcessingResult {
  readonly updatedPlans: readonly InstallmentPlanDocument[];
  readonly newlyOverdueCount: number;
  /** Always `Money.zero()` — see the module doc-comment. */
  readonly totalLateFeesApplied: Money;
}

/** TODO(late-fee-config): wire the real calculation here once product defines `LateFeeConfig`'s rule. */
function computeLateFee(_line: InstallmentLine, _asOfDate: string, _config: LateFeeConfig): Money {
  return Money.zero();
}

/**
 * Pure: given every currently-confirmed plan and "today", returns updated
 * copies with newly-overdue lines flipped (input plans are never mutated).
 * Only `pending` lines on a `confirmed` plan are eligible — `paid`/`cancelled`
 * lines and plans not yet confirmed are left untouched.
 */
export function processOverdueInstallments(
  plans: readonly InstallmentPlanDocument[],
  asOfDate: string,
  lateFeeConfig: LateFeeConfig = {},
): OverdueProcessingResult {
  let newlyOverdueCount = 0;
  let totalLateFeesApplied = Money.zero();

  const updatedPlans = plans.map((plan) => {
    if (plan.status !== "confirmed") return plan;
    let changed = false;
    const lines = plan.lines.map((line) => {
      if (line.status !== "pending" || line.dueDate >= asOfDate) return line;
      changed = true;
      newlyOverdueCount += 1;
      const fee = computeLateFee(line, asOfDate, lateFeeConfig);
      totalLateFeesApplied = totalLateFeesApplied.add(fee);
      return { ...line, status: "overdue" as const, lateFeeAmount: line.lateFeeAmount.add(fee) };
    });
    return changed ? { ...plan, lines } : plan;
  });

  return { updatedPlans, newlyOverdueCount, totalLateFeesApplied };
}
