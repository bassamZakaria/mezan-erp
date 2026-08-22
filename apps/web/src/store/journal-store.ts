import {
  Money,
  NextNumberService,
  DocumentService,
  journalDocumentType,
  createJournalGlHook,
  createDocumentWorkflowGate,
  type Account,
  type AccountRepository,
  type FiscalPeriod,
  type FiscalPeriodRepository,
  type JournalEntry,
  type LedgerRepository,
  type JournalListFilter,
  type AccountBalance,
  type AccountLedgerLine,
  type SequenceStore,
  type DocumentRepository,
  type DocumentListFilter,
  type FrameworkDocument,
  type JournalDocLine,
} from "@mezan/domain";

/**
 * In-memory wiring for the Journal Entries demo — the analogue of
 * `local-store.ts` for the document framework. It stands up the REAL domain
 * services (the GL posting engine, the numbering engine, the workflow gate and
 * the generic `DocumentService`) against seeded in-memory repositories, so the
 * screen exercises actual balance enforcement / numbering / lifecycle rather
 * than faking them in the UI. Swapping these repos for the SQLite adapters +
 * a fetch-backed client is the follow-up once the API is wired into the web
 * build.
 */

const LEDGER_STATUSES = new Set(["posted", "reversed"]);

class MemLedger implements LedgerRepository {
  private readonly rows = new Map<string, JournalEntry>();
  async save(entry: JournalEntry) {
    this.rows.set(entry.id, entry);
  }
  async update(entry: JournalEntry) {
    this.rows.set(entry.id, entry);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByEntryNo(entryNo: string) {
    for (const e of this.rows.values()) if (e.entryNo === entryNo) return e;
    return null;
  }
  async list(filter: JournalListFilter = {}) {
    return [...this.rows.values()].filter((e) => (filter.status ? e.status === filter.status : true));
  }
  async accountBalance(accountId: string): Promise<AccountBalance> {
    let debit = 0n;
    let credit = 0n;
    for (const e of this.rows.values()) {
      if (!LEDGER_STATUSES.has(e.status)) continue;
      for (const l of e.lines) {
        if (l.accountId !== accountId) continue;
        debit += l.debit.scaled;
        credit += l.credit.scaled;
      }
    }
    return { accountId, debit: Money.fromScaled(debit), credit: Money.fromScaled(credit), balance: Money.fromScaled(debit - credit) };
  }
  async accountLedger(): Promise<readonly AccountLedgerLine[]> {
    return [];
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

class MemSequence implements SequenceStore {
  private readonly counters = new Map<string, number>();
  seed(code: string, value: number) {
    this.counters.set(`${code}:`, value);
  }
  async increment(code: string, period: number | null) {
    const key = `${code}:${period ?? ""}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }
}

class MemDocRepo implements DocumentRepository<JournalDocLine> {
  private readonly rows = new Map<string, FrameworkDocument<JournalDocLine>>();
  async save(doc: FrameworkDocument<JournalDocLine>) {
    this.rows.set(doc.id, doc);
  }
  async update(doc: FrameworkDocument<JournalDocLine>) {
    this.rows.set(doc.id, doc);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list(filter: DocumentListFilter = {}) {
    return [...this.rows.values()]
      .filter((d) => (filter.status ? d.status === filter.status : true))
      .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
  }
  snapshot(): FrameworkDocument<JournalDocLine>[] {
    return [...this.rows.values()].sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)));
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

export interface JournalStore {
  readonly service: DocumentService<JournalDocLine>;
  /** Postable (leaf, active) accounts for the account picker. */
  readonly accounts: Account[];
  snapshot(): FrameworkDocument<JournalDocLine>[];
}

export interface JournalStoreSeed {
  readonly accounts: Account[];
  /** Open fiscal period the demo posts into. */
  readonly period: FiscalPeriod;
  readonly seededDocuments?: FrameworkDocument<JournalDocLine>[];
  /** Seeds the JE counter so newly posted entries continue the numbering. */
  readonly startJeNumber?: number;
  now?: () => string;
}

export function createJournalStore(seed: JournalStoreSeed): JournalStore {
  const ledger = new MemLedger();
  const sequence = new MemSequence();
  const docRepo = new MemDocRepo();
  if (seed.startJeNumber) sequence.seed("JOURNAL_ENTRY", seed.startJeNumber);

  const accountsById = new Map(seed.accounts.map((a) => [a.id, a]));
  const accounts: Pick<AccountRepository, "findById"> = {
    async findById(id) {
      return accountsById.get(id) ?? null;
    },
  };
  const periods: Pick<FiscalPeriodRepository, "findByDate"> = {
    async findByDate(date) {
      return date >= seed.period.startDate && date <= seed.period.endDate ? seed.period : null;
    },
  };

  const now = seed.now ?? (() => new Date().toISOString());

  const gl = createJournalGlHook({
    ledger,
    accounts,
    periods,
    numbering: new NextNumberService(sequence),
    now,
    actor: "demo",
  });

  const service = new DocumentService(journalDocumentType, {
    repo: docRepo,
    gl,
    // No approval chain configured in the demo tenant → confirmation is granted
    // immediately (matches the recon: all 78 entries are posted, none pending).
    workflow: createDocumentWorkflowGate(() => null),
    auditModule: "accounting",
    now,
    actor: "demo",
  });

  // Seed posted documents + their ledger entries so the list has data and
  // seeded entries can be reversed.
  for (const doc of seed.seededDocuments ?? []) {
    void docRepo.save(doc);
    if (doc.journalEntryId && doc.status === "posted") {
      void ledger.save({
        id: doc.journalEntryId,
        entryNo: doc.docNo,
        date: doc.date,
        memo: doc.memo,
        status: "posted",
        source: "manual",
        lines: doc.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo ?? null })),
        createdAt: doc.createdAt,
        postedAt: doc.confirmedAt,
        reversesEntryId: null,
        reversedByEntryId: null,
      });
    }
  }

  return { service, accounts: seed.accounts.filter((a) => !a.isHeader && a.status === "active"), snapshot: () => docRepo.snapshot() };
}
