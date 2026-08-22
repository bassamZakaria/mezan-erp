import { Money } from "./money/index.js";
import type { RoleRepository } from "./roles/role.js";
import type { UserRepository } from "./users/user.js";

/**
 * How a journal entry came into being (docs/catalog/04 §القيود المحاسبية): the
 * "المصدر" column distinguishes entries typed by a user ("manual") from those
 * auto-posted by another document/module — invoice, voucher, work order
 * ("system"). The overwhelming majority in a live tenant are system-generated.
 */
export type JournalEntrySource = "manual" | "system";

/**
 * The journal-entry lifecycle from docs/catalog/04 (status filter tabs مسودة /
 * بانتظار الموافقة / مرحل / معكوس): draft → pending → posted → reversed. Posted
 * entries are append-only — a correction is a *reversing entry*, never a
 * mutation (docs/plan.md §3 rule 1). The spike modelled only the terminal
 * "posted" value; the GL engine (gl/) uses the full union.
 */
export type JournalEntryStatus = "draft" | "pending" | "posted" | "reversed";

/** A single debit/credit line of a journal entry (docs/catalog/04). */
export interface JournalLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
  /** Per-line description ("الوصف" column in the JE line table). Optional. */
  readonly memo?: string | null;
  /**
   * Optional cost-center dimension ("مركز التكلفة") carried by the line — the
   * basis of the "أرباح مراكز التكلفة" (Cost Center P&L) report which groups
   * revenue/expense lines by this tag (docs/catalog/04). Null = unattributed.
   */
  readonly costCenterId?: string | null;
  /**
   * Original transaction currency for a multi-currency line (docs/catalog/04
   * §"أسعار الصرف"/§FX Revaluation). `debit`/`credit` are ALWAYS the base
   * (EGP) amounts; these two record what foreign currency + rate produced them
   * at confirmation time, so the line can be revalued at the closing rate.
   * Null/"EGP" = a base-currency line.
   */
  readonly currency?: string | null;
  /** Exchange rate (foreign→base) applied at confirmation, as an exact decimal string. Null for base-currency lines. */
  readonly fxRate?: string | null;
}

/**
 * A journal entry. The spike modelled only the terminal "posted" shape; the GL
 * engine (gl/) populates the full lifecycle fields below. They are optional so
 * the spike's minimal poster and the legacy `/journal-entries` route keep
 * constructing the same type without change.
 */
export interface JournalEntry {
  readonly id: string;
  readonly date: string;
  readonly memo: string;
  readonly status: JournalEntryStatus;
  readonly lines: readonly JournalLine[];
  /** Sequential document number ("JE-000001"), assigned by the numbering engine at post time; null while a draft. */
  readonly entryNo?: string | null;
  readonly source?: JournalEntrySource;
  /** ISO-8601 UTC creation timestamp. */
  readonly createdAt?: string;
  /** ISO-8601 UTC posting timestamp; null until posted. */
  readonly postedAt?: string | null;
  /** On a reversing entry: the id of the posted entry it reverses. */
  readonly reversesEntryId?: string | null;
  /** On a reversed entry: the id of the reversing entry that offset it. */
  readonly reversedByEntryId?: string | null;
}

/**
 * Persistence port. The domain depends on this interface only — it imports no
 * SQL, no driver, no HTTP. Any dialect (SQLite now, Postgres later) slots in
 * behind it. See docs/plan.md §2.2. The richer GL ledger port lives in
 * gl/ledger.ts; this minimal one backs the spike's `postJournalEntry`.
 */
export interface JournalRepository {
  save(entry: JournalEntry): Promise<void>;
  findById(id: string): Promise<JournalEntry | null>;
}

/** Unit-of-Work port: one atomic transaction per state-changing use case. */
export interface UnitOfWork {
  readonly journal: JournalRepository;
  readonly roles: RoleRepository;
  readonly users: UserRepository;
  transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
}
