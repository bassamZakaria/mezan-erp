import { describe, expect, it } from "vitest";
import {
  CustomerContactMissingError,
  DunningHoldNotFoundError,
  DunningReminderNotFoundError,
  DunningReminderNotSendableError,
  InvalidDunningPolicyError,
  InvalidPromiseToPayError,
  PromiseToPayNotFoundError,
  SmsProviderNotConfiguredError,
} from "./collections/errors.js";
import { DunningChannel } from "./collections/types.js";
import { assertValidDunningPolicy, defaultDunningPolicy } from "./collections/policy.js";
import { ChequeBankRateMissingError } from "./cheques/errors.js";
import { InvalidDocumentError } from "./documents/errors.js";
import { EmployeeRefStatus } from "./hr-shared/employee-ref.js";
import { EmployeeNotTerminatedError, InvalidEmployeeTransitionError, TerminationRecoveryAlreadyCollectedError } from "./hr/errors.js";
import { withTerminationDate } from "./hr/transition-employee.js";
import type { Employee } from "./hr/employee.js";
import { GoodsReceiptAlreadyInvoicedError, GoodsReceiptInvoicedRefusal, InvoiceDoesNotMatchReceiptError, InvoiceExceedsReceiptError, OverReceiptError } from "./purchasing/errors.js";
import { Qty } from "./money/index.js";
import { TreasuryAccountFixedField, TreasuryAccountHasMovementsError, TreasuryGlAccountCurrencyConflictError } from "./treasury-accounts/errors.js";

const ARABIC = /[؀-ۿ]/;
const LATIN_SENTENCE = /[A-Za-z]{3,}/;

function bothLanguages(error: Error & { readonly messageEn?: string }): void {
  expect(error.message, error.name).toMatch(ARABIC);
  expect(error.messageEn ?? "", error.name).toMatch(LATIN_SENTENCE);
  expect(error.messageEn ?? "", error.name).not.toMatch(ARABIC);
}

function caught(run: () => unknown): Error & { readonly messageEn?: string } {
  try {
    run();
  } catch (err) {
    return err as Error & { readonly messageEn?: string };
  }
  throw new Error("expected a refusal");
}

describe("a refusal the user can meet says why in Arabic and in English", () => {
  it("every refusal this lane added or changed carries both", () => {
    const refusals: (Error & { readonly messageEn?: string })[] = [
      new InvoiceExceedsReceiptError("GRN-1", [{ itemId: "ITEM-1", requested: "12.000000", remaining: "10.000000" }]),
      new GoodsReceiptAlreadyInvoicedError("GRN-1", GoodsReceiptInvoicedRefusal.SecondInvoice),
      new GoodsReceiptAlreadyInvoicedError("GRN-1", GoodsReceiptInvoicedRefusal.Cancel),
      new InvoiceDoesNotMatchReceiptError("GRN-1", [{ ar: "البند رقم 8 غير موجود في إذن الاستلام", en: "line 8 is not on the receipt" }]),
      new TreasuryAccountHasMovementsError("TR-1", [TreasuryAccountFixedField.Currency, TreasuryAccountFixedField.GlAccount]),
      new TreasuryGlAccountCurrencyConflictError("1310-USD", "EGP", { code: "BANK-USD", currency: "USD" }),
      new ChequeBankRateMissingError("GBP", "2026-09-05"),
      new OverReceiptError("ITEM-1", Qty.fromMajor("6"), Qty.fromMajor("20"), Qty.fromMajor("20"), Qty.fromMajor("25"), 25),
      new EmployeeNotTerminatedError("EMP-1"),
      new TerminationRecoveryAlreadyCollectedError("EMP-1", "ADV-000007"),
      new InvalidEmployeeTransitionError(EmployeeRefStatus.Terminated, EmployeeRefStatus.Terminated),
    ];
    for (const refusal of refusals) bothLanguages(refusal);
  });

  it("every collections refusal carries both", () => {
    const policy = defaultDunningPolicy();
    const refusals: (Error & { readonly messageEn?: string })[] = [
      new InvalidDunningPolicyError([{ ar: "سبب", en: "reason" }]),
      new DunningReminderNotFoundError("R-1"),
      new DunningReminderNotSendableError("R-1", "sent"),
      new CustomerContactMissingError("C-1", "email"),
      new CustomerContactMissingError("C-1", "whatsapp"),
      new SmsProviderNotConfiguredError(),
      new InvalidPromiseToPayError("سبب", "reason"),
      new PromiseToPayNotFoundError("P-1"),
      new DunningHoldNotFoundError("C-1"),
      caught(() => assertValidDunningPolicy({ ...policy, steps: [{ ...policy.steps[0]!, channel: DunningChannel.Sms }] }, { smsAvailable: false })),
    ];
    for (const refusal of refusals) bothLanguages(refusal);
  });

  it("each way a termination date is refused carries both", () => {
    const employee = { hireDate: "2026-01-01", status: EmployeeRefStatus.Active } as Employee;
    bothLanguages(caught(() => withTerminationDate(employee, "not-a-date")));
    bothLanguages(caught(() => withTerminationDate(employee, "2026-12-01", "2026-10-11")));
    bothLanguages(caught(() => withTerminationDate(employee, "2025-12-31")));
  });

  it("a document refusal constructed with an English message exposes it", () => {
    bothLanguages(new InvalidDocumentError("TREASURY_VOUCHER", "V-1", "حساب الخزينة مطلوب.", "A treasury account is required."));
  });
});
