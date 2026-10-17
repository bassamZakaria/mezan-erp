import { stepReached } from "./policy.js";
import type { CollectionCustomerRow } from "./worklist.js";
import {
  DunningReminderStatus,
  DunningVoidReason,
  type CollectionWorkItem,
  type DunningPolicy,
  type DunningReminder,
  type DunningStep,
} from "./types.js";
import type { RenderedMessage } from "./message.js";

export interface DunningRunInput {
  readonly policy: DunningPolicy;
  readonly rows: readonly CollectionCustomerRow[];
  readonly existing: readonly DunningReminder[];
  readonly heldCustomerIds: ReadonlySet<string>;
  readonly pendingPromiseCustomerIds: ReadonlySet<string>;
  readonly customerIds?: ReadonlySet<string>;
  readonly asOfDate: string;
  readonly now: string;
  readonly actor: string;
  readonly idGen: () => string;
  readonly render: (step: DunningStep, row: CollectionCustomerRow, item: CollectionWorkItem) => RenderedMessage;
}

export interface DunningRunPlan {
  readonly toInsert: readonly DunningReminder[];
  readonly toVoid: readonly DunningReminder[];
  readonly skippedHeld: number;
  readonly skippedPromised: number;
  readonly skippedBelowMinimum: number;
}

export interface DueStepSummary {
  readonly step: DunningStep;
  readonly count: number;
}

export function dueStepFor(
  policy: DunningPolicy,
  item: CollectionWorkItem,
  existing: readonly DunningReminder[],
): DunningStep | null {
  if (item.daysOverdue <= 0) return null;
  const step = stepReached(policy, item.daysOverdue);
  if (!step) return null;
  return existing.some((r) => r.itemKey === item.key && r.stepId === step.id) ? null : step;
}

export function planDunningRun(input: DunningRunInput): DunningRunPlan {
  const { policy } = input;
  const byItem = new Map<string, DunningReminder[]>();
  for (const reminder of input.existing) {
    const list = byItem.get(reminder.itemKey) ?? [];
    list.push(reminder);
    byItem.set(reminder.itemKey, list);
  }
  const overdueKeys = new Set<string>();
  for (const row of input.rows) for (const item of row.items) if (item.daysOverdue > 0) overdueKeys.add(item.key);

  const toInsert: DunningReminder[] = [];
  const toVoid = new Map<string, DunningReminder>();
  let skippedHeld = 0;
  let skippedPromised = 0;
  let skippedBelowMinimum = 0;

  for (const row of input.rows) {
    if (input.customerIds && !input.customerIds.has(row.customerId)) continue;
    const due = row.items.filter((item) => dueStepFor(policy, item, byItem.get(item.key) ?? []) !== null);
    if (due.length === 0) continue;
    if (input.heldCustomerIds.has(row.customerId)) {
      skippedHeld += due.length;
      continue;
    }
    if (policy.pauseWhilePromisePending && input.pendingPromiseCustomerIds.has(row.customerId)) {
      skippedPromised += due.length;
      continue;
    }
    if (row.overdue.scaled < policy.minimumOverdueAmount.scaled) {
      skippedBelowMinimum += due.length;
      continue;
    }
    for (const item of due) {
      const step = dueStepFor(policy, item, byItem.get(item.key) ?? [])!;
      for (const earlier of byItem.get(item.key) ?? []) {
        if (earlier.status === DunningReminderStatus.Prepared) {
          toVoid.set(earlier.id, { ...earlier, status: DunningReminderStatus.Voided, voidReason: DunningVoidReason.Superseded });
        }
      }
      const message = input.render(step, row, item);
      toInsert.push({
        id: input.idGen(),
        itemKey: item.key,
        stepId: step.id,
        stepLevel: step.level,
        customerId: row.customerId,
        documentId: item.documentId,
        reference: item.reference,
        channel: step.channel,
        subject: message.subject,
        body: message.body,
        amount: item.amount,
        daysOverdue: item.daysOverdue,
        dueDate: item.dueDate,
        status: DunningReminderStatus.Prepared,
        voidReason: null,
        failureReason: null,
        messageId: null,
        preparedOn: input.asOfDate,
        preparedAt: input.now,
        preparedBy: input.actor,
        sentAt: null,
        sentBy: null,
        outcome: null,
      });
    }
  }

  for (const reminder of input.existing) {
    if (reminder.status !== DunningReminderStatus.Prepared || overdueKeys.has(reminder.itemKey)) continue;
    if (input.customerIds && !input.customerIds.has(reminder.customerId)) continue;
    toVoid.set(reminder.id, { ...reminder, status: DunningReminderStatus.Voided, voidReason: DunningVoidReason.Settled });
  }

  return { toInsert, toVoid: [...toVoid.values()], skippedHeld, skippedPromised, skippedBelowMinimum };
}
