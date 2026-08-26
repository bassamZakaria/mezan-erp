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
  /**
   * The VAT rate this line was charged at, as a percentage (14, 5, 0…).
   *
   * Carried on BOTH the taxable base line and the VAT line it produced, because
   * the VAT return needs to report the rates actually charged. Without it the
   * report could only divide tax by base per ENTRY, which blends a 14% / 5% /
   * zero-rated invoice into one meaningless ~6.3% bucket (D28). Null on lines
   * that carry no tax dimension at all, and on entries posted before the field
   * existed — the report falls back to the old derivation for those.
   */
  readonly taxRatePercent?: number | null;
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
  /**
   * The document that produced this entry (R6.3). Carried so the journal list
   * can name the module an entry came from and link back to its source —
   * without it, a posted entry is anonymous the moment you leave the document
   * that made it.
   */
  readonly sourceDocType?: string | null;
  readonly sourceDocId?: string | null;
  readonly sourceDocNumber?: string | null;
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

/**
 * Which module produced a journal entry (R6.3). Derived from the posting
 * document's type rather than stored twice: a module recorded separately from
 * the document type is a second source of truth that can disagree with it.
 *
 * `manual` covers an entry a person typed; `unknown` is honest about an entry
 * whose document type predates this field rather than guessing a module.
 */
export type JournalSourceModule =
  | "sales"
  | "purchases"
  | "inventory"
  | "treasury"
  | "manufacturing"
  | "payroll"
  | "assets"
  | "manual"
  | "unknown";

const MODULE_BY_DOC_TYPE: Readonly<Record<string, JournalSourceModule>> = {
  SALES_INVOICE: "sales",
  SALES_RETURN: "sales",
  SALES_QUOTE: "sales",
  PURCHASE_INVOICE: "purchases",
  PURCHASE_RETURN: "purchases",
  PURCHASE_ORDER: "purchases",
  GOODS_RECEIPT: "purchases",
  // The stock ledger and the GL name a receipt differently; both reach here.
  PURCHASE_RECEIPT: "purchases",
  LANDED_COST: "purchases",
  ADJUSTMENT: "inventory",
  STOCK_ADJUSTMENT: "inventory",
  TRANSFER: "inventory",
  STOCK_TRANSFER: "inventory",
  WRITEDOWN_RUN: "inventory",
  TREASURY_VOUCHER: "treasury",
  CHEQUE: "treasury",
  WORK_ORDER: "manufacturing",
  PAYROLL_RUN: "payroll",
  LEAVE_ACCRUAL: "payroll",
  EMPLOYEE_ADVANCE: "payroll",
  DEPRECIATION_RUN: "assets",
  ASSET_DISPOSAL: "assets",
  JOURNAL_ENTRY: "manual",
};

/**
 * `source` disambiguates the missing case: an entry a person typed genuinely
 * has no document, while a system entry with no document type is one whose
 * poster does not yet carry it. Calling the second one "manual" would put
 * machine postings in the column a human is accountable for.
 */
export function journalSourceModule(
  sourceDocType: string | null | undefined,
  source?: JournalEntrySource | null,
): JournalSourceModule {
  if (!sourceDocType) return source === "system" ? "unknown" : "manual";
  return MODULE_BY_DOC_TYPE[sourceDocType] ?? "unknown";
}
