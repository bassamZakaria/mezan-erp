/**
 * Credit control (الرقابة الائتمانية) — docs/archive/catalog/01/09. Enforced on sales
 * invoice confirm against the customer's credit limit, in either WARNING or
 * BLOCK mode (tenant setting).
 */

export {
  checkCustomerCredit,
  type CreditCheckStatus,
  type CreditCheckInput,
  type CreditCheckResult,
} from "./credit-check.js";

export { CreditLimitExceededError } from "./errors.js";
