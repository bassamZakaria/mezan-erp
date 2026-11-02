import { PayBasis } from "./contract.js";
import { ContractStatus } from "./contract.js";
import type { Money } from "../money/index.js";
import { InvalidContractError, ContractNotActiveError } from "./errors.js";
import type { Contract, ContractLineItem, ContractRepository, ContractType, LeaveEntitlementOverrides, PayFrequency } from "./contract.js";
import type { ReasonInput } from "../bilingual-reasons.js";

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

function validate(command: Pick<CreateContractCommand, "employeeId" | "startDate" | "type" | "endDate">): ReasonInput[] {
  const reasons: ReasonInput[] = [];
  if (command.employeeId.trim().length === 0) reasons.push({ ar: "الموظف مطلوب", en: "The employee is required" });
  if (command.startDate.trim().length === 0) reasons.push({ ar: "تاريخ البداية مطلوب", en: "The start date is required" });
  if (command.type === "indefinite" && command.endDate) {
    reasons.push({ ar: "العقد غير محدد المدة لا يحتوي على تاريخ انتهاء", en: "An open-ended contract cannot have an end date" });
  }
  if (command.endDate && command.startDate && command.endDate < command.startDate) {
    reasons.push({ ar: "تاريخ الانتهاء لا يمكن أن يسبق تاريخ البداية", en: "The end date cannot be before the start date" });
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
