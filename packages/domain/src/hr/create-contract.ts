import { PayBasis } from "./contract.js";
import { ContractStatus } from "./contract.js";
import type { Money } from "../money/index.js";
import { InvalidContractError, ContractNotActiveError } from "./errors.js";
import type { Contract, ContractLineItem, ContractRepository, ContractType, LeaveEntitlementOverrides, PayFrequency } from "./contract.js";

export interface CreateContractCommand {
  readonly id: string;
  /** CTR-#### — assigned by the caller via the numbering engine before invoking this command. */
  readonly number: string;
  readonly employeeId: string;
  readonly type?: ContractType;
  readonly payBasis?: PayBasis;
  readonly payFrequency?: PayFrequency;
  readonly startDate: string;
  readonly endDate?: string | null;
  readonly monthlySalary: Money;
  readonly currency?: string;
  readonly leaveEntitlement?: Partial<LeaveEntitlementOverrides>;
  readonly allowances?: readonly ContractLineItem[];
  readonly deductions?: readonly ContractLineItem[];
}

function validate(command: Pick<CreateContractCommand, "employeeId" | "startDate" | "type" | "endDate">): string[] {
  const reasons: string[] = [];
  if (command.employeeId.trim().length === 0) reasons.push("الموظف مطلوب");
  if (command.startDate.trim().length === 0) reasons.push("تاريخ البداية مطلوب");
  if (command.type === "indefinite" && command.endDate) {
    reasons.push("العقد غير محدد المدة لا يحتوي على تاريخ انتهاء");
  }
  if (command.endDate && command.startDate && command.endDate < command.startDate) {
    reasons.push("تاريخ الانتهاء لا يمكن أن يسبق تاريخ البداية");
  }
  return reasons;
}

/** Creates and persists a new contract. New contracts always start "active". */
export async function createContract(command: CreateContractCommand, repo: ContractRepository): Promise<Contract> {
  const type = command.type ?? "indefinite";
  const reasons = validate({ employeeId: command.employeeId, startDate: command.startDate, type, endDate: command.endDate ?? null });
  if (reasons.length > 0) throw new InvalidContractError(reasons);

  const contract: Contract = {
    id: command.id,
    number: command.number,
    employeeId: command.employeeId,
    type,
    payBasis: command.payBasis ?? PayBasis.Monthly,
    payFrequency: command.payFrequency ?? "monthly",
    startDate: command.startDate,
    endDate: type === "indefinite" ? null : (command.endDate ?? null),
    monthlySalary: command.monthlySalary,
    currency: command.currency ?? "EGP",
    leaveEntitlement: {
      annualLeaveDays: command.leaveEntitlement?.annualLeaveDays ?? null,
      sickLeaveDays: command.leaveEntitlement?.sickLeaveDays ?? null,
      personalLeaveDays: command.leaveEntitlement?.personalLeaveDays ?? null,
    },
    allowances: command.allowances ?? [],
    deductions: command.deductions ?? [],
    status: ContractStatus.Active,
    terminatedAt: null,
    createdAt: new Date().toISOString(),
  };

  await repo.create(contract);
  return contract;
}

/** Terminates an active contract (docs/archive/catalog/06 "إنهاء العقد"). */
export function terminateContract(contract: Contract, terminatedAt: string = new Date().toISOString()): Contract {
  if (contract.status !== ContractStatus.Active) throw new ContractNotActiveError(contract.id);
  return { ...contract, status: ContractStatus.Terminated, terminatedAt };
}
