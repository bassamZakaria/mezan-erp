/**
 * Credit control — "الرقابة الائتمانية" (docs/catalog/09 §Settings, docs/catalog/01
 * §"العملاء" credit-limit fields). A pure check: given the tenant's
 * `creditControlEnabled`/`creditControlMode` settings, a customer's credit
 * limit, their current outstanding balance and the exposure a new invoice
 * would add, decide whether confirming is fine, should warn, or must block.
 *
 * WARNING mode never blocks — it only informs the confirming user/UI. BLOCK
 * mode stops the sales-invoice confirm outright (docs/catalog/01: "warn vs
 * block modes ... enforced on sales invoice confirm against customer credit
 * limit"). A credit limit of zero (the catalog's default "no limit set") never
 * triggers a check, matching the customer add-form's "الحد الائتماني" default
 * of 0 meaning unlimited, not "block everything".
 */

import { Money } from "../money/index.js";
import type { CreditControlMode } from "../settings/settings.js";

export type CreditCheckStatus = "ok" | "warning" | "blocked";

export interface CreditCheckInput {
  readonly enabled: boolean;
  readonly mode: CreditControlMode;
  readonly creditLimit: Money;
  /** Outstanding balance BEFORE the invoice being confirmed. */
  readonly currentBalance: Money;
  /** This invoice's own grand total (its contribution to the customer's exposure). */
  readonly newExposure: Money;
}

export interface CreditCheckResult {
  readonly status: CreditCheckStatus;
  /** currentBalance + newExposure. */
  readonly projectedBalance: Money;
  /** projectedBalance − creditLimit, floored at zero. */
  readonly overBy: Money;
  readonly message: string | null;
}

export function checkCustomerCredit(input: CreditCheckInput): CreditCheckResult {
  const projectedBalance = input.currentBalance.add(input.newExposure);

  if (!input.enabled || input.creditLimit.scaled <= 0n || projectedBalance.scaled <= input.creditLimit.scaled) {
    return { status: "ok", projectedBalance, overBy: Money.zero(), message: null };
  }

  const overBy = Money.fromScaled(projectedBalance.scaled - input.creditLimit.scaled);
  const message = `تجاوز الحد الائتماني بمبلغ ${overBy.toString()} — الحد ${input.creditLimit.toString()}، الرصيد المتوقع بعد هذه الفاتورة ${projectedBalance.toString()}.`;

  if (input.mode === "BLOCK") {
    return { status: "blocked", projectedBalance, overBy, message };
  }
  return { status: "warning", projectedBalance, overBy, message };
}
