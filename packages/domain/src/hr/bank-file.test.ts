import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { SalaryPaymentMethod } from "./employee.js";
import { IbanProblem, ibanChecksumValid, maskIban, normalizeIban, validateEgyptianIban } from "./iban.js";
import {
  BankFileCurrencyError,
  BankFileExceptionReason,
  BankFileFormat,
  BankFileRunNotPayableError,
  BankFileTotalsMismatchError,
  buildBankFile,
  type BankFileEmployee,
} from "./bank-file.js";
import { PayrollRunStatusCode, type PayrollRun, type Payslip } from "./payroll-run.js";

function egyptianIban(bban: string): string {
  const rearranged = `${bban}EG00`;
  let numeric = "";
  for (const ch of rearranged) numeric += /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return `EG${String(98 - remainder).padStart(2, "0")}${bban}`;
}

const IBAN_A = egyptianIban("0003024431615217447010180");
const IBAN_B = egyptianIban("0002052305230120000001332");

function run(overrides: Partial<PayrollRun> = {}): PayrollRun {
  return {
    id: "run-1",
    number: "PR-000007",
    year: 2026,
    month: 9,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    branchId: null,
    currency: "EGP",
    status: PayrollRunStatusCode.Approved,
    employeeCount: 4,
    totalGross: Money.fromMajor("0"),
    totalDeductions: Money.fromMajor("0"),
    totalEmployerContributions: Money.fromMajor("0"),
    totalNet: Money.fromMajor("23500.50"),
    ...overrides,
  } as PayrollRun;
}

function payslip(id: string, employeeId: string, net: string): Payslip {
  return { id, number: `PS-${id}`, runId: "run-1", employeeId, netPay: Money.fromMajor(net) } as unknown as Payslip;
}

function employee(id: string, code: string, method: SalaryPaymentMethod | null, iban: string | null): BankFileEmployee {
  return {
    id,
    code,
    nameAr: `موظف ${code}`,
    nameLatin: `Employee ${code}`,
    salaryPaymentMethod: method,
    bankAccount: iban ? { iban, accountName: null, bankName: null } : null,
  };
}

const employees = new Map<string, BankFileEmployee>([
  ["e1", employee("e1", "EMP-0001", SalaryPaymentMethod.BankTransfer, IBAN_A)],
  ["e2", employee("e2", "EMP-0002", SalaryPaymentMethod.Cash, null)],
  ["e3", employee("e3", "EMP-0003", SalaryPaymentMethod.BankTransfer, IBAN_B)],
  ["e4", employee("e4", "EMP-0004", null, null)],
]);

const payslips = [payslip("1", "e1", "10000.25"), payslip("2", "e2", "3000"), payslip("3", "e3", "8000.25"), payslip("4", "e4", "2500")];

describe("validateEgyptianIban", () => {
  it("accepts a 29-character EG IBAN whose check digits hold, with spaces and lower case", () => {
    expect(IBAN_A).toHaveLength(29);
    expect(validateEgyptianIban(IBAN_A.toLowerCase().replace(/(.{4})/g, "$1 "))).toBeNull();
    expect(ibanChecksumValid(IBAN_B)).toBe(true);
  });

  it("names what is wrong with an IBAN it refuses", () => {
    expect(validateEgyptianIban("")).toBe(IbanProblem.Empty);
    expect(validateEgyptianIban("SA0380000000608010167519")).toBe(IbanProblem.NotEgyptian);
    expect(validateEgyptianIban(IBAN_A.slice(0, 28))).toBe(IbanProblem.WrongLength);
    const flipped = `${IBAN_A.slice(0, 28)}${IBAN_A.endsWith("0") ? "1" : "0"}`;
    expect(validateEgyptianIban(flipped)).toBe(IbanProblem.ChecksumFailed);
    expect(validateEgyptianIban("EG38*003024431615217447010180")).toBe(IbanProblem.BadCharacters);
  });

  it("masks all but the country and the last four", () => {
    expect(maskIban(IBAN_A)).toMatch(/^EG•+0180$/);
    expect(normalizeIban(" eg12 34 ")).toBe("EG1234");
  });
});

describe("buildBankFile", () => {
  it("transfers only bank-paid employees and lists the rest as exceptions, tying to the run's net", () => {
    const file = buildBankFile({ run: run(), payslips, employees, format: BankFileFormat.GenericCsv, valueDate: "2026-09-30", debitAccount: null });
    expect(file.lines.map((l) => l.employeeCode)).toEqual(["EMP-0001", "EMP-0003"]);
    expect(file.exceptions.map((e) => e.reason)).toEqual([BankFileExceptionReason.PaidInCash, BankFileExceptionReason.NoPaymentMethod]);
    expect(file.totals.bankTotal.toString()).toBe("18000.500000");
    expect(file.totals.exceptionsTotal.toString()).toBe("5500.000000");
    expect(file.totals.bankTotal.add(file.totals.exceptionsTotal).equals(file.totals.runNet)).toBe(true);
    expect(file.content.startsWith("﻿No,Employee Code")).toBe(true);
    expect(file.content).toContain(`1,EMP-0001,موظف EMP-0001,Employee EMP-0001,${IBAN_A},0003,10000.25,EGP,2026-09-30,PR-000007-EMP-0001\r\n`);
  });

  it("never rounds: a sub-piaster or non-positive net is an exception", () => {
    const odd = [payslip("1", "e1", "100.005"), payslip("3", "e3", "0")];
    const file = buildBankFile({ run: run({ totalNet: Money.fromMajor("100.005") }), payslips: odd, employees, format: BankFileFormat.GenericCsv, valueDate: "2026-09-30", debitAccount: null });
    expect(file.lines).toHaveLength(0);
    expect(file.exceptions.map((e) => e.reason)).toEqual([BankFileExceptionReason.SubPiasterNet, BankFileExceptionReason.NonPositiveNet]);
  });

  it("refuses a run that is not approved, a mismatched total, and a currency the layout does not take", () => {
    const input = { payslips, employees, valueDate: "2026-09-30", debitAccount: null };
    expect(() => buildBankFile({ ...input, run: run({ status: PayrollRunStatusCode.Calculated }), format: BankFileFormat.GenericCsv })).toThrow(BankFileRunNotPayableError);
    expect(() => buildBankFile({ ...input, run: run({ totalNet: Money.fromMajor("1") }), format: BankFileFormat.GenericCsv })).toThrow(BankFileTotalsMismatchError);
    expect(() => buildBankFile({ ...input, run: run({ currency: "USD" }), format: BankFileFormat.EgyptBulkTransfer })).toThrow(BankFileCurrencyError);
  });

  it("writes the bulk-transfer layout with the debit account, Latin name and SALA purpose, and guards spreadsheet formulas", () => {
    const risky = new Map(employees);
    risky.set("e1", { ...employee("e1", "EMP-0001", SalaryPaymentMethod.BankTransfer, IBAN_A), nameLatin: "=HYPERLINK(1)" });
    const file = buildBankFile({ run: run(), payslips, employees: risky, format: BankFileFormat.EgyptBulkTransfer, valueDate: "2026-09-30", debitAccount: "1001234567" });
    expect(file.verified).toBe(false);
    expect(file.content.startsWith("Debit Account,Beneficiary Name")).toBe(true);
    expect(file.content).toContain(`1001234567,'=HYPERLINK(1),${IBAN_A},10000.25,EGP,2026-09-30,SALA,PR-000007-EMP-0001`);
  });
});
