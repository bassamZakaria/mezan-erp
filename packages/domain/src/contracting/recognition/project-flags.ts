import type { Money } from "../../money/index.js";
import type { WorksContractStatus } from "../contracts/contract.js";

/**
 * The derived status flags «المشاريع» carries (design §08). Neither is stored:
 * both are recomputed from the contracts every time the list is read, because
 * a stored flag is a figure that goes stale the day after it is written.
 */
export type ProjectStatusFlag = "onerous_contract" | "late_penalty_risk";

export interface ProjectStatusFlagDefinition {
  readonly code: ProjectStatusFlag;
  readonly labelAr: string;
  readonly labelEn: string;
}

export const PROJECT_STATUS_FLAG_DEFINITIONS: readonly ProjectStatusFlagDefinition[] = [
  { code: "onerous_contract", labelAr: "عقد خاسر — مخصّص واجب", labelEn: "Onerous contract — provision required" },
  { code: "late_penalty_risk", labelAr: "غرامة تأخير محتملة", labelEn: "Late-delivery penalty likely" },
] as const;

export function getProjectStatusFlagLabel(flag: ProjectStatusFlag): string {
  return PROJECT_STATUS_FLAG_DEFINITIONS.find((d) => d.code === flag)?.labelAr ?? flag;
}

/** One active contract, reduced to the two facts the flags are decided on. */
export interface ProjectFlagContract {
  readonly projectId: string;
  readonly status: WorksContractStatus;
  readonly plannedEndDate: string;
  readonly estimatedTotalCost: Money | null;
  /** قيمة العقد بعد أوامر التغيير المعتمدة. */
  readonly contractValue: Money;
}

/**
 * A project is flagged خاسر when any live contract on it forecasts a total cost
 * above its value, and flagged for a late-delivery penalty when a live contract
 * has run past the date it was due to finish.
 */
export function deriveProjectStatusFlags(
  contracts: readonly ProjectFlagContract[],
  today: string,
): Map<string, ProjectStatusFlag[]> {
  const flags = new Map<string, ProjectStatusFlag[]>();
  const add = (projectId: string, flag: ProjectStatusFlag): void => {
    const current = flags.get(projectId) ?? [];
    if (!current.includes(flag)) current.push(flag);
    flags.set(projectId, current);
  };
  for (const contract of contracts) {
    if (contract.status !== "active") continue;
    if (contract.estimatedTotalCost !== null && contract.estimatedTotalCost.scaled > contract.contractValue.scaled) {
      add(contract.projectId, "onerous_contract");
    }
    if (contract.plannedEndDate < today) add(contract.projectId, "late_penalty_risk");
  }
  return flags;
}
