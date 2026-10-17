import { Money } from "../money/money.js";
import { SalaryPaymentMethod, type EmployeeBankAccount } from "./employee.js";
import { validateEgyptianIban } from "./iban.js";
import { PayrollRunStatusCode, type PayrollRun, type Payslip } from "./payroll-run.js";

export enum BankFileFormat {
  GenericCsv = "generic_csv",
  EgyptBulkTransfer = "egypt_bulk_transfer",
}

export enum BankFileColumn {
  Sequence = "sequence",
  EmployeeCode = "employee_code",
  BeneficiaryNameAr = "beneficiary_name_ar",
  BeneficiaryNameLatin = "beneficiary_name_latin",
  Iban = "iban",
  BankCode = "bank_code",
  Amount = "amount",
  Currency = "currency",
  ValueDate = "value_date",
  Reference = "reference",
  PurposeCode = "purpose_code",
  DebitAccount = "debit_account",
}

export enum BankFileExceptionReason {
  PaidInCash = "paid_in_cash",
  PaidByCheque = "paid_by_cheque",
  NoPaymentMethod = "no_payment_method",
  NoBankAccount = "no_bank_account",
  InvalidIban = "invalid_iban",
  NonPositiveNet = "non_positive_net",
  SubPiasterNet = "sub_piaster_net",
  EmployeeMissing = "employee_missing",
}

export const BANK_FILE_EXCEPTION_LABEL_AR: Record<BankFileExceptionReason, string> = {
  [BankFileExceptionReason.PaidInCash]: "يُصرف نقدًا",
  [BankFileExceptionReason.PaidByCheque]: "يُصرف بشيك",
  [BankFileExceptionReason.NoPaymentMethod]: "طريقة صرف الراتب غير مسجّلة",
  [BankFileExceptionReason.NoBankAccount]: "لا يوجد حساب بنكي مسجّل",
  [BankFileExceptionReason.InvalidIban]: "رقم الآيبان المسجّل غير صحيح",
  [BankFileExceptionReason.NonPositiveNet]: "الصافي صفر أو سالب",
  [BankFileExceptionReason.SubPiasterNet]: "الصافي يحتوي على كسور أقل من قرش",
  [BankFileExceptionReason.EmployeeMissing]: "الموظف غير موجود",
};

export interface BankFileLayout {
  readonly format: BankFileFormat;
  readonly labelAr: string;
  readonly labelEn: string;
  readonly descriptionAr: string;
  readonly delimiter: string;
  readonly byteOrderMark: boolean;
  readonly header: boolean;
  readonly columns: readonly { readonly column: BankFileColumn; readonly title: string }[];
  /** Null = any currency the run is in. */
  readonly currencies: readonly string[] | null;
  /**
   * False until the column list has been matched against a template the bank
   * itself issued. The screen shows «غير مُتحقَّق منه» beside such a layout,
   * the same way unverified statutory tables are shown.
   */
  readonly verified: boolean;
}

/** ISO 20022 external purpose code for a salary payment. */
export const SALARY_PURPOSE_CODE = "SALA";

export const BANK_FILE_LAYOUTS: Readonly<Record<BankFileFormat, BankFileLayout>> = {
  [BankFileFormat.GenericCsv]: {
    format: BankFileFormat.GenericCsv,
    labelAr: "ملف CSV عام",
    labelEn: "Generic CSV",
    descriptionAr: "ملف يفتح في Excel بالأسماء العربية واللاتينية، صالح للمراجعة أو لنسخه إلى قالب أي بنك.",
    delimiter: ",",
    byteOrderMark: true,
    header: true,
    columns: [
      { column: BankFileColumn.Sequence, title: "No" },
      { column: BankFileColumn.EmployeeCode, title: "Employee Code" },
      { column: BankFileColumn.BeneficiaryNameAr, title: "Name (Arabic)" },
      { column: BankFileColumn.BeneficiaryNameLatin, title: "Name (Latin)" },
      { column: BankFileColumn.Iban, title: "IBAN" },
      { column: BankFileColumn.BankCode, title: "IBAN Bank Code" },
      { column: BankFileColumn.Amount, title: "Amount" },
      { column: BankFileColumn.Currency, title: "Currency" },
      { column: BankFileColumn.ValueDate, title: "Value Date" },
      { column: BankFileColumn.Reference, title: "Reference" },
    ],
    currencies: null,
    verified: true,
  },
  [BankFileFormat.EgyptBulkTransfer]: {
    format: BankFileFormat.EgyptBulkTransfer,
    labelAr: "تحويل رواتب جماعي — بنك مصري",
    labelEn: "Egyptian bank bulk salary transfer",
    descriptionAr:
      "الأعمدة الشائعة في بوابات البنوك المصرية للتحويل الجماعي: اسم المستفيد باللاتينية، الآيبان، المبلغ بالجنيه، كود الغرض SALA، والمرجع. طابِق الأعمدة مع قالب بنكك قبل أول رفع.",
    delimiter: ",",
    byteOrderMark: false,
    header: true,
    columns: [
      { column: BankFileColumn.DebitAccount, title: "Debit Account" },
      { column: BankFileColumn.BeneficiaryNameLatin, title: "Beneficiary Name" },
      { column: BankFileColumn.Iban, title: "Beneficiary IBAN" },
      { column: BankFileColumn.Amount, title: "Amount" },
      { column: BankFileColumn.Currency, title: "Currency" },
      { column: BankFileColumn.ValueDate, title: "Value Date" },
      { column: BankFileColumn.PurposeCode, title: "Purpose Code" },
      { column: BankFileColumn.Reference, title: "Payment Reference" },
    ],
    currencies: ["EGP"],
    verified: false,
  },
};

export function bankFileLayout(format: BankFileFormat): BankFileLayout {
  return BANK_FILE_LAYOUTS[format];
}

export interface BankFileEmployee {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameLatin: string;
  readonly salaryPaymentMethod: SalaryPaymentMethod | null;
  readonly bankAccount: EmployeeBankAccount | null;
}

export interface BankFileLine {
  readonly sequence: number;
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly nameAr: string;
  readonly nameLatin: string;
  readonly iban: string;
  readonly amount: Money;
  readonly reference: string;
}

export interface BankFileException {
  readonly employeeId: string;
  readonly employeeCode: string | null;
  readonly nameAr: string | null;
  readonly amount: Money;
  readonly reason: BankFileExceptionReason;
}

export interface BankFileTotals {
  readonly runNet: Money;
  readonly bankTotal: Money;
  readonly exceptionsTotal: Money;
  readonly lineCount: number;
  readonly exceptionCount: number;
}

export interface BankFile {
  readonly format: BankFileFormat;
  readonly verified: boolean;
  readonly fileName: string;
  readonly mimeType: string;
  readonly content: string;
  readonly valueDate: string;
  readonly currency: string;
  readonly lines: readonly BankFileLine[];
  readonly exceptions: readonly BankFileException[];
  readonly totals: BankFileTotals;
}

export interface BuildBankFileInput {
  readonly run: PayrollRun;
  readonly payslips: readonly Payslip[];
  readonly employees: ReadonlyMap<string, BankFileEmployee>;
  readonly format: BankFileFormat;
  readonly valueDate: string;
  /** The company account the bank debits; printed on layouts that carry it. */
  readonly debitAccount: string | null;
}

export class BankFileRunNotPayableError extends Error {
  readonly code = "BANK_FILE_RUN_NOT_PAYABLE";
  readonly messageEn: string;
  constructor(readonly status: string) {
    super("ملف التحويل البنكي يُصدَر فقط من مسير رواتب معتمد أو مصروف.");
    this.messageEn = "A bank transfer file can only be produced from an approved or disbursed payroll run.";
    this.name = "BankFileRunNotPayableError";
  }
}

export class BankFileTotalsMismatchError extends Error {
  readonly code = "BANK_FILE_TOTALS_MISMATCH";
  readonly messageEn: string;
  constructor(
    readonly runNet: Money,
    readonly payslipNet: Money,
  ) {
    super(`مجموع صافي القسائم (${payslipNet.toString()}) لا يطابق صافي المسير (${runNet.toString()}) — لم يُصدَر الملف.`);
    this.messageEn = `The payslips' net (${payslipNet.toString()}) does not equal the run's net (${runNet.toString()}); no file was produced.`;
    this.name = "BankFileTotalsMismatchError";
  }
}

export class BankFileCurrencyError extends Error {
  readonly code = "BANK_FILE_CURRENCY_UNSUPPORTED";
  readonly messageEn: string;
  constructor(
    readonly currency: string,
    readonly format: BankFileFormat,
  ) {
    super(`قالب «${BANK_FILE_LAYOUTS[format].labelAr}» لا يقبل عملة المسير ${currency}.`);
    this.messageEn = `The "${BANK_FILE_LAYOUTS[format].labelEn}" layout does not accept the run's currency ${currency}.`;
    this.name = "BankFileCurrencyError";
  }
}

export class BankFileEmptyError extends Error {
  readonly code = "BANK_FILE_EMPTY";
  readonly messageEn: string;
  constructor() {
    super("لا يوجد موظف في هذا المسير يُصرف راتبه بتحويل بنكي — كل القسائم مدرجة في الاستثناءات.");
    this.messageEn = "No employee on this run is paid by bank transfer; every payslip is listed as an exception.";
    this.name = "BankFileEmptyError";
  }
}

const PAYABLE_STATUSES: ReadonlySet<string> = new Set<string>([PayrollRunStatusCode.Approved, PayrollRunStatusCode.Disbursed]);
const PIASTER_STEP = 10_000n;

export function bankFileRunPayable(run: Pick<PayrollRun, "status">): boolean {
  return PAYABLE_STATUSES.has(run.status);
}

function twoDecimals(amount: Money): string {
  const text = amount.toString();
  const [whole, fraction = ""] = text.split(".");
  return `${whole}.${fraction.slice(0, 2).padEnd(2, "0")}`;
}

const FORMULA_LEAD = /^[=+\-@\t\r]/;

function csvCell(value: string, delimiter: string): string {
  const guarded = FORMULA_LEAD.test(value) ? `'${value}` : value;
  const needsQuotes = guarded.includes(delimiter) || guarded.includes('"') || guarded.includes("\n") || guarded.includes("\r");
  return needsQuotes ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function exceptionReasonFor(employee: BankFileEmployee, net: Money): BankFileExceptionReason | null {
  if (net.scaled <= 0n) return BankFileExceptionReason.NonPositiveNet;
  if (net.scaled % PIASTER_STEP !== 0n) return BankFileExceptionReason.SubPiasterNet;
  switch (employee.salaryPaymentMethod) {
    case null:
      return BankFileExceptionReason.NoPaymentMethod;
    case SalaryPaymentMethod.Cash:
      return BankFileExceptionReason.PaidInCash;
    case SalaryPaymentMethod.Cheque:
      return BankFileExceptionReason.PaidByCheque;
    case SalaryPaymentMethod.BankTransfer:
      if (!employee.bankAccount) return BankFileExceptionReason.NoBankAccount;
      return validateEgyptianIban(employee.bankAccount.iban) === null ? null : BankFileExceptionReason.InvalidIban;
  }
}

function cellFor(column: BankFileColumn, line: BankFileLine, context: { currency: string; valueDate: string; debitAccount: string | null }): string {
  switch (column) {
    case BankFileColumn.Sequence:
      return String(line.sequence);
    case BankFileColumn.EmployeeCode:
      return line.employeeCode;
    case BankFileColumn.BeneficiaryNameAr:
      return line.nameAr;
    case BankFileColumn.BeneficiaryNameLatin:
      return line.nameLatin;
    case BankFileColumn.Iban:
      return line.iban;
    case BankFileColumn.BankCode:
      return line.iban.slice(4, 8);
    case BankFileColumn.Amount:
      return twoDecimals(line.amount);
    case BankFileColumn.Currency:
      return context.currency;
    case BankFileColumn.ValueDate:
      return context.valueDate;
    case BankFileColumn.Reference:
      return line.reference;
    case BankFileColumn.PurposeCode:
      return SALARY_PURPOSE_CODE;
    case BankFileColumn.DebitAccount:
      return context.debitAccount ?? "";
  }
}

/**
 * The salary transfer file for a run, plus every payslip it left out and why.
 *
 * Nothing is rounded here: a net that is not already a whole piaster is an
 * exception, never a quietly adjusted transfer. `bankTotal + exceptionsTotal`
 * equals the run's net by construction, and the payslips must already sum to
 * that net or nothing is produced.
 */
export function buildBankFile(input: BuildBankFileInput): BankFile {
  const { run, format } = input;
  if (!bankFileRunPayable(run)) throw new BankFileRunNotPayableError(run.status);
  const layout = bankFileLayout(format);
  if (layout.currencies !== null && !layout.currencies.includes(run.currency)) throw new BankFileCurrencyError(run.currency, format);

  const payslipNet = Money.sum(input.payslips.map((p) => p.netPay));
  if (!payslipNet.equals(run.totalNet)) throw new BankFileTotalsMismatchError(run.totalNet, payslipNet);

  const ordered = [...input.payslips].sort((a, b) => {
    const codeA = input.employees.get(a.employeeId)?.code ?? a.employeeId;
    const codeB = input.employees.get(b.employeeId)?.code ?? b.employeeId;
    return codeA.localeCompare(codeB) || a.number.localeCompare(b.number);
  });

  const lines: BankFileLine[] = [];
  const exceptions: BankFileException[] = [];
  for (const payslip of ordered) {
    const employee = input.employees.get(payslip.employeeId);
    if (!employee) {
      exceptions.push({ employeeId: payslip.employeeId, employeeCode: null, nameAr: null, amount: payslip.netPay, reason: BankFileExceptionReason.EmployeeMissing });
      continue;
    }
    const reason = exceptionReasonFor(employee, payslip.netPay);
    if (reason !== null) {
      exceptions.push({ employeeId: employee.id, employeeCode: employee.code, nameAr: employee.nameAr, amount: payslip.netPay, reason });
      continue;
    }
    lines.push({
      sequence: lines.length + 1,
      employeeId: employee.id,
      employeeCode: employee.code,
      nameAr: employee.nameAr,
      nameLatin: employee.nameLatin,
      iban: employee.bankAccount!.iban,
      amount: payslip.netPay,
      reference: `${run.number}-${employee.code}`,
    });
  }

  const context = { currency: run.currency, valueDate: input.valueDate, debitAccount: input.debitAccount };
  const rows: string[] = [];
  if (layout.header) rows.push(layout.columns.map((c) => csvCell(c.title, layout.delimiter)).join(layout.delimiter));
  for (const line of lines) {
    rows.push(layout.columns.map((c) => csvCell(cellFor(c.column, line, context), layout.delimiter)).join(layout.delimiter));
  }
  const body = rows.length > 0 ? `${rows.join("\r\n")}\r\n` : "";

  const bankTotal = Money.sum(lines.map((l) => l.amount));
  const exceptionsTotal = Money.sum(exceptions.map((e) => e.amount));

  return {
    format,
    verified: layout.verified,
    fileName: `${run.number}-${format}-${input.valueDate}.csv`,
    mimeType: "text/csv;charset=utf-8",
    content: layout.byteOrderMark ? `﻿${body}` : body,
    valueDate: input.valueDate,
    currency: run.currency,
    lines,
    exceptions,
    totals: { runNet: run.totalNet, bankTotal, exceptionsTotal, lineCount: lines.length, exceptionCount: exceptions.length },
  };
}
