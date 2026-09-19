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
  readonly journalEntryId: string;
  readonly journalEntryNo: string | null;
  /** The accrual's auto-reversal, when the template asked for one. */
  readonly reversalJournalEntryId: string | null;
  readonly reversalJournalEntryNo: string | null;
  readonly generatedAt: string;
  readonly generatedBy: string;
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
