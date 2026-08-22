import { Money } from "./money/index.js";
import type { RoleRepository } from "./roles/role.js";
import type { UserRepository } from "./users/user.js";

/** A single debit/credit line of a journal entry (docs/catalog/04). */
export interface JournalLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
}

/**
 * A posted journal entry. The spike only models the terminal "posted" state;
 * the full draft -> pending -> posted -> reversed lifecycle (catalog 04) is
 * later work.
 */
export interface JournalEntry {
  readonly id: string;
  readonly date: string;
  readonly memo: string;
  readonly status: "posted";
  readonly lines: readonly JournalLine[];
}

/**
 * Persistence port. The domain depends on this interface only — it imports no
 * SQL, no driver, no HTTP. Any dialect (SQLite now, Postgres later) slots in
 * behind it. See docs/plan.md §2.2.
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
