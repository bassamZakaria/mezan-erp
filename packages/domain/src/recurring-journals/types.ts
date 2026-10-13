import type { CostCategory } from "../contracting/cost-category.js";
import { Money } from "../money/index.js";

/**
 * Recurring & template journal automation (ENH-012 / ENH-E2-02,
 * docs/superpowers/plans/2026-09-19-enhancements-e1-e3.md §2 "E2-02 Recurring
 * journals"). Rent, depreciation accruals, prepaid amortization — a template
 * holds the lines once; `generate-due-drafts` re-keys nothing.
 *
 * Ref: QuickBooks Online recurring transactions (reminder type), Xero
 * repeating journals, Odoo auto-post.
 */
export enum RecurringJournalFrequency {
  Monthly = "monthly",
  Quarterly = "quarterly",
  Yearly = "yearly",
}

/** A closed value set (owner's code-style rule): an enum, never a raw string union. */
export enum RecurringJournalTemplateStatus {
  Active = "active",
  Paused = "paused",
}

/**
 * A template's line. Same shape a hand-written journal line takes at the
 * accounts this feature actually posts through (`createJournalEntry`,
 * `gl/post.ts`) — cost centre and branch are optional dimensions, and
 * `partyId` is required by that same engine's `assertPartyLines` the moment
 * `accountId` names a customer/supplier control account (D205).
 */
export interface RecurringJournalTemplateLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
  readonly memo?: string | null;
  readonly costCenterId?: string | null;
  readonly branchId?: string | null;
  readonly partyId?: string | null;
  readonly projectId?: string | null;
  readonly costCategory?: CostCategory | null;
}

export interface RecurringJournalTemplate {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  /** The memo stamped on every generated journal entry, suffixed with its period. */
  readonly memo: string;
  readonly frequency: RecurringJournalFrequency;
  /**
   * The day within the period the generated entry is dated — 1..31, clamped to
   * the target month's actual last day (so a "31" template on February still
   * generates on the 28th/29th rather than failing).
   */
  readonly dayOfPeriod: number;
  /** Yearly templates only: which calendar month (1..12) the entry falls in. Null for monthly/quarterly. */
  readonly yearlyMonth: number | null;
  readonly startDate: string;
  /** Null = runs indefinitely. */
  readonly endDate: string | null;
  /**
   * Accrual reversal: alongside the due period's draft, a mirror-image draft
   * (debit and credit swapped) is generated in the SAME `generate-due` call,
   * dated the first day of the next period — never on a later timer (ROADMAP
   * DEC-28 / §3.3: no desktop timer acts on the tenant's behalf).
   */
  readonly autoReverseNextPeriod: boolean;
  readonly status: RecurringJournalTemplateStatus;
  readonly lines: readonly RecurringJournalTemplateLine[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One (template, period) generation — the idempotency record `generate-due` checks before it creates anything. */
export interface RecurringJournalRun {
  readonly id: string;
  readonly templateId: string;
  /** "YYYY-MM" (monthly), "YYYY-Qn" (quarterly) or "YYYY" (yearly) — see schedule.ts. */
  readonly period: string;
  /** INVARIANT: a period gets a new generation only once the entry of its newest one is reversed. */
  readonly generation: number;
  readonly journalEntryId: string;
  readonly journalEntryNo: string | null;
  /** The accrual's auto-reversal, when the template asked for one. */
  readonly reversalJournalEntryId: string | null;
  readonly reversalJournalEntryNo: string | null;
  readonly generatedAt: string;
  readonly generatedBy: string;
}

/**
 * One (template, period) an operator deliberately chose NOT to generate — the
 * landlord waived a month, a depreciation run is being handled by hand this
 * once. Its own table, its own `UNIQUE(template_id, period)` claim, so the
 * period is exactly as unavailable to a later `generate-due` sweep as a real
 * run would leave it, without inventing a journal entry that never happened.
 */
export interface RecurringJournalSkip {
  readonly id: string;
  readonly templateId: string;
  /** Same period-key shape as {@link RecurringJournalRun.period}. */
  readonly period: string;
  readonly note: string | null;
  readonly skippedAt: string;
  readonly skippedBy: string;
}

export class RecurringJournalTemplateNotFoundError extends Error {
  readonly code = "RECURRING_JOURNAL_TEMPLATE_NOT_FOUND";
  constructor(readonly templateId: string) {
    super(`لا يوجد قالب قيد متكرر بالمعرّف "${templateId}".`);
  }
}

export class InvalidRecurringJournalScheduleError extends Error {
  readonly code = "INVALID_RECURRING_JOURNAL_SCHEDULE";
  constructor(message: string) {
    super(message);
  }
}

/** Raised when "skip this occurrence" is asked for a (template, period) that already has a generated journal entry. */
export class RecurringJournalPeriodAlreadyGeneratedError extends Error {
  readonly code = "RECURRING_JOURNAL_PERIOD_ALREADY_GENERATED";
  readonly messageEn: string;
  constructor(readonly templateId: string, readonly period: string) {
    super(`تم بالفعل توليد قيد لهذه الفترة "${period}"، فلا يمكن تخطّيها.`);
    this.messageEn = `A journal entry was already generated for period "${period}"; it cannot be skipped.`;
    this.name = "RecurringJournalPeriodAlreadyGeneratedError";
  }
}

/** Raised when "skip this occurrence" is asked twice for the same (template, period) — the atomic claim lost the race or the caller retried. */
export class RecurringJournalPeriodAlreadySkippedError extends Error {
  readonly code = "RECURRING_JOURNAL_PERIOD_ALREADY_SKIPPED";
  readonly messageEn: string;
  constructor(readonly templateId: string, readonly period: string) {
    super(`تم تخطّي هذه الفترة "${period}" من قبل.`);
    this.messageEn = `Period "${period}" was already skipped.`;
    this.name = "RecurringJournalPeriodAlreadySkippedError";
  }
}
