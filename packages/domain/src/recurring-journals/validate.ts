import { InactiveAccountError, assertBalanced, assertEntryStructure, assertPartyLines, type JournalPostingDeps } from "../gl/index.js";
import { AccountNotFoundError, HeaderAccountNotPostableError, type AccountRepository } from "../accounts/index.js";
import { RecurringJournalFrequency, InvalidRecurringJournalScheduleError, type RecurringJournalTemplateLine } from "./types.js";

export interface ValidateTemplateDeps {
  /** Every referenced account must exist, be postable and active — the same check a hand-written journal line gets. */
  readonly accounts?: Pick<AccountRepository, "findById">;
  readonly partyControlAccounts?: JournalPostingDeps["partyControlAccounts"];
  readonly partyExists?: JournalPostingDeps["partyExists"];
}

/**
 * Validates a template's lines with the SAME engine a hand-written journal
 * line answers to (`gl/post.ts`): balanced, structurally sound, and a party
 * named on every control-account line (D205) — checked at save time rather
 * than left to surface as a generation failure months into the schedule.
 */
export async function assertValidTemplateLines(
  lines: readonly RecurringJournalTemplateLine[],
  deps: ValidateTemplateDeps = {},
): Promise<void> {
  assertEntryStructure(lines);
  assertBalanced(lines);
  await assertPartyLines(lines, deps);
  if (deps.accounts) {
    const checked = new Set<string>();
    for (const line of lines) {
      if (checked.has(line.accountId)) continue;
      checked.add(line.accountId);
      const account = await deps.accounts.findById(line.accountId);
      if (!account) throw new AccountNotFoundError(line.accountId);
      if (account.isHeader) throw new HeaderAccountNotPostableError(account.id);
      if (account.status !== "active") throw new InactiveAccountError(account.id);
    }
  }
}

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function assertValidSchedule(input: {
  readonly frequency: RecurringJournalFrequency;
  readonly dayOfPeriod: number;
  readonly yearlyMonth: number | null;
  readonly startDate: string;
  readonly endDate: string | null;
}): void {
  if (!isValidDateString(input.startDate)) {
    throw new InvalidRecurringJournalScheduleError("تاريخ البداية غير صالح.");
  }
  if (input.endDate !== null) {
    if (!isValidDateString(input.endDate)) {
      throw new InvalidRecurringJournalScheduleError("تاريخ النهاية غير صالح.");
    }
    if (input.endDate < input.startDate) {
      throw new InvalidRecurringJournalScheduleError("تاريخ النهاية لا يمكن أن يسبق تاريخ البداية.");
    }
  }
  if (!Number.isInteger(input.dayOfPeriod) || input.dayOfPeriod < 1 || input.dayOfPeriod > 31) {
    throw new InvalidRecurringJournalScheduleError("يوم الاستحقاق يجب أن يكون رقماً من 1 إلى 31.");
  }
  if (input.frequency === RecurringJournalFrequency.Yearly) {
    if (
      input.yearlyMonth === null ||
      !Number.isInteger(input.yearlyMonth) ||
      input.yearlyMonth < 1 ||
      input.yearlyMonth > 12
    ) {
      throw new InvalidRecurringJournalScheduleError("القالب السنوي يتطلب شهراً من 1 إلى 12.");
    }
  } else if (input.yearlyMonth !== null) {
    throw new InvalidRecurringJournalScheduleError("شهر الاستحقاق السنوي لا يُستخدم إلا مع التكرار السنوي.");
  }
}
