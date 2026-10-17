import { SalaryPaymentMethod, type Employee, type EmployeeBankAccount } from "./employee.js";
import { ibanProblemAr, ibanProblemEn, normalizeIban, validateEgyptianIban, IbanProblem } from "./iban.js";

export class InvalidSalaryPaymentError extends Error {
  readonly code = "INVALID_SALARY_PAYMENT";
  readonly messageEn: string;
  constructor(
    readonly reasons: readonly string[],
    reasonsEn: readonly string[],
  ) {
    super(reasons.join("، "));
    this.messageEn = reasonsEn.join("; ");
    this.name = "InvalidSalaryPaymentError";
  }
}

export interface SetSalaryPaymentCommand {
  readonly method: SalaryPaymentMethod;
  readonly iban?: string | null;
  readonly accountName?: string | null;
  readonly bankName?: string | null;
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** A bank transfer needs a valid Egyptian IBAN; cash and cheque may still keep one on file for later. */
export function setEmployeeSalaryPayment(current: Employee, command: SetSalaryPaymentCommand): Employee {
  const rawIban = trimmedOrNull(command.iban);
  let bankAccount: EmployeeBankAccount | null = null;
  if (rawIban !== null) {
    const problem = validateEgyptianIban(rawIban);
    if (problem) throw new InvalidSalaryPaymentError([ibanProblemAr(problem)], [ibanProblemEn(problem)]);
    bankAccount = {
      iban: normalizeIban(rawIban),
      accountName: trimmedOrNull(command.accountName),
      bankName: trimmedOrNull(command.bankName),
    };
  } else if (command.method === SalaryPaymentMethod.BankTransfer) {
    throw new InvalidSalaryPaymentError([ibanProblemAr(IbanProblem.Empty)], [ibanProblemEn(IbanProblem.Empty)]);
  }
  return { ...current, salaryPaymentMethod: command.method, bankAccount };
}
