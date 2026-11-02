import { AccountStatusCode, AccountTypeCode, VoucherPaymentMethodCode, VoucherTypeCode } from "@mezan/contracts";
import type { Account } from "../accounts/account.js";
import type { VoucherPaymentMethod, VoucherType } from "./voucher-types.js";

const COMMISSION_PAYMENT_METHODS: ReadonlySet<VoucherPaymentMethod> = new Set([VoucherPaymentMethodCode.Bank, VoucherPaymentMethodCode.Card, VoucherPaymentMethodCode.Wallet]);

export function transferCommissionApplies(voucherType: VoucherType, paymentMethod: VoucherPaymentMethod): boolean {
  return voucherType === VoucherTypeCode.CustomerCollection && COMMISSION_PAYMENT_METHODS.has(paymentMethod);
}

export function isCommissionExpenseAccount(account: Pick<Account, "type" | "isHeader" | "status">): boolean {
  return account.type === AccountTypeCode.Expense && !account.isHeader && account.status === AccountStatusCode.Active;
}
