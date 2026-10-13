import { insertOnly } from "../../records/test-helpers/insert-only.js";
import { Money } from "../../money/index.js";
import type { JournalEntry } from "../../journal.js";
import type { SequenceStore } from "../../numbering/index.js";
import type { AuditEvent, AuditSink, AuditStream } from "../../audit/index.js";
import type {
  AccountBalance,
  AccountLedgerLine,
  JournalListFilter,
  LedgerRepository,
  TreasuryBalanceQuery,
} from "../ledger.js";
import type { GlDomainEvent, GlEventPublisher } from "../events.js";

/** Statuses whose lines are committed to the ledger and count toward balances. */
const LEDGER_STATUSES = new Set(["posted", "reversed"]);

/** A trivial in-memory {@link LedgerRepository} for domain-layer unit tests. */
export class InMemoryLedgerRepository implements LedgerRepository {
  private readonly rows = new Map<string, JournalEntry>();

  async save(entry: JournalEntry): Promise<void> {
    insertOnly(this.rows, entry.id, entry);
  }

  async update(entry: JournalEntry): Promise<void> {
    this.rows.set(entry.id, entry);
  }

  async retagUnnamedTaxRate(entryId: string, taxRatePercent: number, taxRateId: string): Promise<number> {
    const entry = this.rows.get(entryId);
    if (!entry || entry.status === "draft") return 0;
    let named = 0;
    const lines = entry.lines.map((line) => {
      if (line.taxRatePercent !== taxRatePercent || (line.taxRateId ?? null) !== null) return line;
      named += 1;
      return { ...line, taxRateId };
    });
    this.rows.set(entryId, { ...entry, lines });
    return named;
  }

  async tagJournalLines(entryId: string, lineIndexes: readonly number[], taxRatePercent: number, taxRateId: string): Promise<number> {
    const entry = this.rows.get(entryId);
    if (!entry || entry.status === "draft") return 0;
    let named = 0;
    const lines = entry.lines.map((line, index) => {
      if (!lineIndexes.includes(index) || (line.taxRateId ?? null) !== null) return line;
      if ((line.taxRatePercent ?? null) !== null && line.taxRatePercent !== taxRatePercent) return line;
      named += 1;
      return { ...line, taxRatePercent, taxRateId };
    });
    this.rows.set(entryId, { ...entry, lines });
    return named;
  }

  async replaceDraft(entry: JournalEntry): Promise<void> {
    this.rows.set(entry.id, entry);
  }

  async deleteDraft(entryId: string): Promise<void> {
    this.rows.delete(entryId);
  }

  async findById(id: string): Promise<JournalEntry | null> {
    return this.rows.get(id) ?? null;
  }

  async findByEntryNo(entryNo: string): Promise<JournalEntry | null> {
    for (const entry of this.rows.values()) {
      if (entry.entryNo === entryNo) return entry;
    }
    return null;
  }

  async list(filter: JournalListFilter = {}): Promise<readonly JournalEntry[]> {
    return [...this.rows.values()]
      .filter((e) => (filter.status ? e.status === filter.status : true))
      .filter((e) => (filter.source ? (e.source ?? "manual") === filter.source : true))
      .filter((e) => (filter.fromDate ? e.date >= filter.fromDate : true))
      .filter((e) => (filter.toDate ? e.date <= filter.toDate : true))
      .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
  }

  async treasuryAccountBalance(query: TreasuryBalanceQuery): Promise<Money> {
    let net = 0n;
    for (const entry of this.rows.values()) {
      if (!LEDGER_STATUSES.has(entry.status)) continue;
      if (query.asOfDate && entry.date > query.asOfDate) continue;
      for (const line of entry.lines) {
        if (line.accountId !== query.accountId) continue;
        const holder = line.treasuryAccountId ?? null;
        if (holder === query.treasuryAccountId || (holder === null && query.withUnattributed)) net += line.debit.scaled - line.credit.scaled;
      }
    }
    return Money.fromScaled(net);
  }

  async accountBalance(accountId: string, asOfDate?: string): Promise<AccountBalance> {
    let debit = 0n;
    let credit = 0n;
    for (const entry of this.rows.values()) {
      if (!LEDGER_STATUSES.has(entry.status)) continue;
      if (asOfDate && entry.date > asOfDate) continue;
      for (const line of entry.lines) {
        if (line.accountId !== accountId) continue;
        debit += line.debit.scaled;
        credit += line.credit.scaled;
      }
    }
    return {
      accountId,
      debit: Money.fromScaled(debit),
      credit: Money.fromScaled(credit),
      balance: Money.fromScaled(debit - credit),
    };
  }

  async accountLedger(accountId: string, asOfDate?: string): Promise<readonly AccountLedgerLine[]> {
    const out: AccountLedgerLine[] = [];
    for (const entry of this.rows.values()) {
      if (!LEDGER_STATUSES.has(entry.status)) continue;
      if (asOfDate && entry.date > asOfDate) continue;
      for (const line of entry.lines) {
        if (line.accountId !== accountId) continue;
        out.push({
          entryId: entry.id,
          entryNo: entry.entryNo ?? null,
          date: entry.date,
          memo: line.memo ?? null,
          debit: line.debit,
          credit: line.credit,
        });
      }
    }
    return out.sort((a, b) => (a.date === b.date ? a.entryId.localeCompare(b.entryId) : a.date.localeCompare(b.date)));
  }

  /** True while `transaction()` is running, so a test can prove a write lands inside it. */
  inTransaction = false;

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const outer = this.inTransaction;
    this.inTransaction = true;
    try {
      return await fn();
    } finally {
      this.inTransaction = outer;
    }
  }
}

/**
 * In-memory {@link SequenceStore} — a per-(code,period) counter with no gaps.
 * Pair with `new NextNumberService(store)` in tests.
 */
export class InMemorySequenceStore implements SequenceStore {
  private readonly counters = new Map<string, number>();

  async increment(code: string, period: number | null): Promise<number> {
    const key = `${code}:${period ?? ""}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }
}

/** Records every published GL event for assertions. */
export class RecordingGlEventPublisher implements GlEventPublisher {
  readonly events: GlDomainEvent[] = [];
  publish(event: GlDomainEvent): void {
    this.events.push(event);
  }
}

/** In-memory {@link AuditSink} for asserting the engine's audit trail. */
export class RecordingAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  async query(stream: AuditStream, limit = 100): Promise<readonly AuditEvent[]> {
    return this.events.filter((e) => e.stream === stream).slice(-limit).reverse();
  }
}
