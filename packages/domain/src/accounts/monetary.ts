import type { AccountType } from "./account.js";

/**
 * Account types whose balance is a **monetary item** under IAS 21 ¶8 — a right
 * to receive or an obligation to pay a fixed number of currency units, which
 * ¶23(a) retranslates at each closing rate: receivables, payables, cash, bank
 * and loans.
 *
 * Revenue, expense and equity are not. A foreign receipt credits its revenue
 * account once, at the spot rate of the day the income was earned (¶21), and
 * that entry is final — ¶23(b) leaves a non-monetary item at its historical
 * rate. Collecting one as an open position put GL 4910 إيرادات أخرى in the
 * preview as USD 1,200.00 booked at 58,680.00 and restated the whole tenant by
 * 540.00 every month end, for income settled the day it was booked (D322).
 * A memorandum account is off balance sheet and never restated at all.
 */
const MONETARY_ACCOUNT_TYPES: ReadonlySet<AccountType> = new Set<AccountType>(["asset", "liability"]);

/** Whether a balance on this account is a monetary item an FX revaluation restates. */
export function isMonetaryAccountType(type: AccountType): boolean {
  return MONETARY_ACCOUNT_TYPES.has(type);
}
