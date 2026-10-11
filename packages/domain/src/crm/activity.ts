import { ActivityNotPendingError, InvalidActivityError } from "./errors.js";
import { assertRecordIdIsNew } from "../records/duplicate-record-id.js";

/**
 * Activities — core entity (docs/archive/catalog/06-crm-hr.md "مهامي / الأنشطة"). A
 * personal task/follow-up log (calls, meetings, to-dos) tied to a lead and/or
 * opportunity.
 */

export type ActivityType = "call" | "meeting" | "todo" | "email";
export type ActivityStatus = "pending" | "completed" | "cancelled";

export interface Activity {
  readonly id: string;
  readonly subject: string;
  readonly type: ActivityType;
  readonly relatedLeadId: string | null;
  readonly relatedOpportunityId: string | null;
  readonly dueDate: string | null;
  readonly status: ActivityStatus;
  readonly notes: string | null;
  readonly createdAt: string;
}

/** Persistence port for activities. The domain depends on this interface only — no SQL, no driver. */
export interface ActivityRepository {
  findById(id: string): Promise<Activity | null>;
  list(): Promise<Activity[]>;
  create(activity: Activity): Promise<void>;
  update(activity: Activity): Promise<void>;
}

export interface CreateActivityCommand {
  readonly id: string;
  readonly subject: string;
  readonly type?: ActivityType;
  readonly relatedLeadId?: string | null;
  readonly relatedOpportunityId?: string | null;
  readonly dueDate?: string | null;
  readonly notes?: string | null;
}

/** Creates and persists a new activity. New activities always start `pending`. */
export async function createActivity(command: CreateActivityCommand, repo: ActivityRepository): Promise<Activity> {
  assertRecordIdIsNew(await repo.findById(command.id), command.id);
  if (command.subject.trim().length === 0) {
    throw new InvalidActivityError(["الموضوع مطلوب"]);
  }

  const activity: Activity = {
    id: command.id,
    subject: command.subject,
    type: command.type ?? "todo",
    relatedLeadId: command.relatedLeadId ?? null,
    relatedOpportunityId: command.relatedOpportunityId ?? null,
    dueDate: command.dueDate ?? null,
    status: "pending",
    notes: command.notes ?? null,
    createdAt: new Date().toISOString(),
  };

  await repo.create(activity);
  return activity;
}

/** Marks a pending activity as completed. Pure — the caller persists via `repo.update`. */
export function completeActivity(activity: Activity): Activity {
  if (activity.status !== "pending") {
    throw new ActivityNotPendingError(activity.id);
  }
  return { ...activity, status: "completed" };
}

/** Marks a pending activity as cancelled. Pure — the caller persists via `repo.update`. */
export function cancelActivity(activity: Activity): Activity {
  if (activity.status !== "pending") {
    throw new ActivityNotPendingError(activity.id);
  }
  return { ...activity, status: "cancelled" };
}
