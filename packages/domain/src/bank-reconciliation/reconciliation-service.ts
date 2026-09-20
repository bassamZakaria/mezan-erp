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

import { Money } from "../money/index.js";
import type { AccountRepository } from "../accounts/account.js";
import type { CostCenterRepository } from "../cost-centers/cost-center.js";
import { BASE_CURRENCY } from "../exchange-rates/exchange-rate.js";
import { withinBranchScope } from "../reports/branch-filter.js";
import type { TreasuryAccount, TreasuryAccountRepository } from "../treasury-accounts/treasury-account.js";
import { statementFingerprint, type FingerprintRow } from "./fingerprint.js";
import {
  BankStatementSource,
  MatchSource,
  MAX_STATEMENT_BALANCE_SCALED,
  type BankStatement,
  type BankStatementListFilter,
  type BankStatementRepository,
  type StatementColumnMapping,
  type StatementColumnMappingRepository,
  type StatementLine,
} from "./bank-statement.js";
import { mapCsvRows, parseCsv } from "./csv.js";
import {
  buildSuggestions,
  suggestionKey,
  type ScoredCandidateSet,
  type TreasuryLedgerCandidate,
  type TreasuryLedgerReader,
} from "./matching.js";
import { SuggestionStatus, type MatchSuggestionRecord, type MatchSuggestionRepository } from "./suggestions.js";
import { BankRuleDirection, BankRuleMatchType, findMatchingRule, type BankRule, type BankRuleRepository } from "./bank-rules.js";
import { BankEntryKind, type BankEntryPoster } from "./entry-poster.js";
import { parseOfx } from "./ofx.js";
import { parseMt940 } from "./mt940.js";
import { StatementFileFormat, type ParsedStatementFile } from "./statement-file.js";
import {
  BankRuleNotFoundError,
  BankStatementNotFoundError,
  DuplicateStatementImportError,
  EntryAccountRequiredError,
  EntryAlreadyMatchedError,
  EntryDateBeforeLineError,
  EntryNotOnTreasuryAccountError,
  FinalizeOverrideReasonRequiredError,
  InvalidBankRuleError,
  InvalidEntryAccountError,
  InvalidStatementBalanceError,
  InvalidStatementFileError,
  LineAlreadyMatchedError,
  LineNotMatchedError,
  LineNotOnStatementError,
  MatchAmountMismatchError,
  MatchCurrencyMismatchError,
  NoEntriesSelectedError,
  StatementAccountMismatchError,
  StatementAlreadyFinalizedError,
  StatementCurrencyMismatchError,
  StatementDifferenceNotZeroError,
  StatementHasUnmatchedLinesError,
  StatementLineNotFoundError,
  StatementOutOfBranchScopeError,
  SuggestionNotFoundError,
  SuggestionNotPendingError,
  TreasuryAccountNumberMissingError,
  TreasuryAccountOutOfBranchScopeError,
  TreasuryAccountUnpostableError,
  ZeroAmountLineError,
} from "./errors.js";

/**
 * The opening/closing balance must be storable. Without this an over-large
 * figure reaches the SQLite writer and throws a RangeError there — a 500
 * where the caller should have been told what is wrong.
 */
function assertStatementBalanceBound(statementId: string, label: string, amount: Money): void {
  if (amount.scaled > MAX_STATEMENT_BALANCE_SCALED || amount.scaled < -MAX_STATEMENT_BALANCE_SCALED) {
    throw new InvalidStatementBalanceError(statementId, `${label} أكبر من أن يُسجَّل — راجع الرقم المُدخل.`);
  }
}

/**
 * Finalising over unmatched lines or a non-zero difference is a deliberate,
 * recorded act — never a default. `reason` is mandatory whenever `force` is set.
 */
export interface FinalizeOptions {
  readonly force?: boolean;
  readonly reason?: string;
  readonly actor?: string | null;
}

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
  /** An Excel statement is converted to CSV text in the browser and arrives here as CSV; this records where it came from. */
  readonly source?: BankStatementSource.Csv | BankStatementSource.Excel;
}

export interface ImportStatementFileCommand {
  readonly id: string;
  readonly treasuryAccountId: string;
  readonly format: StatementFileFormat;
  readonly content: string;
  readonly periodStart?: string | null;
  readonly periodEnd?: string | null;
  readonly openingBalance?: Money | null;
  readonly closingBalance?: Money | null;
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
  readonly matchedEntryNos: readonly (string | null)[];
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

/**
 * The statement's reconciliation position, exact to the micro-unit.
 *
 * `difference` is the running target (closing balance − cleared book
 * balance): the cleared book balance is the opening balance plus every entry
 * matched on this statement, so it reaches zero exactly when every bank line
 * is explained by a book entry and the file's own arithmetic holds. The book
 * figures beside it compare the statement with the whole GL at period end,
 * where timing items (deposits in transit, cheques not yet presented) are
 * legitimate and listed.
 */
export interface ReconciliationPosition {
  readonly openingBalance: Money;
  readonly closingBalance: Money;
  readonly clearedBalance: Money;
  readonly difference: Money;
  readonly statementLinesTotal: Money;
  readonly statementArithmeticGap: Money;
  readonly unmatchedLines: { readonly count: number; readonly total: Money };
  readonly bookBalance: Money | null;
  readonly bookDifference: Money | null;
  readonly outstandingBook: { readonly count: number; readonly total: Money; readonly items: readonly TreasuryLedgerCandidate[] };
  readonly unexplainedBookDifference: Money | null;
}

export interface ReviewSuggestion {
  readonly record: MatchSuggestionRecord;
  readonly entries: readonly TreasuryLedgerCandidate[];
}

export interface ReviewItem {
  readonly lineId: string;
  readonly suggestions: readonly ReviewSuggestion[];
  readonly rule: BankRule | null;
}

export interface CreateEntryCommand {
  readonly accountId?: string | null;
  readonly costCenterId?: string | null;
  readonly ruleId?: string | null;
  readonly memo?: string | null;
  readonly date?: string | null;
  readonly actor?: string;
  readonly actorRoles?: readonly string[];
}

export type CreateEntryResult =
  | { readonly held: false; readonly voucherId: string; readonly voucherNo: string | null; readonly entryId: string; readonly line: StatementLine; readonly rule: BankRule | null }
  | { readonly held: true; readonly voucherId: string; readonly voucherNo: string | null; readonly line: StatementLine; readonly rule: BankRule | null };

export interface BankRuleInput {
  readonly name: string;
  readonly treasuryAccountId: string | null;
  readonly pattern: string;
  readonly matchType: BankRuleMatchType;
  readonly direction: BankRuleDirection;
  readonly accountId: string;
  readonly costCenterId: string | null;
  readonly priority: number;
  readonly active: boolean;
}

export interface BankReconciliationServiceDeps {
  readonly statements: BankStatementRepository;
  /**
   * The reconciled account itself: its branch, its currency and the bank
   * account number an imported file is checked against. Absent, a statement is
   * imported without any of the three and nothing can be enforced.
   */
  readonly treasuryAccounts?: Pick<TreasuryAccountRepository, "findById">;
  /**
   * The CALLER's own branch authority, resolved server-side. Never a value the
   * client supplied; a route builds one service per request with it.
   */
  readonly branchScope?: readonly string[];
  readonly baseCurrency?: string;
  readonly mappings: StatementColumnMappingRepository;
  readonly ledgerReader: TreasuryLedgerReader;
  readonly now?: () => string;
  readonly suggestions?: MatchSuggestionRepository;
  readonly rules?: BankRuleRepository;
  readonly entryPoster?: BankEntryPoster;
  readonly accounts?: Pick<AccountRepository, "findById">;
  readonly costCenters?: Pick<CostCenterRepository, "findById">;
  readonly idGen?: () => string;
}

const MANUAL_MATCH_SLACK_DAYS = 10;

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Bank account numbers travel with spaces, dashes and an IBAN prefix; compare only the alphanumerics. */
function normalizeAccountNumber(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

export function displayAmount(amount: Money): string {
  const text = amount.toString();
  return text.endsWith("0000") ? text.slice(0, -4) : text;
}

const ENTRY_KIND_LABEL: Record<BankEntryKind, string> = {
  [BankEntryKind.BankCharge]: "مصروفات بنكية",
  [BankEntryKind.Interest]: "فوائد وإيرادات بنكية",
};

export class BankReconciliationService {
  constructor(private readonly deps: BankReconciliationServiceDeps) {}

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }

  private newId(): string {
    return this.deps.idGen ? this.deps.idGen() : globalThis.crypto.randomUUID();
  }

  private baseCurrency(): string {
    return this.deps.baseCurrency ?? BASE_CURRENCY;
  }

  /**
   * The account being reconciled, refused when it is outside the caller's own
   * branch authority. Import is the one place a branch reaches a statement, so
   * the check has to happen before anything is written.
   */
  private async requireAccount(treasuryAccountId: string): Promise<TreasuryAccount | null> {
    if (!this.deps.treasuryAccounts) return null;
    const account = await this.deps.treasuryAccounts.findById(treasuryAccountId);
    if (!account) throw new TreasuryAccountUnpostableError(treasuryAccountId);
    if (!withinBranchScope(account.branchId, this.deps.branchScope)) {
      throw new TreasuryAccountOutOfBranchScopeError(treasuryAccountId);
    }
    return account;
  }

  async assertAccountInScope(treasuryAccountId: string): Promise<void> {
    await this.requireAccount(treasuryAccountId);
  }

  async getColumnMapping(treasuryAccountId: string): Promise<StatementColumnMapping | null> {
    await this.requireAccount(treasuryAccountId);
    return this.deps.mappings.findByTreasuryAccount(treasuryAccountId);
  }

  /** Import a CSV statement: persists the column mapping for the account, then the statement + its parsed lines. */
  async importStatement(cmd: ImportStatementCommand): Promise<{ statement: BankStatement; lines: readonly StatementLine[] }> {
    assertStatementBalanceBound(cmd.id, "الرصيد الافتتاحي", cmd.openingBalance);
    assertStatementBalanceBound(cmd.id, "الرصيد الختامي", cmd.closingBalance);
    const account = await this.requireAccount(cmd.treasuryAccountId);
    const stamp = this.now();
    const mapping: StatementColumnMapping = { ...cmd.mapping, treasuryAccountId: cmd.treasuryAccountId, updatedAt: stamp };
    const table = parseCsv(cmd.rawCsv);
    const mapped = mapCsvRows(table, mapping);
    const rows = mapped.map((row) => ({ ...row, counterparty: null }));
    const source = cmd.source ?? BankStatementSource.Csv;
    return this.persistImport(
      {
        id: cmd.id,
        treasuryAccountId: cmd.treasuryAccountId,
        branchId: account?.branchId ?? null,
        currency: account?.currency ?? this.baseCurrency(),
        importFingerprint: this.fingerprintOf(cmd.treasuryAccountId, source, {
          periodStart: cmd.periodStart,
          periodEnd: cmd.periodEnd,
          openingBalance: cmd.openingBalance,
          closingBalance: cmd.closingBalance,
          statementNumber: cmd.statementNumber ?? null,
          rows,
        }),
        source,
        statementNumber: cmd.statementNumber ?? null,
        periodStart: cmd.periodStart,
        periodEnd: cmd.periodEnd,
        openingBalance: cmd.openingBalance,
        closingBalance: cmd.closingBalance,
        status: "imported",
        importedAt: stamp,
        finalizedAt: null,
      },
      rows,
      mapping,
    );
  }

  private fingerprintOf(
    treasuryAccountId: string,
    source: BankStatementSource,
    input: {
      periodStart: string;
      periodEnd: string;
      openingBalance: Money;
      closingBalance: Money;
      statementNumber: string | null;
      rows: readonly FingerprintRow[];
    },
  ): string {
    return statementFingerprint({ treasuryAccountId, source, ...input });
  }

  /**
   * Refuse a second import of a file already imported in full. The caller is
   * pointed at the statement that already holds these rows rather than being
   * handed a duplicate whose lines would double every figure on the account.
   */
  private async assertNotAlreadyImported(treasuryAccountId: string, fingerprint: string): Promise<void> {
    const existing = await this.deps.statements.findByFingerprint(treasuryAccountId, fingerprint);
    if (existing) throw new DuplicateStatementImportError(existing.id, existing.statementNumber);
  }

  /** The file states which bank account and currency it belongs to; both must be the account being reconciled. */
  private assertFileMatchesAccount(account: TreasuryAccount | null, parsed: ParsedStatementFile): void {
    if (!account) return;
    if (parsed.currency && parsed.currency.toUpperCase() !== account.currency.toUpperCase()) {
      throw new StatementCurrencyMismatchError(parsed.currency.toUpperCase(), account.currency);
    }
    if (!parsed.accountNumber) return;
    const fileNumber = normalizeAccountNumber(parsed.accountNumber);
    if (fileNumber === "") return;
    if (!account.bankAccountNumber) throw new TreasuryAccountNumberMissingError(account.id, parsed.accountNumber);
    const accountNumber = normalizeAccountNumber(account.bankAccountNumber);
    if (fileNumber !== accountNumber && !fileNumber.endsWith(accountNumber) && !accountNumber.endsWith(fileNumber)) {
      throw new StatementAccountMismatchError(parsed.accountNumber, account.bankAccountNumber);
    }
  }

  /**
   * Import an OFX or MT940 statement. Balances and the period come from the
   * file unless the caller supplies them; a file carrying only one balance
   * derives the other from its own lines, so the statement's arithmetic
   * always closes.
   */
  async importStatementFile(cmd: ImportStatementFileCommand): Promise<{ statement: BankStatement; lines: readonly StatementLine[] }> {
    const parsed: ParsedStatementFile = cmd.format === StatementFileFormat.Ofx ? parseOfx(cmd.content) : parseMt940(cmd.content);
    const account = await this.requireAccount(cmd.treasuryAccountId);
    this.assertFileMatchesAccount(account, parsed);
    if (parsed.rows.length === 0) {
      throw new InvalidStatementFileError("لا يحتوي ملف الكشف على أي حركة.", "The statement file contains no transactions.");
    }
    const linesTotal = Money.sum(parsed.rows.map((r) => r.amount));
    let opening = cmd.openingBalance ?? parsed.openingBalance;
    let closing = cmd.closingBalance ?? parsed.closingBalance;
    if (opening === null && closing === null) {
      throw new InvalidStatementFileError(
        "لا يحمل الملف رصيداً افتتاحياً ولا ختامياً؛ أدخل أحدهما.",
        "The file carries neither an opening nor a closing balance; enter one of them.",
      );
    }
    if (opening === null) opening = closing!.add(linesTotal.negate());
    if (closing === null) closing = opening.add(linesTotal);
    assertStatementBalanceBound(cmd.id, "الرصيد الافتتاحي", opening);
    assertStatementBalanceBound(cmd.id, "الرصيد الختامي", closing);
    const dates = parsed.rows.map((r) => r.date).sort();
    const stamp = this.now();
    const source = cmd.format === StatementFileFormat.Ofx ? BankStatementSource.Ofx : BankStatementSource.Mt940;
    const statementNumber = cmd.statementNumber ?? parsed.statementNumber ?? null;
    const periodStart = cmd.periodStart ?? parsed.periodStart ?? dates[0]!;
    const periodEnd = cmd.periodEnd ?? parsed.periodEnd ?? dates[dates.length - 1]!;
    return this.persistImport(
      {
        id: cmd.id,
        treasuryAccountId: cmd.treasuryAccountId,
        branchId: account?.branchId ?? null,
        currency: account?.currency ?? parsed.currency ?? this.baseCurrency(),
        importFingerprint: this.fingerprintOf(cmd.treasuryAccountId, source, {
          periodStart,
          periodEnd,
          openingBalance: opening,
          closingBalance: closing,
          statementNumber,
          rows: parsed.rows,
        }),
        source,
        statementNumber,
        periodStart,
        periodEnd,
        openingBalance: opening,
        closingBalance: closing,
        status: "imported",
        importedAt: stamp,
        finalizedAt: null,
      },
      parsed.rows,
      null,
    );
  }

  private async persistImport(
    statement: BankStatement,
    rows: readonly { date: string; description: string; reference: string | null; amount: Money; counterparty: string | null }[],
    mapping: StatementColumnMapping | null,
  ): Promise<{ statement: BankStatement; lines: readonly StatementLine[] }> {
    const lines: StatementLine[] = rows.map((row, index) => ({
      id: `${statement.id}:L${index}`,
      statementId: statement.id,
      date: row.date,
      description: row.description,
      reference: row.reference,
      amount: row.amount,
      status: "unmatched",
      matchedEntryId: null,
      matchedAt: null,
      counterparty: row.counterparty,
      matchedEntryIds: [],
      matchSource: null,
    }));
    await this.deps.statements.transaction(async () => {
      if (statement.importFingerprint) {
        await this.assertNotAlreadyImported(statement.treasuryAccountId, statement.importFingerprint);
      }
      if (mapping) await this.deps.mappings.upsert(mapping);
      await this.deps.statements.save(statement);
      await this.deps.statements.saveLines(lines);
    });
    return { statement, lines };
  }

  /**
   * Score every unmatched line against the account's book movements and store
   * the suggestions for review. Only a match scoring ≥ 90 that no other line
   * contests and no equal-scoring alternative rivals is applied without a
   * human; everything else waits in «للمراجعة». A suggestion someone rejected
   * is never offered again for the same line.
   */
  async autoMatch(statementId: string, opts: { actor?: string | null } = {}): Promise<{ matchedCount: number; suggestedCount: number }> {
    return this.deps.statements.transaction(async () => {
      const statement = await this.require(statementId);
      this.assertNotFinalized(statement);
      const lines = await this.deps.statements.listLines(statementId);
      const taken = await this.deps.statements.matchedEntryIdsForAccount(statement.treasuryAccountId);
      const candidates = (
        await this.deps.ledgerReader.entriesForTreasuryAccount(
          statement.treasuryAccountId,
          shiftDays(statement.periodStart, -MANUAL_MATCH_SLACK_DAYS),
          shiftDays(statement.periodEnd, MANUAL_MATCH_SLACK_DAYS),
        )
      ).filter((c) => !taken.has(c.entryId) && this.sameCurrency(statement, c));
      const previous = this.deps.suggestions ? await this.deps.suggestions.listByStatement(statementId) : [];
      const rejected = new Set(
        previous.filter((s) => s.status === SuggestionStatus.Rejected).map((s) => suggestionKey(s.lineId, s.entryIds)),
      );
      const built = buildSuggestions(lines, candidates, { excluded: rejected });
      const byId = new Map(lines.map((l) => [l.id, l]));
      const byEntry = new Map(candidates.map((c) => [c.entryId, c]));
      const stamp = this.now();
      let matchedCount = 0;
      let suggestedCount = 0;

      await this.deps.suggestions?.deletePending(statementId);
      const records: MatchSuggestionRecord[] = [];
      const applied = new Set<string>();
      for (const item of built) {
        if (!item.autoApply) continue;
        const best = item.options[0]!;
        await this.writeMatch(statement, byId.get(item.lineId)!, best.entryIds, MatchSource.Auto, stamp);
        best.entryIds.forEach((id) => applied.add(id));
        records.push(this.toRecord(statementId, best, 0, stamp, SuggestionStatus.Accepted, opts.actor ?? "auto"));
        matchedCount += 1;
      }
      for (const item of built) {
        if (item.autoApply) continue;
        const open = item.options.filter((o) => o.entryIds.every((id) => byEntry.has(id) && !applied.has(id)));
        open.forEach((option, rank) => records.push(this.toRecord(statementId, option, rank, stamp, SuggestionStatus.Pending, null)));
        if (open.length > 0) suggestedCount += 1;
      }
      if (records.length > 0) await this.deps.suggestions?.saveMany(records);
      if (matchedCount > 0 && statement.status === "imported") {
        await this.deps.statements.update({ ...statement, status: "in_progress" });
      }
      return { matchedCount, suggestedCount };
    });
  }

  private toRecord(
    statementId: string,
    option: ScoredCandidateSet,
    rank: number,
    stamp: string,
    status: SuggestionStatus,
    decidedBy: string | null,
  ): MatchSuggestionRecord {
    return {
      id: this.newId(),
      statementId,
      lineId: option.lineId,
      entryIds: option.entryIds,
      rank,
      score: option.score.total,
      amountScore: option.score.amount,
      dateScore: option.score.date,
      referenceScore: option.score.reference,
      counterpartyScore: option.score.counterparty,
      dateDeltaDays: option.score.dateDeltaDays,
      status,
      createdAt: stamp,
      decidedAt: status === SuggestionStatus.Pending ? null : stamp,
      decidedBy,
    };
  }

  async matchLine(statementId: string, lineId: string, entryId: string): Promise<StatementLine> {
    return this.matchLineToEntries(statementId, lineId, [entryId]);
  }

  /**
   * Match one statement line to one or more book entries (1:1 or a split).
   * Every entry must move this statement's bank account, none may already be
   * matched on any statement of the account, and together they must equal the
   * line to the micro-unit.
   */
  async matchLineToEntries(
    statementId: string,
    lineId: string,
    entryIds: readonly string[],
    source: MatchSource = MatchSource.Manual,
    acceptedSuggestion?: { readonly id: string; readonly actor: string | null },
  ): Promise<StatementLine> {
    const unique = [...new Set(entryIds.map((id) => id.trim()).filter((id) => id !== ""))];
    if (unique.length === 0) throw new NoEntriesSelectedError(lineId);
    return this.deps.statements.transaction(async () => {
      const statement = await this.require(statementId);
      this.assertNotFinalized(statement);
      const line = await this.requireLineOf(statementId, lineId);
      if (line.status === "matched") throw new LineAlreadyMatchedError(lineId);

      const entries = await this.entriesOnAccount(statement, unique);
      for (const id of unique) if (!entries.has(id)) throw new EntryNotOnTreasuryAccountError(id);
      for (const id of unique) {
        const entry = entries.get(id)!;
        if (!this.sameCurrency(statement, entry)) {
          throw new MatchCurrencyMismatchError(id, entry.currency ?? statement.currency, statement.currency);
        }
      }
      const taken = await this.deps.statements.matchedEntryIdsForAccount(statement.treasuryAccountId);
      for (const id of unique) if (taken.has(id)) throw new EntryAlreadyMatchedError(id);
      const total = Money.sum(unique.map((id) => entries.get(id)!.amount));
      // A foreign account's entry amount is recovered from a base figure and
      // its booking rate, so the round trip may land one micro-unit — far
      // below a piastre — from the bank's own figure. Base-currency
      // statements stay exact to the micro-unit.
      const tolerance = statement.currency === this.baseCurrency() ? 0n : 1n;
      const drift = total.add(line.amount.negate()).scaled;
      if ((drift < 0n ? -drift : drift) > tolerance) {
        throw new MatchAmountMismatchError(lineId, displayAmount(line.amount), displayAmount(total));
      }

      const stamp = this.now();
      const updated = await this.writeMatch(statement, line, unique, source, stamp);
      if (acceptedSuggestion && this.deps.suggestions) {
        const record = await this.deps.suggestions.findById(acceptedSuggestion.id);
        if (record) {
          await this.deps.suggestions.update({
            ...record,
            status: SuggestionStatus.Accepted,
            decidedAt: stamp,
            decidedBy: acceptedSuggestion.actor,
          });
        }
      }
      if (statement.status === "imported") await this.deps.statements.update({ ...statement, status: "in_progress" });
      return updated;
    });
  }

  private async writeMatch(
    statement: BankStatement,
    line: StatementLine,
    entryIds: readonly string[],
    source: MatchSource,
    stamp: string,
  ): Promise<StatementLine> {
    const updated: StatementLine = {
      ...line,
      status: "matched",
      matchedEntryId: entryIds[0] ?? null,
      matchedEntryIds: entryIds,
      matchSource: source,
      matchedAt: stamp,
    };
    await this.deps.statements.updateLine(updated);
    await this.deps.statements.replaceLineMatches(updated, statement.treasuryAccountId, entryIds);
    await this.supersede(statement.id, line.id, entryIds, stamp);
    return updated;
  }

  private async supersede(statementId: string, lineId: string, entryIds: readonly string[], stamp: string): Promise<void> {
    if (!this.deps.suggestions) return;
    const used = new Set(entryIds);
    const pending = (await this.deps.suggestions.listByStatement(statementId)).filter((s) => s.status === SuggestionStatus.Pending);
    for (const record of pending) {
      if (record.lineId === lineId || record.entryIds.some((id) => used.has(id))) {
        await this.deps.suggestions.update({ ...record, status: SuggestionStatus.Superseded, decidedAt: stamp, decidedBy: null });
      }
    }
  }

  async acceptSuggestion(statementId: string, suggestionId: string, actor: string | null = null): Promise<StatementLine> {
    const record = await this.requireSuggestion(statementId, suggestionId);
    return this.matchLineToEntries(statementId, record.lineId, record.entryIds, MatchSource.Suggestion, { id: record.id, actor });
  }

  async rejectSuggestion(statementId: string, suggestionId: string, actor: string | null = null): Promise<MatchSuggestionRecord> {
    const statement = await this.require(statementId);
    this.assertNotFinalized(statement);
    const record = await this.requireSuggestion(statementId, suggestionId);
    const updated: MatchSuggestionRecord = { ...record, status: SuggestionStatus.Rejected, decidedAt: this.now(), decidedBy: actor };
    await this.deps.suggestions!.update(updated);
    return updated;
  }

  private async requireSuggestion(statementId: string, suggestionId: string): Promise<MatchSuggestionRecord> {
    const record = this.deps.suggestions ? await this.deps.suggestions.findById(suggestionId) : null;
    if (!record || record.statementId !== statementId) throw new SuggestionNotFoundError(suggestionId);
    if (record.status !== SuggestionStatus.Pending) throw new SuggestionNotPendingError(suggestionId);
    return record;
  }

  async unmatchLine(statementId: string, lineId: string): Promise<StatementLine> {
    const statement = await this.require(statementId);
    this.assertNotFinalized(statement);
    const line = await this.requireLineOf(statementId, lineId);
    if (line.status === "unmatched") throw new LineNotMatchedError(lineId);

    const updated: StatementLine = {
      ...line,
      status: "unmatched",
      matchedEntryId: null,
      matchedEntryIds: [],
      matchSource: null,
      matchedAt: null,
    };
    await this.deps.statements.transaction(async () => {
      await this.deps.statements.updateLine(updated);
      await this.deps.statements.replaceLineMatches(updated, statement.treasuryAccountId, []);
    });
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
      counterparty: null,
      matchedEntryIds: [],
      matchSource: null,
    };
    await this.deps.statements.saveLine(line);
    return line;
  }

  /**
   * Book the entry a bank line proves happened but the books never recorded —
   * a charge or interest — as a real voucher dated the bank line's own day,
   * then match the line to it. The counter account comes from the caller or,
   * failing that, from the first bank rule the line satisfies. A later date may
   * be chosen (the line's period closed, say); an earlier one never. A closed
   * or locked period on the chosen date refuses the posting; nothing moves it.
   * When an approval chain holds the voucher, the line stays open until it posts.
   */
  async createEntry(statementId: string, lineId: string, cmd: CreateEntryCommand = {}): Promise<CreateEntryResult> {
    const poster = this.deps.entryPoster;
    if (!poster) throw new Error("Bank reconciliation has no entry poster configured.");
    const statement = await this.require(statementId);
    this.assertNotFinalized(statement);
    const line = await this.requireLineOf(statementId, lineId);
    if (line.status === "matched") throw new LineAlreadyMatchedError(lineId);
    if (line.amount.scaled === 0n) throw new ZeroAmountLineError(lineId);

    let rule: BankRule | null = null;
    if (cmd.ruleId) rule = await this.requireRule(cmd.ruleId);
    else if (!cmd.accountId) rule = findMatchingRule(await this.activeRules(), line, statement.treasuryAccountId);
    const accountId = cmd.accountId ?? rule?.accountId ?? null;
    if (!accountId) throw new EntryAccountRequiredError(lineId);
    const costCenterId = cmd.costCenterId !== undefined ? cmd.costCenterId : (rule?.costCenterId ?? null);
    await this.assertEntryAccount(accountId);
    if (costCenterId) await this.assertCostCenter(costCenterId);

    const date = cmd.date ?? line.date;
    if (date < line.date) throw new EntryDateBeforeLineError(line.date, date);
    const kind = line.amount.scaled > 0n ? BankEntryKind.Interest : BankEntryKind.BankCharge;
    const memo = cmd.memo?.trim() || `${ENTRY_KIND_LABEL[kind]} — ${line.description}`.trim();

    return this.deps.statements.transaction(async () => {
      const posted = await poster.post({
        voucherId: `BR-${line.id}`,
        kind,
        date,
        amount: line.amount.scaled < 0n ? line.amount.negate() : line.amount,
        treasuryAccountId: statement.treasuryAccountId,
        counterAccountId: accountId,
        costCenterId,
        memo,
        reference: line.reference,
        actor: cmd.actor,
        actorRoles: cmd.actorRoles,
      });
      if (posted.held) return { ...posted, line, rule };
      const matched = await this.matchLineToEntries(statementId, lineId, [posted.entryId], MatchSource.CreatedEntry);
      return { ...posted, line: matched, rule };
    });
  }

  private async assertEntryAccount(accountId: string): Promise<void> {
    if (!this.deps.accounts) return;
    const account = await this.deps.accounts.findById(accountId);
    if (!account) {
      throw new InvalidEntryAccountError(`الحساب "${accountId}" غير موجود في دليل الحسابات.`, `Account "${accountId}" does not exist in the chart of accounts.`);
    }
    if (account.status !== "active" || account.isHeader) {
      throw new InvalidEntryAccountError(
        `الحساب "${account.code} ${account.nameAr}" غير نشط أو رئيسي؛ اختر حساباً تفصيلياً نشطاً.`,
        `Account "${account.code}" is inactive or a header; choose an active detail account.`,
      );
    }
    if (account.type !== "expense" && account.type !== "revenue") {
      throw new InvalidEntryAccountError(
        `قيود البنك من الكشف تُرحَّل إلى حساب مصروف أو إيراد فقط، و"${account.code} ${account.nameAr}" ليس كذلك.`,
        `Entries from a statement post only to an expense or revenue account; "${account.code}" is neither.`,
      );
    }
  }

  private async assertCostCenter(costCenterId: string): Promise<void> {
    if (!this.deps.costCenters) return;
    const center = await this.deps.costCenters.findById(costCenterId);
    if (!center || center.status !== "active") {
      throw new InvalidEntryAccountError(`مركز التكلفة "${costCenterId}" غير موجود أو غير نشط.`, `Cost centre "${costCenterId}" does not exist or is inactive.`);
    }
  }

  async listRules(): Promise<readonly BankRule[]> {
    if (!this.deps.rules) return [];
    const sorted = [...(await this.deps.rules.list())].sort(
      (a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt),
    );
    if (!this.deps.branchScope || !this.deps.treasuryAccounts) return sorted;
    const visible: BankRule[] = [];
    for (const rule of sorted) {
      if (rule.treasuryAccountId === null) {
        visible.push(rule);
        continue;
      }
      const account = await this.deps.treasuryAccounts.findById(rule.treasuryAccountId);
      if (withinBranchScope(account?.branchId ?? null, this.deps.branchScope)) visible.push(rule);
    }
    return visible;
  }

  private async activeRules(): Promise<readonly BankRule[]> {
    return (await this.listRules()).filter((r) => r.active);
  }

  private async requireRule(id: string): Promise<BankRule> {
    const rule = this.deps.rules ? await this.deps.rules.findById(id) : null;
    if (!rule) throw new BankRuleNotFoundError(id);
    if (rule.treasuryAccountId) await this.requireAccount(rule.treasuryAccountId);
    return rule;
  }

  private async validateRule(input: BankRuleInput): Promise<BankRuleInput> {
    if (input.treasuryAccountId) await this.requireAccount(input.treasuryAccountId);
    const name = input.name.trim();
    const pattern = input.pattern.trim();
    if (name === "") throw new InvalidBankRuleError("اسم القاعدة مطلوب.", "The rule needs a name.");
    if (pattern === "") throw new InvalidBankRuleError("نص البحث في البيان مطلوب.", "The memo pattern is required.");
    if (pattern.length > 200) throw new InvalidBankRuleError("نص البحث أطول من 200 حرف.", "The memo pattern is longer than 200 characters.");
    if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 9999) {
      throw new InvalidBankRuleError("الأولوية رقم صحيح من 0 إلى 9999.", "Priority is a whole number from 0 to 9999.");
    }
    await this.assertEntryAccount(input.accountId);
    if (input.costCenterId) await this.assertCostCenter(input.costCenterId);
    return { ...input, name, pattern };
  }

  async createRule(input: BankRuleInput, id?: string): Promise<BankRule> {
    if (!this.deps.rules) throw new Error("Bank rules are not configured.");
    const valid = await this.validateRule(input);
    const stamp = this.now();
    const rule: BankRule = { ...valid, id: id ?? this.newId(), createdAt: stamp, updatedAt: stamp };
    await this.deps.rules.save(rule);
    return rule;
  }

  async updateRule(id: string, input: BankRuleInput): Promise<BankRule> {
    const existing = await this.requireRule(id);
    const valid = await this.validateRule(input);
    const rule: BankRule = { ...existing, ...valid, id, updatedAt: this.now() };
    await this.deps.rules!.update(rule);
    return rule;
  }

  async deleteRule(id: string): Promise<void> {
    await this.requireRule(id);
    await this.deps.rules!.delete(id);
  }

  /**
   * «للمراجعة» — every unmatched line with its stored suggestions (best
   * first, each with its score broken down) and the bank rule that would
   * book it if no book entry explains it.
   */
  async review(statementId: string): Promise<readonly ReviewItem[]> {
    const statement = await this.require(statementId);
    const lines = (await this.deps.statements.listLines(statementId)).filter((l) => l.status !== "matched");
    const records = this.deps.suggestions
      ? (await this.deps.suggestions.listByStatement(statementId)).filter((s) => s.status === SuggestionStatus.Pending)
      : [];
    const entryIds = [...new Set(records.flatMap((r) => r.entryIds))];
    const entries = entryIds.length > 0 ? await this.entriesOnAccount(statement, entryIds) : new Map<string, TreasuryLedgerCandidate>();
    const rules = await this.activeRules();
    return lines.map((line) => ({
      lineId: line.id,
      suggestions: records
        .filter((r) => r.lineId === line.id && r.entryIds.every((id) => entries.has(id)))
        .sort((a, b) => b.score - a.score || a.rank - b.rank)
        .map((record) => ({ record, entries: record.entryIds.map((id) => entries.get(id)!) })),
      rule: findMatchingRule(rules, line, statement.treasuryAccountId),
    }));
  }

  async reconciliation(statementId: string): Promise<ReconciliationPosition> {
    const statement = await this.require(statementId);
    return this.positionOf(statement, await this.deps.statements.listLines(statementId));
  }

  private async positionOf(statement: BankStatement, lines: readonly StatementLine[]): Promise<ReconciliationPosition> {
    const matched = lines.filter((l) => l.status === "matched");
    const unmatched = lines.filter((l) => l.status !== "matched");
    const matchedIds = [...new Set(matched.flatMap((l) => this.entryIdsOf(l)))];
    const entries = matchedIds.length > 0 ? await this.entriesOnAccount(statement, matchedIds) : new Map<string, TreasuryLedgerCandidate>();
    const matchedBook = Money.sum(
      matched.flatMap((l) => {
        const ids = this.entryIdsOf(l);
        return ids.every((id) => entries.has(id)) ? ids.map((id) => entries.get(id)!.amount) : [l.amount];
      }),
    );
    const clearedBalance = statement.openingBalance.add(matchedBook);
    const statementLinesTotal = Money.sum(lines.map((l) => l.amount));
    const unmatchedTotal = Money.sum(unmatched.map((l) => l.amount));

    const reader = this.deps.ledgerReader;
    const bookBalance = reader.bookBalance ? await reader.bookBalance(statement.treasuryAccountId, statement.periodEnd) : null;
    const taken = await this.deps.statements.matchedEntryIdsForAccount(statement.treasuryAccountId);
    const outstanding = (
      await reader.entriesForTreasuryAccount(statement.treasuryAccountId, statement.periodStart, statement.periodEnd)
    ).filter((c) => !taken.has(c.entryId) && this.sameCurrency(statement, c));
    const outstandingTotal = Money.sum(outstanding.map((c) => c.amount));
    const bookDifference = bookBalance ? statement.closingBalance.add(bookBalance.negate()) : null;
    return {
      openingBalance: statement.openingBalance,
      closingBalance: statement.closingBalance,
      clearedBalance,
      difference: statement.closingBalance.add(clearedBalance.negate()),
      statementLinesTotal,
      statementArithmeticGap: statement.closingBalance.add(statement.openingBalance.negate()).add(statementLinesTotal.negate()),
      unmatchedLines: { count: unmatched.length, total: unmatchedTotal },
      bookBalance,
      bookDifference,
      outstandingBook: { count: outstanding.length, total: outstandingTotal, items: outstanding },
      unexplainedBookDifference: bookDifference ? bookDifference.add(unmatchedTotal.negate()).add(outstandingTotal) : null,
    };
  }

  private entryIdsOf(line: StatementLine): readonly string[] {
    if (line.matchedEntryIds && line.matchedEntryIds.length > 0) return line.matchedEntryIds;
    return line.matchedEntryId ? [line.matchedEntryId] : [];
  }

  /**
   * Whether a book entry is denominated in the same currency as the statement.
   * A foreign bank account's GL debits and credits are base-currency figures,
   * so an entry posted without its rate cannot be compared with a bank line at
   * all — offering it would invite a match between USD and EGP digits.
   */
  private sameCurrency(statement: BankStatement, candidate: TreasuryLedgerCandidate): boolean {
    return (candidate.currency ?? statement.currency) === statement.currency;
  }

  private async entriesOnAccount(statement: BankStatement, entryIds: readonly string[]): Promise<ReadonlyMap<string, TreasuryLedgerCandidate>> {
    const reader = this.deps.ledgerReader;
    if (reader.entryAmountsOnTreasuryAccount) return reader.entryAmountsOnTreasuryAccount(statement.treasuryAccountId, entryIds);
    const wanted = new Set(entryIds);
    const candidates = await reader.entriesForTreasuryAccount(
      statement.treasuryAccountId,
      shiftDays(statement.periodStart, -MANUAL_MATCH_SLACK_DAYS),
      shiftDays(statement.periodEnd, MANUAL_MATCH_SLACK_DAYS),
    );
    return new Map(candidates.filter((c) => wanted.has(c.entryId)).map((c) => [c.entryId, c]));
  }

  /**
   * Lock the statement: قيد التسوية/مستورد → منتهية. Idempotency-guarded —
   * cannot finalize twice.
   *
   * REFUSED while any line is still unmatched or the reconciliation difference
   * is not exactly zero, unless the caller passes an explicit `force` WITH a
   * reason (D82). The override is recorded on the statement
   * (`unmatchedAtFinalize`, `differenceAtFinalize`, `finalizeOverrideReason`,
   * `finalizedBy`) so the next person can see what was closed over and why.
   */
  async finalize(statementId: string, opts: FinalizeOptions = {}): Promise<BankStatement> {
    const statement = await this.require(statementId);
    this.assertNotFinalized(statement);
    const lines = await this.deps.statements.listLines(statementId);
    const unmatched = lines.filter((l) => l.status !== "matched").length;
    const position = await this.positionOf(statement, lines);
    const differenceOpen = position.difference.scaled !== 0n;
    if (unmatched > 0 || differenceOpen) {
      if (!opts.force) {
        if (unmatched > 0) throw new StatementHasUnmatchedLinesError(statementId, unmatched);
        throw new StatementDifferenceNotZeroError(statementId, displayAmount(position.difference));
      }
      if (!opts.reason || opts.reason.trim() === "") throw new FinalizeOverrideReasonRequiredError(statementId);
    }
    const overridden = unmatched > 0 || differenceOpen;
    const updated: BankStatement = {
      ...statement,
      status: "completed",
      finalizedAt: this.now(),
      unmatchedAtFinalize: unmatched,
      differenceAtFinalize: position.difference,
      finalizeOverrideReason: overridden ? (opts.reason as string).trim() : null,
      finalizedBy: opts.actor ?? null,
    };
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
   * precisely for the movements auto-match's window could not reach.
   *
   * Entries already matched on ANY statement of this account are excluded, so
   * the picker cannot offer one bank movement to two lines.
   */
  async matchCandidates(statementId: string): Promise<readonly TreasuryLedgerCandidate[]> {
    const statement = await this.require(statementId);
    const taken = await this.deps.statements.matchedEntryIdsForAccount(statement.treasuryAccountId);
    const candidates = await this.deps.ledgerReader.entriesForTreasuryAccount(
      statement.treasuryAccountId,
      shiftDays(statement.periodStart, -MANUAL_MATCH_SLACK_DAYS),
      shiftDays(statement.periodEnd, MANUAL_MATCH_SLACK_DAYS),
    );
    return candidates.filter((c) => !taken.has(c.entryId) && this.sameCurrency(statement, c));
  }

  async findById(id: string): Promise<BankStatement | null> {
    const statement = await this.deps.statements.findById(id);
    if (statement && !withinBranchScope(statement.branchId, this.deps.branchScope)) {
      throw new StatementOutOfBranchScopeError(id);
    }
    return statement;
  }

  async listLines(statementId: string): Promise<readonly StatementLine[]> {
    return this.deps.statements.listLines(statementId);
  }

  async listLinesWithEntryNumbers(statementId: string): Promise<readonly MatchedStatementLine[]> {
    const lines = await this.deps.statements.listLines(statementId);
    return this.withEntryNumbers(lines);
  }

  /** Same enrichment for a handful of lines — what the match/unmatch routes return. */
  async withEntryNumbers(lines: readonly StatementLine[]): Promise<readonly MatchedStatementLine[]> {
    const ids = [...new Set(lines.flatMap((l) => this.entryIdsOf(l)))];
    const numbers = ids.length === 0 ? new Map<string, string>() : await this.deps.ledgerReader.entryNumbersByIds(ids);
    return lines.map((line) => {
      const lineIds = this.entryIdsOf(line);
      return {
        ...line,
        matchedEntryIds: lineIds,
        matchedEntryNo: line.matchedEntryId === null ? null : (numbers.get(line.matchedEntryId) ?? null),
        matchedEntryNos: lineIds.map((id) => numbers.get(id) ?? null),
      };
    });
  }

  async list(filter?: BankStatementListFilter): Promise<readonly BankStatement[]> {
    return this.deps.statements.list(this.scoped(filter));
  }

  private scoped(filter?: BankStatementListFilter): BankStatementListFilter {
    return { ...filter, ...(this.deps.branchScope ? { branchIds: this.deps.branchScope } : {}) };
  }

  /**
   * The list plus each statement's match summary, counted in ONE query rather
   * than one per statement.
   */
  async listWithSummaries(
    filter?: BankStatementListFilter,
  ): Promise<readonly { statement: BankStatement; summary: MatchSummary }[]> {
    const statements = await this.deps.statements.list(this.scoped(filter));
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
    if (!withinBranchScope(statement.branchId, this.deps.branchScope)) throw new StatementOutOfBranchScopeError(id);
    return statement;
  }

  private async requireLineOf(statementId: string, lineId: string): Promise<StatementLine> {
    const line = await this.deps.statements.findLineById(lineId);
    if (!line) throw new StatementLineNotFoundError(lineId);
    if (line.statementId !== statementId) throw new LineNotOnStatementError(statementId, lineId);
    return line;
  }
}
