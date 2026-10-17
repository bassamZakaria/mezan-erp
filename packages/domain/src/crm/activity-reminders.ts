import type { Activity } from "./activity.js";
import type { Opportunity } from "./opportunity.js";

export interface ActivityReminderLog {
  has(activityId: string, dueDate: string): Promise<boolean>;
  record(activityId: string, dueDate: string, notifiedAt: string): Promise<void>;
}

export interface ActivityReminder {
  readonly activity: Activity;
  readonly recipientUserId: string;
  readonly opportunity: Opportunity | null;
}

export const REMINDER_LOOKBACK_DAYS = 7;

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The pending activities that have come due and owe their person a reminder.
 * The person is the activity's assignee, else the owner of the deal it hangs
 * off; an activity nobody owns reminds nobody. An activity that fell due more
 * than a week ago is stale history, not a reminder. Pure — the caller skips the
 * ones already logged and records the ones it sends, so a repeat run adds nothing.
 */
export function dueActivityReminders(
  activities: readonly Activity[],
  opportunities: readonly Opportunity[],
  today: string,
): ActivityReminder[] {
  const dealById = new Map(opportunities.map((o) => [o.id, o]));
  const oldest = shiftDay(today, -REMINDER_LOOKBACK_DAYS);
  const out: ActivityReminder[] = [];
  for (const activity of activities) {
    if (activity.status !== "pending" || activity.dueDate === null || activity.dueDate > today || activity.dueDate < oldest) continue;
    const opportunity = activity.relatedOpportunityId ? (dealById.get(activity.relatedOpportunityId) ?? null) : null;
    const recipientUserId = activity.assigneeUserId ?? opportunity?.ownerUserId ?? null;
    if (recipientUserId === null) continue;
    out.push({ activity, recipientUserId, opportunity });
  }
  return out;
}
