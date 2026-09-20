import type {
  BankStatement,
  BankStatementListFilter,
  BankStatementRepository,
  StatementColumnMapping,
  StatementColumnMappingRepository,
  StatementLine,
} from "../bank-statement.js";
import type { TreasuryLedgerCandidate, TreasuryLedgerReader } from "../matching.js";

/** In-memory {@link BankStatementRepository} for domain-layer + UI tests. */
export class InMemoryBankStatementRepository implements BankStatementRepository {
  private readonly statements = new Map<string, BankStatement>();
  private readonly lines = new Map<string, StatementLine>();

  async save(statement: BankStatement): Promise<void> {
    this.statements.set(statement.id, statement);
  }
  async update(statement: BankStatement): Promise<void> {
    this.statements.set(statement.id, statement);
  }
  async findById(id: string): Promise<BankStatement | null> {
    return this.statements.get(id) ?? null;
  }
  async findByFingerprint(treasuryAccountId: string, fingerprint: string): Promise<BankStatement | null> {
    return (
      [...this.statements.values()].find(
        (s) => s.treasuryAccountId === treasuryAccountId && s.importFingerprint === fingerprint,
      ) ?? null
    );
  }
  async list(filter: BankStatementListFilter = {}): Promise<readonly BankStatement[]> {
    return [...this.statements.values()]
      .filter((s) => (filter.treasuryAccountId ? s.treasuryAccountId === filter.treasuryAccountId : true))
      .filter((s) => (filter.status ? s.status === filter.status : true))
      .filter((s) => (filter.fromDate ? s.periodStart >= filter.fromDate : true))
      .filter((s) => (filter.toDate ? s.periodEnd <= filter.toDate : true))
      .filter((s) => (filter.branchIds ? s.branchId === null || filter.branchIds.includes(s.branchId) : true))
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }
  async saveLines(lines: readonly StatementLine[]): Promise<void> {
    for (const line of lines) this.lines.set(line.id, line);
  }
  async saveLine(line: StatementLine): Promise<void> {
    this.lines.set(line.id, line);
  }
  async updateLine(line: StatementLine): Promise<void> {
    this.lines.set(line.id, line);
  }
  async findLineById(id: string): Promise<StatementLine | null> {
    return this.lines.get(id) ?? null;
  }
  async listLines(statementId: string): Promise<readonly StatementLine[]> {
    return [...this.lines.values()].filter((l) => l.statementId === statementId).sort((a, b) => a.id.localeCompare(b.id));
  }
  async lineCounts(statementIds: readonly string[]): Promise<ReadonlyMap<string, { total: number; matched: number }>> {
    const counts = new Map<string, { total: number; matched: number }>();
    for (const id of statementIds) {
      const lines = [...this.lines.values()].filter((l) => l.statementId === id);
      counts.set(id, { total: lines.length, matched: lines.filter((l) => l.status === "matched").length });
    }
    return counts;
  }
  async replaceLineMatches(line: StatementLine, _treasuryAccountId: string, entryIds: readonly string[]): Promise<void> {
    const current = this.lines.get(line.id);
    if (current) this.lines.set(line.id, { ...current, matchedEntryIds: entryIds });
  }
  async matchedEntryIdsForAccount(treasuryAccountId: string): Promise<ReadonlySet<string>> {
    const statementIds = new Set([...this.statements.values()].filter((s) => s.treasuryAccountId === treasuryAccountId).map((s) => s.id));
    const ids = new Set<string>();
    for (const line of this.lines.values()) {
      if (!statementIds.has(line.statementId) || line.status !== "matched") continue;
      for (const id of line.matchedEntryIds ?? []) ids.add(id);
      if (line.matchedEntryId) ids.add(line.matchedEntryId);
    }
    return ids;
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

/** In-memory {@link StatementColumnMappingRepository} for domain-layer + UI tests. */
export class InMemoryColumnMappingRepository implements StatementColumnMappingRepository {
  private readonly rows = new Map<string, StatementColumnMapping>();
  async findByTreasuryAccount(treasuryAccountId: string): Promise<StatementColumnMapping | null> {
    return this.rows.get(treasuryAccountId) ?? null;
  }
  async upsert(mapping: StatementColumnMapping): Promise<void> {
    this.rows.set(mapping.treasuryAccountId, mapping);
  }
}

/** A scriptable {@link TreasuryLedgerReader} for domain-layer + UI tests. */
export class FakeTreasuryLedgerReader implements TreasuryLedgerReader {
  constructor(private readonly candidatesByAccount: Map<string, TreasuryLedgerCandidate[]>) {}
  async entriesForTreasuryAccount(treasuryAccountId: string, fromDate: string, toDate: string): Promise<readonly TreasuryLedgerCandidate[]> {
    return (this.candidatesByAccount.get(treasuryAccountId) ?? []).filter((c) => c.date >= fromDate && c.date <= toDate);
  }

  /**
   * Resolves over EVERY scripted candidate, not just the ones a period filter
   * would return — a matched entry keeps its number after it drops out of the
   * candidate list, which is the whole reason the port has this method.
   */
  async entryNumbersByIds(entryIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const wanted = new Set(entryIds);
    const byId = new Map<string, string>();
    for (const candidates of this.candidatesByAccount.values()) {
      for (const c of candidates) {
        if (c.entryNo && wanted.has(c.entryId)) byId.set(c.entryId, c.entryNo);
      }
    }
    return byId;
  }
}
