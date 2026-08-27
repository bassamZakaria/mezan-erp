import type { Money } from "../money/index.js";

/**
 * Bank Statement Reconciliation — core entities (docs/catalog/04-accounting-
 * treasury.md "تسوية كشوف البنك"). A `BankStatement` is one imported CSV
 * period for a bank treasury account; each `StatementLine` is one row,
 * matched (or not) against a treasury GL movement.
 */

export type BankStatementSource = "csv";
export type BankStatementStatus = "imported" | "in_progress" | "completed";
export type StatementLineStatus = "unmatched" | "matched";

export interface BankStatementStatusDefinition {
  readonly code: BankStatementStatus;
  readonly labelAr: string;
}

/** Ordered exactly as docs/catalog/04 lists the status filter tabs. */
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
  readonly source: BankStatementSource;
  readonly statementNumber: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly openingBalance: Money;
  readonly closingBalance: Money;
  readonly status: BankStatementStatus;
  readonly importedAt: string;
  readonly finalizedAt: string | null;
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
}

export interface BankStatementListFilter {
  readonly treasuryAccountId?: string;
  readonly status?: BankStatementStatus;
  readonly fromDate?: string;
  readonly toDate?: string;
}

/** Persistence port for bank statements + their lines. */
export interface BankStatementRepository {
  save(statement: BankStatement): Promise<void>;
  update(statement: BankStatement): Promise<void>;
  findById(id: string): Promise<BankStatement | null>;
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
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * A CSV column mapping, persisted per treasury account ("يحفظ التعيين لكل
 * حساب" — docs/catalog/04). Exactly one amount strategy is set: either
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
