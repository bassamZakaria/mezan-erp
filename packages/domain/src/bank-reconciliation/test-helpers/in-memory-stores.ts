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
  async list(filter: BankStatementListFilter = {}): Promise<readonly BankStatement[]> {
    return [...this.statements.values()]
      .filter((s) => (filter.treasuryAccountId ? s.treasuryAccountId === filter.treasuryAccountId : true))
      .filter((s) => (filter.status ? s.status === filter.status : true))
      .filter((s) => (filter.fromDate ? s.periodStart >= filter.fromDate : true))
      .filter((s) => (filter.toDate ? s.periodEnd <= filter.toDate : true))
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
}
