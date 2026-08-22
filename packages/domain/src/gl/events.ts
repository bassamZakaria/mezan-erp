import type { Money } from "../money/index.js";

/**
 * GL-internal domain events.
 *
 * These are distinct from the notification-rule taxonomy in `events/catalog.ts`
 * (that catalog is a closed set of 39 user-facing notification triggers). GL
 * posting events are an *internal* ledger signal that other engines/sub-ledgers
 * (treasury, inventory valuation, reconciliation) react to. Keeping them on
 * their own tiny publisher port avoids widening the notification catalog and
 * lets the engine emit even when no notification bus is wired.
 */
export type GlEventType = "JOURNAL_ENTRY_POSTED" | "JOURNAL_ENTRY_REVERSED";

export interface GlDomainEvent {
  readonly type: GlEventType;
  readonly entryId: string;
  readonly entryNo: string | null;
  readonly date: string;
  readonly source: string;
  readonly totalDebit: Money;
  readonly totalCredit: Money;
  /** For a reversal: the id of the entry that was reversed. */
  readonly reversesEntryId?: string | null;
  readonly occurredAt: string;
}

/** Minimal publisher port. The engine calls `publish` after a successful post/reverse. */
export interface GlEventPublisher {
  publish(event: GlDomainEvent): void;
}
