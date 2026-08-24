/**
 * متابعة التحصيل (docs/catalog/05 §"متابعة التحصيل"): a lightweight
 * collections-agent worklog against a customer's overdue installments —
 * scoped by customer on create (per the recon: the dialog picks a customer,
 * not a specific installment), independent of the document framework (no
 * numbering/GL/stock — it is a log entry, not a financial document).
 */

import { FollowUpNotFoundError, InvalidFollowUpTransitionError } from "./errors.js";

export const FOLLOW_UP_TYPES = ["CALL", "VISIT", "SMS", "EMAIL", "NOTE"] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

export const FOLLOW_UP_STATUSES = ["pending", "completed", "cancelled"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const FOLLOW_UP_STATUS_LABELS_AR: Readonly<Record<FollowUpStatus, string>> = {
  pending: "قيد المتابعة",
  completed: "مكتملة",
  cancelled: "ملغاة",
};

export interface CollectionFollowUp {
  readonly id: string;
  readonly customerId: string;
  /** The installment plan this touchpoint concerns, once one is linked (nullable — see module doc-comment). */
  readonly installmentPlanId: string | null;
  readonly type: FollowUpType;
  readonly followUpDate: string;
  /** User id; null = assigned to the creator (docs: "اتركه فارغاً لتعيين المتابعة لنفسك"). */
  readonly assignedTo: string | null;
  readonly notes: string | null;
  readonly status: FollowUpStatus;
  readonly outcome: string | null;
  readonly createdAt: string;
}

export interface CollectionFollowUpRepository {
  save(followUp: CollectionFollowUp): Promise<void>;
  update(followUp: CollectionFollowUp): Promise<void>;
  findById(id: string): Promise<CollectionFollowUp | null>;
  list(filter?: CollectionFollowUpListFilter): Promise<readonly CollectionFollowUp[]>;
}

export interface CollectionFollowUpListFilter {
  readonly status?: FollowUpStatus;
  readonly customerId?: string;
}

export interface CreateFollowUpCommand {
  readonly id: string;
  readonly customerId: string;
  readonly installmentPlanId?: string | null;
  readonly type: FollowUpType;
  readonly followUpDate: string;
  readonly assignedTo?: string | null;
  readonly notes?: string | null;
  readonly createdAt: string;
}

export function createFollowUp(cmd: CreateFollowUpCommand): CollectionFollowUp {
  return {
    id: cmd.id,
    customerId: cmd.customerId,
    installmentPlanId: cmd.installmentPlanId ?? null,
    type: cmd.type,
    followUpDate: cmd.followUpDate,
    assignedTo: cmd.assignedTo ?? null,
    notes: cmd.notes ?? null,
    status: "pending",
    outcome: null,
    createdAt: cmd.createdAt,
  };
}

function assertPending(followUp: CollectionFollowUp, to: FollowUpStatus): void {
  if (followUp.status !== "pending") {
    throw new InvalidFollowUpTransitionError(followUp.id, followUp.status, to);
  }
}

export function completeFollowUp(followUp: CollectionFollowUp, outcome: string): CollectionFollowUp {
  assertPending(followUp, "completed");
  return { ...followUp, status: "completed", outcome };
}

export function cancelFollowUp(followUp: CollectionFollowUp): CollectionFollowUp {
  assertPending(followUp, "cancelled");
  return { ...followUp, status: "cancelled" };
}

export async function requireFollowUp(
  id: string,
  repo: Pick<CollectionFollowUpRepository, "findById">,
): Promise<CollectionFollowUp> {
  const found = await repo.findById(id);
  if (!found) throw new FollowUpNotFoundError(id);
  return found;
}
