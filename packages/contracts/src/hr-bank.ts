import { z } from "zod";
import { moneyString } from "./money-string.js";

export enum SalaryPaymentMethodDTO {
  BankTransfer = "bank_transfer",
  Cash = "cash",
  Cheque = "cheque",
}

export enum BankFileFormatDTO {
  GenericCsv = "generic_csv",
  EgyptBulkTransfer = "egypt_bulk_transfer",
}

export enum BankFileExceptionReasonDTO {
  PaidInCash = "paid_in_cash",
  PaidByCheque = "paid_by_cheque",
  NoPaymentMethod = "no_payment_method",
  NoBankAccount = "no_bank_account",
  InvalidIban = "invalid_iban",
  NonPositiveNet = "non_positive_net",
  SubPiasterNet = "sub_piaster_net",
  EmployeeMissing = "employee_missing",
}

export const salaryPaymentMethodSchema = z.nativeEnum(SalaryPaymentMethodDTO);

/** `iban` is the full number only for a caller holding `hr.employee.view_salary`; everyone else gets `ibanMasked` alone. */
export const employeeBankAccountSchema = z.object({
  iban: z.string().optional(),
  ibanMasked: z.string(),
  accountName: z.string().nullable(),
  bankName: z.string().nullable(),
});

export const setSalaryPaymentSchema = z.object({
  method: salaryPaymentMethodSchema,
  iban: z.string().max(64).nullable().optional(),
  accountName: z.string().max(140).nullable().optional(),
  bankName: z.string().max(140).nullable().optional(),
});

export const bankFileRequestSchema = z.object({
  format: z.nativeEnum(BankFileFormatDTO),
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** A bank-type treasury account; its account number is printed as the debit account where the layout has one. */
  treasuryAccountId: z.string().min(1).nullable().optional(),
});

export const bankFileLayoutSchema = z.object({
  format: z.nativeEnum(BankFileFormatDTO),
  labelAr: z.string(),
  labelEn: z.string(),
  descriptionAr: z.string(),
  currencies: z.array(z.string()).nullable(),
  verified: z.boolean(),
  columns: z.array(z.string()),
});

export const bankFileLineSchema = z.object({
  sequence: z.number().int(),
  employeeId: z.string(),
  employeeCode: z.string(),
  nameAr: z.string(),
  nameLatin: z.string(),
  ibanMasked: z.string(),
  amount: moneyString,
  reference: z.string(),
});

export const bankFileExceptionSchema = z.object({
  employeeId: z.string(),
  employeeCode: z.string().nullable(),
  nameAr: z.string().nullable(),
  amount: moneyString,
  reason: z.nativeEnum(BankFileExceptionReasonDTO),
});

export const bankFileTotalsSchema = z.object({
  runNet: z.string(),
  bankTotal: z.string(),
  exceptionsTotal: z.string(),
  lineCount: z.number().int(),
  exceptionCount: z.number().int(),
});

export const bankFilePreviewSchema = z.object({
  runId: z.string(),
  format: z.nativeEnum(BankFileFormatDTO),
  verified: z.boolean(),
  valueDate: z.string(),
  currency: z.string(),
  lines: z.array(bankFileLineSchema),
  exceptions: z.array(bankFileExceptionSchema),
  totals: bankFileTotalsSchema,
});

export const bankFileExportSchema = bankFilePreviewSchema.extend({
  fileName: z.string(),
  mimeType: z.string(),
  content: z.string(),
  sha256: z.string(),
});

export type EmployeeBankAccountDTO = z.infer<typeof employeeBankAccountSchema>;
export type SetSalaryPaymentDTO = z.infer<typeof setSalaryPaymentSchema>;
export type BankFileRequestDTO = z.infer<typeof bankFileRequestSchema>;
export type BankFileLayoutDTO = z.infer<typeof bankFileLayoutSchema>;
export type BankFileLineDTO = z.infer<typeof bankFileLineSchema>;
export type BankFileExceptionDTO = z.infer<typeof bankFileExceptionSchema>;
export type BankFileTotalsDTO = z.infer<typeof bankFileTotalsSchema>;
export type BankFilePreviewDTO = z.infer<typeof bankFilePreviewSchema>;
export type BankFileExportDTO = z.infer<typeof bankFileExportSchema>;
