import type { Money } from "../money/index.js";

/**
 * Bank Statement Reconciliation — core entities (docs/archive/catalog/04-accounting-
 * treasury.md "تسوية كشوف البنك"). A `BankStatement` is one imported CSV
 * period for a bank treasury account; each `StatementLine` is one row,
 * matched (or not) against a treasury GL movement.
 */

export enum BankStatementSource {
  Csv = "csv",
  Excel = "excel",
  Ofx = "ofx",
  Mt940 = "mt940",
}

export enum MatchSource {
  Manual = "manual",
  Auto = "auto",
  Suggestion = "suggestion",
  CreatedEntry = "created_entry",
}
export type BankStatementStatus = "imported" | "in_progress" | "completed";
export type StatementLineStatus = "unmatched" | "matched";

export interface BankStatementStatusDefinition {
  readonly code: BankStatementStatus;
  readonly labelAr: string;
}

/** Ordered exactly as docs/archive/catalog/04 lists the status filter tabs. */
export const BANK_STATEMENT_STATUS_DEFINITIONS: readonly BankStatementStatusDefinition[] = [
  { code: "imported", labelAr: "مستورد" },
  { code: "in_progress", labelAr: "قيد التسوية" },
  { code: "completed", labelAr: "منتهية" },
] as const;

export function getBankStatementStatusLabel(status: BankStatementStatus): string {
  return BANK_STATEMENT_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

export interface BankStatement {
  readonly id: string;
  readonly treasuryAccountId: string;
  /**
   * The branch that owns the reconciled treasury account, stamped server-side
   * at import. Null on statements imported before the field existed; those
   * stay visible under every scope, exactly as `withinScope` keeps an
   * unattributable row visible.
   */
  readonly branchId: string | null;
  /**
   * The currency every amount on this statement is expressed in — the treasury
   * account's own currency at import. A book entry posted in another currency
   * can never equal a line here, so the match refuses instead of comparing a
   * foreign figure with a base one.
   */
  readonly currency: string;
  /**
   * A deterministic digest of what was imported (account, period, balances and
   * every row). Re-importing the same file produces the same value, which is
   * what lets the second import be recognised rather than duplicated.
   */
  readonly importFingerprint: string | null;
  readonly source: BankStatementSource;
  readonly statementNumber: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly openingBalance: Money;
  readonly closingBalance: Money;
  readonly status: BankStatementStatus;
  readonly importedAt: string;
  readonly finalizedAt: string | null;
  /**
   * How many lines were still unmatched at the moment this statement was
   * locked. Zero on a clean reconciliation; nonzero only when someone used the
   * explicit override, and then `finalizeOverrideReason` says why (D82).
   * Null on statements finalised before the field existed.
   */
  readonly unmatchedAtFinalize?: number | null;
  readonly finalizeOverrideReason?: string | null;
  readonly finalizedBy?: string | null;
  readonly differenceAtFinalize?: Money | null;
}

/**
 * One statement row. `amount` is signed: positive = money IN (a bank credit /
 * deposit), negative = money OUT (a bank debit / withdrawal) — the same
 * convention `TreasuryLedgerCandidate.amount` uses so the two compare
 * directly (see matching.ts).
 */
export interface StatementLine {
  readonly id: string;
  readonly statementId: string;
  readonly date: string;
  readonly description: string;
  readonly reference: string | null;
  readonly amount: Money;
  readonly status: StatementLineStatus;
  /** The matched treasury GL entry id (`AccountLedgerLine.entryId`), or null. */
  readonly matchedEntryId: string | null;
  readonly matchedAt: string | null;
  readonly counterparty?: string | null;
  /** Every entry the line is matched to; one for a 1:1 match, N for a split (1:N) whose amounts sum exactly to the line. */
  readonly matchedEntryIds?: readonly string[];
  readonly matchSource?: MatchSource | null;
}

/**
 * The largest magnitude an opening or closing balance can carry through the
 * SQLite column, which stores the scaled integer as a JS number. Bank
 * accounts may run negative (overdraft), so this bounds |scaled| rather than
 * just an upper end — mirrors `MAX_OPENING_BALANCE_SCALED` in
 * packages/domain/src/treasury-accounts/treasury-account.ts.
 */
export const MAX_STATEMENT_BALANCE_SCALED = BigInt(Number.MAX_SAFE_INTEGER);

export interface BankStatementListFilter {
  readonly treasuryAccountId?: string;
  readonly status?: BankStatementStatus;
  readonly fromDate?: string;
  readonly toDate?: string;
  /**
   * The caller's own branch authority. Undefined means every branch; a list
   * narrowed by it also keeps statements carrying no branch, which is the same
   * rule `withinScope` applies everywhere else.
   */
  readonly branchIds?: readonly string[];
}

/** Persistence port for bank statements + their lines. */
export interface BankStatementRepository {
  save(statement: BankStatement): Promise<void>;
  update(statement: BankStatement): Promise<void>;
  findById(id: string): Promise<BankStatement | null>;
  /** The statement a previous import of the same file produced, if there is one. */
  findByFingerprint(treasuryAccountId: string, fingerprint: string): Promise<BankStatement | null>;
  list(filter?: BankStatementListFilter): Promise<readonly BankStatement[]>;
  saveLines(lines: readonly StatementLine[]): Promise<void>;
  saveLine(line: StatementLine): Promise<void>;
  updateLine(line: StatementLine): Promise<void>;
  findLineById(id: string): Promise<StatementLine | null>;
  listLines(statementId: string): Promise<readonly StatementLine[]>;
  /**
   * Matched/total line counts for many statements at once. The list screen shows
   * a match rate per row, and loading every line of every statement to count
   * them is one query per row.
   */
  lineCounts(statementIds: readonly string[]): Promise<ReadonlyMap<string, { total: number; matched: number }>>;
  /** Replace the entry links of one line; an empty list clears them. */
  replaceLineMatches(line: StatementLine, treasuryAccountId: string, entryIds: readonly string[]): Promise<void>;
  /** Entry ids matched to any line of any statement of this treasury account, legacy single-entry matches included. */
  matchedEntryIdsForAccount(treasuryAccountId: string): Promise<ReadonlySet<string>>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * A CSV column mapping, persisted per treasury account ("يحفظ التعيين لكل
 * حساب" — docs/archive/catalog/04). Exactly one amount strategy is set: either
 * `amountColumn` (a single signed column) or both `debitColumn`+`creditColumn`
 * (a two-column statement; net amount = credit − debit).
 */
export type StatementDateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";

export interface StatementColumnMapping {
  readonly treasuryAccountId: string;
  readonly dateColumn: string;
  readonly descriptionColumn: string;
  readonly amountColumn: string | null;
  readonly debitColumn: string | null;
  readonly creditColumn: string | null;
  readonly referenceColumn: string | null;
  readonly dateFormat: StatementDateFormat;
  readonly updatedAt: string;
}

/** Persistence port for the per-account column mapping. */
export interface StatementColumnMappingRepository {
  findByTreasuryAccount(treasuryAccountId: string): Promise<StatementColumnMapping | null>;
  upsert(mapping: StatementColumnMapping): Promise<void>;
}
