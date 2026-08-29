/**
 * BankReconciliationService — the bank-statement-reconciliation application
 * service (docs/archive/catalog/04 "تسوية كشوف البنك").
 *
 * Owns the CSV-import → auto/manual-match → finalize workflow: import parses
 * the file through the per-account persisted column mapping (csv.ts) and
 * saves the statement + its lines "مستورد"; matching (auto-suggested via
 * matching.ts, or explicit) moves the statement to "قيد التسوية" on its first
 * match; finalize locks it "منتهية". No GL posting happens here — matching a
 * line only links it to an ALREADY-posted treasury movement (a voucher or
 * cheque entry); it never creates one.
 */

import type { Money } from "../money/index.js";
import type {
  BankStatement,
  BankStatementListFilter,
  BankStatementRepository,
  StatementColumnMapping,
  StatementColumnMappingRepository,
  StatementLine,
} from "./bank-statement.js";
import { mapCsvRows, parseCsv } from "./csv.js";
import { suggestMatches, type TreasuryLedgerCandidate, type TreasuryLedgerReader } from "./matching.js";
import {
  BankStatementNotFoundError,
  LineAlreadyMatchedError,
  LineNotMatchedError,
  StatementAlreadyFinalizedError,
  StatementLineNotFoundError,
} from "./errors.js";

export interface ImportStatementCommand {
  readonly id: string;
  readonly treasuryAccountId: string;
  readonly rawCsv: string;
  /** The mapping to use for this import; also persisted as the account's saved mapping. */
  readonly mapping: Omit<StatementColumnMapping, "treasuryAccountId" | "updatedAt">;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly openingBalance: Money;
  readonly closingBalance: Money;
  readonly statementNumber?: string | null;
}

/**
 * A statement line plus the NUMBER of the journal entry it is matched to.
 *
 * The line itself stores only `matchedEntryId`, because the id is what makes
 * the match; the number is only a label, resolved on read.
 */
export interface MatchedStatementLine extends StatementLine {
  readonly matchedEntryNo: string | null;
}

export interface AddManualLineCommand {
  readonly id: string;
  readonly statementId: string;
  readonly date: string;
  readonly description: string;
  readonly reference?: string | null;
  readonly amount: Money;
}

export interface MatchSummary {
  readonly total: number;
  readonly matched: number;
  readonly unmatched: number;
  readonly matchRate: number;
}

export interface BankReconciliationServiceDeps {
  readonly statements: BankStatementRepository;
  readonly mappings: StatementColumnMappingRepository;
  readonly ledgerReader: TreasuryLedgerReader;
  readonly now?: () => string;
}

const MANUAL_MATCH_SLACK_DAYS = 10;

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export class BankReconciliationService {
  constructor(private readonly deps: BankReconciliationServiceDeps) {}

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }

  async getColumnMapping(treasuryAccountId: string): Promise<StatementColumnMapping | null> {
    return this.deps.mappings.findByTreasuryAccount(treasuryAccountId);
  }

  /** Import a CSV statement: persists the column mapping for the account, then the statement + its parsed lines. */
  async importStatement(cmd: ImportStatementCommand): Promise<{ statement: BankStatement; lines: readonly StatementLine[] }> {
    const stamp = this.now();
    const mapping: StatementColumnMapping = { ...cmd.mapping, treasuryAccountId: cmd.treasuryAccountId, updatedAt: stamp };
    const table = parseCsv(cmd.rawCsv);
    const mapped = mapCsvRows(table, mapping);

    const statement: BankStatement = {
      id: cmd.id,
      treasuryAccountId: cmd.treasuryAccountId,
      source: "csv",
      statementNumber: cmd.statementNumber ?? null,
      periodStart: cmd.periodStart,
      periodEnd: cmd.periodEnd,
      openingBalance: cmd.openingBalance,
      closingBalance: cmd.closingBalance,
      status: "imported",
      importedAt: stamp,
      finalizedAt: null,
    };
    const lines: StatementLine[] = mapped.map((row, index) => ({
      id: `${cmd.id}:L${index}`,
      statementId: cmd.id,
      date: row.date,
      description: row.description,
      reference: row.reference,
      amount: row.amount,
      status: "unmatched",
      matchedEntryId: null,
      matchedAt: null,
    }));

    await this.deps.statements.transaction(async () => {
      await this.deps.mappings.upsert(mapping);
      await this.deps.statements.save(statement);
      await this.deps.statements.saveLines(lines);
    });

    return { statement, lines };
  }

  /** Auto-suggest and directly apply exact matches (amount + date-tolerance) against the account's treasury ledger. */
  async autoMatch(statementId: string): Promise<{ matchedCount: number }> {
    const statement = await this.require(statementId);
    const lines = await this.deps.statements.listLines(statementId);
    const candidates = await this.deps.ledgerReader.entriesForTreasuryAccount(
      statement.treasuryAccountId,
      statement.periodStart,
      statement.periodEnd,
    );
    const suggestions = suggestMatches(lines, candidates);
    const byId = new Map(lines.map((l) => [l.id, l]));
    const stamp = this.now();
    for (const s of suggestions) {
      const line = byId.get(s.lineId)!;
      await this.deps.statements.updateLine({ ...line, status: "matched", matchedEntryId: s.entryId, matchedAt: stamp });
    }
    if (suggestions.length > 0 && statement.status === "imported") {
      await this.deps.statements.update({ ...statement, status: "in_progress" });
    }
    return { matchedCount: suggestions.length };
  }

  async matchLine(statementId: string, lineId: string, entryId: string): Promise<StatementLine> {
    const statement = await this.require(statementId);
    this.assertNotFinalized(statement);
    const line = await this.requireLine(lineId);
    if (line.status === "matched") throw new LineAlreadyMatchedError(lineId);

    const updated: StatementLine = { ...line, status: "matched", matchedEntryId: entryId, matchedAt: this.now() };
    await this.deps.statements.updateLine(updated);
    if (statement.status === "imported") {
      await this.deps.statements.update({ ...statement, status: "in_progress" });
    }
    return updated;
  }

  async unmatchLine(statementId: string, lineId: string): Promise<StatementLine> {
    const statement = await this.require(statementId);
    this.assertNotFinalized(statement);
    const line = await this.requireLine(lineId);
    if (line.status === "unmatched") throw new LineNotMatchedError(lineId);

    const updated: StatementLine = { ...line, status: "unmatched", matchedEntryId: null, matchedAt: null };
    await this.deps.statements.updateLine(updated);
    return updated;
  }

  /** Manually add a line the CSV import missed. */
  async addManualLine(cmd: AddManualLineCommand): Promise<StatementLine> {
    const statement = await this.require(cmd.statementId);
    this.assertNotFinalized(statement);
    const line: StatementLine = {
      id: cmd.id,
      statementId: cmd.statementId,
      date: cmd.date,
      description: cmd.description,
      reference: cmd.reference ?? null,
      amount: cmd.amount,
      status: "unmatched",
      matchedEntryId: null,
      matchedAt: null,
    };
    await this.deps.statements.saveLine(line);
    return line;
  }

  /** Lock the statement: قيد التسوية/مستورد → منتهية. Idempotency-guarded — cannot finalize twice. */
  async finalize(statementId: string): Promise<BankStatement> {
    const statement = await this.require(statementId);
    this.assertNotFinalized(statement);
    const updated: BankStatement = { ...statement, status: "completed", finalizedAt: this.now() };
    await this.deps.statements.update(updated);
    return updated;
  }

  async matchSummary(statementId: string): Promise<MatchSummary> {
    const lines = await this.deps.statements.listLines(statementId);
    const matched = lines.filter((l) => l.status === "matched").length;
    const total = lines.length;
    return { total, matched, unmatched: total - matched, matchRate: total === 0 ? 0 : matched / total };
  }

  /**
   * The treasury-side movements a human can manually match this statement's
   * lines against — the account's own GL ledger over the statement period,
   * widened by `MANUAL_MATCH_SLACK_DAYS` because manual matching exists
   * precisely for the movements auto-match's ±5-day window could not reach.
   *
   * Entries already matched to a line of THIS statement are excluded, so the
   * picker cannot offer the same entry to two lines.
   */
  async matchCandidates(statementId: string): Promise<readonly TreasuryLedgerCandidate[]> {
    const statement = await this.require(statementId);
    const lines = await this.deps.statements.listLines(statementId);
    const taken = new Set(lines.map((l) => l.matchedEntryId).filter((id): id is string => id !== null));
    const candidates = await this.deps.ledgerReader.entriesForTreasuryAccount(
      statement.treasuryAccountId,
      shiftDays(statement.periodStart, -MANUAL_MATCH_SLACK_DAYS),
      shiftDays(statement.periodEnd, MANUAL_MATCH_SLACK_DAYS),
    );
    return candidates.filter((c) => !taken.has(c.entryId));
  }

  async findById(id: string): Promise<BankStatement | null> {
    return this.deps.statements.findById(id);
  }

  async listLines(statementId: string): Promise<readonly StatementLine[]> {
    return this.deps.statements.listLines(statementId);
  }

  /**
   * The statement's lines, each matched one carrying the entry NUMBER it was
   * matched to. One ledger read for the whole statement, not one per line.
   *
   * `matchedEntryNo` is null when the line is unmatched, and also when the
   * entry it points at carries no number of its own (a draft) — rendering the
   * id in that case is the caller's choice, not a silent substitution here.
   */
  async listLinesWithEntryNumbers(statementId: string): Promise<readonly MatchedStatementLine[]> {
    const lines = await this.deps.statements.listLines(statementId);
    return this.withEntryNumbers(lines);
  }

  /** Same enrichment for a handful of lines — what the match/unmatch routes return. */
  async withEntryNumbers(lines: readonly StatementLine[]): Promise<readonly MatchedStatementLine[]> {
    const ids = lines.map((l) => l.matchedEntryId).filter((id): id is string => id !== null);
    const numbers = ids.length === 0 ? new Map<string, string>() : await this.deps.ledgerReader.entryNumbersByIds(ids);
    return lines.map((line) => ({
      ...line,
      matchedEntryNo: line.matchedEntryId === null ? null : (numbers.get(line.matchedEntryId) ?? null),
    }));
  }

  async list(filter?: BankStatementListFilter): Promise<readonly BankStatement[]> {
    return this.deps.statements.list(filter);
  }

  /**
   * The list plus each statement's match summary, counted in ONE query rather
   * than one per statement. The list screen judges which statement still needs
   * work by its match rate, and a rate it cannot compute reads as 0% — which is
   * a number, not an absence.
   */
  async listWithSummaries(
    filter?: BankStatementListFilter,
  ): Promise<readonly { statement: BankStatement; summary: MatchSummary }[]> {
    const statements = await this.deps.statements.list(filter);
    const counts = await this.deps.statements.lineCounts(statements.map((s) => s.id));
    return statements.map((statement) => {
      const { total, matched } = counts.get(statement.id) ?? { total: 0, matched: 0 };
      return {
        statement,
        summary: { total, matched, unmatched: total - matched, matchRate: total === 0 ? 0 : matched / total },
      };
    });
  }

  private assertNotFinalized(statement: BankStatement): void {
    if (statement.status === "completed") throw new StatementAlreadyFinalizedError(statement.id);
  }

  private async require(id: string): Promise<BankStatement> {
    const statement = await this.deps.statements.findById(id);
    if (!statement) throw new BankStatementNotFoundError(id);
    return statement;
  }

  private async requireLine(id: string): Promise<StatementLine> {
    const line = await this.deps.statements.findLineById(id);
    if (!line) throw new StatementLineNotFoundError(id);
    return line;
  }
}
