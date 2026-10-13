import { Money } from "../money/index.js";
import { InvalidOpportunityError } from "./errors.js";

/**
 * Opportunities — core entity (docs/archive/catalog/06-crm-hr.md "الفرص"). An
 * `Opportunity` tracks a deal in progress against a customer, moving through
 * a pipeline stage until it's won or lost.
 */

export type OpportunityStatus = "open" | "won" | "lost";

export interface Opportunity {
  readonly id: string;
  readonly title: string;
  readonly customerId: string;
  /**
   * The branch the deal belongs to. Nullable: opportunities written before the
   * column existed have none, and NULL means "not recorded" rather than "every
   * branch" — a scoped caller must not inherit rows nobody assigned.
   */
  readonly branchId: string | null;
  readonly stageId: string;
  readonly expectedValue: Money;
  readonly probability: number;
  readonly expectedCloseDate: string | null;
  readonly notes: string | null;
  readonly status: OpportunityStatus;
  readonly createdAt: string;
  readonly closedAt: string | null;
}

/** Persistence port for opportunities. The domain depends on this interface only — no SQL, no driver. */
export interface OpportunityRepository {
  findById(id: string): Promise<Opportunity | null>;
  list(): Promise<Opportunity[]>;
  create(opportunity: Opportunity): Promise<void>;
  update(opportunity: Opportunity): Promise<void>;
}

export interface CreateOpportunityCommand {
  readonly id: string;
  readonly title: string;
  readonly customerId: string;
  readonly branchId?: string | null;
  readonly stageId: string;
  readonly expectedValue?: Money;
  readonly probability?: number;
  readonly expectedCloseDate?: string | null;
  readonly notes?: string | null;
}

function validate(title: string, probability: number): string[] {
  const reasons: string[] = [];
  if (title.trim().length === 0) {
    reasons.push("العنوان مطلوب");
  }
  if (probability < 0 || probability > 100) {
    reasons.push("الاحتمالية يجب أن تكون بين 0 و100");
  }
  return reasons;
}

/** Creates and persists a new opportunity. New opportunities always start `open` with a null `closedAt`. */
export async function createOpportunity(
  command: CreateOpportunityCommand,
  repo: OpportunityRepository,
): Promise<Opportunity> {
  const probability = command.probability ?? 50;
  const reasons = validate(command.title, probability);
  if (reasons.length > 0) throw new InvalidOpportunityError(reasons);

  const opportunity: Opportunity = {
    id: command.id,
    title: command.title,
    customerId: command.customerId,
    branchId: command.branchId ?? null,
    stageId: command.stageId,
    expectedValue: command.expectedValue ?? Money.zero(),
    probability,
    expectedCloseDate: command.expectedCloseDate ?? null,
    notes: command.notes ?? null,
    status: "open",
    createdAt: new Date().toISOString(),
    closedAt: null,
  };

  await repo.create(opportunity);
  return opportunity;
}
