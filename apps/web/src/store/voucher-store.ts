import {
  Money,
  NextNumberService,
  VoucherService,
  voucherDocumentType,
  type Account,
  type AccountRepository,
  type AllocatableInvoice,
  type AllocatableInvoiceRepository,
  type AllocationInvoiceKind,
  type AllocationRepository,
  type AccountBalance,
  type AccountLedgerLine,
  type DocumentListFilter,
  type DocumentRepository,
  type FiscalPeriod,
  type FiscalPeriodRepository,
  type JournalEntry,
  type JournalListFilter,
  type LedgerRepository,
  type SequenceStore,
  type TreasuryAccount,
  type TreasuryAccountRepository,
  type VoucherAllocation,
  type VoucherDocument,
  type VoucherLine,
} from "@mezan/domain";
import type { DemoParty } from "../vouchers-sample-data";

/**
 * In-memory wiring for the Treasury Vouchers demo — the analogue of
 * `journal-store.ts` for the voucher module. It stands up the REAL domain
 * services (the GL posting engine, numbering engine, workflow gate, document
 * framework AND the voucher-specific cash-negative guard + allocation engine)
 * against seeded in-memory repositories, so the screen exercises actual posting,
 * numbering, lifecycle, the cash guard and allocation rather than faking them.
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

class MemVoucherRepo implements DocumentRepository<VoucherLine> {
  private readonly rows = new Map<string, VoucherDocument>();
  async save(doc: VoucherDocument) {
    this.rows.set(doc.id, doc);
  }
  async update(doc: VoucherDocument) {
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
  snapshot(): VoucherDocument[] {
    return [...this.rows.values()].sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)));
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

class MemAllocationRepo implements AllocationRepository {
  private readonly rows = new Map<string, VoucherAllocation>();
  seed(alloc: VoucherAllocation) {
    this.rows.set(alloc.id, alloc);
  }
  async save(alloc: VoucherAllocation) {
    this.rows.set(alloc.id, alloc);
  }
  async update(alloc: VoucherAllocation) {
    this.rows.set(alloc.id, alloc);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async listByVoucher(voucherId: string) {
    return [...this.rows.values()].filter((a) => a.voucherId === voucherId);
  }
  async listByInvoice(invoiceId: string) {
    return [...this.rows.values()].filter((a) => a.invoiceId === invoiceId);
  }
  snapshot(): VoucherAllocation[] {
    return [...this.rows.values()];
  }
}

class MemInvoiceRepo implements AllocatableInvoiceRepository {
  private readonly rows = new Map<string, AllocatableInvoice>();
  constructor(seed: readonly AllocatableInvoice[]) {
    for (const inv of seed) this.rows.set(inv.id, inv);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async save(invoice: AllocatableInvoice) {
    this.rows.set(invoice.id, invoice);
  }
  async listOpen(filter: { kind?: AllocationInvoiceKind; partyId?: string }) {
    return [...this.rows.values()].filter(
      (i) =>
        i.total.scaled - i.allocated.scaled > 0n &&
        (filter.kind ? i.kind === filter.kind : true) &&
        (filter.partyId ? i.partyId === filter.partyId : true),
    );
  }
  snapshot(): AllocatableInvoice[] {
    return [...this.rows.values()];
  }
}

export interface VoucherStore {
  readonly service: VoucherService;
  readonly accounts: Account[];
  readonly treasuryAccounts: TreasuryAccount[];
  readonly customers: DemoParty[];
  readonly suppliers: DemoParty[];
  snapshot(): VoucherDocument[];
  openInvoices(): AllocatableInvoice[];
  allocations(): VoucherAllocation[];
}

export interface VoucherStoreSeed {
  readonly accounts: Account[];
  readonly treasuryAccounts: TreasuryAccount[];
  readonly customers: DemoParty[];
  readonly suppliers: DemoParty[];
  readonly period: FiscalPeriod;
  readonly openInvoices: readonly AllocatableInvoice[];
  readonly openingBalances?: readonly { glAccountId: string; amount: string }[];
  readonly seededVouchers?: readonly VoucherDocument[];
  readonly seededAllocations?: readonly VoucherAllocation[];
  readonly startCvNumber?: number;
  now?: () => string;
}

export function createVoucherStore(seed: VoucherStoreSeed): VoucherStore {
  const ledger = new MemLedger();
  const sequence = new MemSequence();
  const docRepo = new MemVoucherRepo();
  const allocations = new MemAllocationRepo();
  const invoices = new MemInvoiceRepo(seed.openInvoices);
  if (seed.startCvNumber) sequence.seed("CASH_VOUCHER", seed.startCvNumber);

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
  const taById = new Map(seed.treasuryAccounts.map((t) => [t.id, t]));
  const treasuryAccounts: Pick<TreasuryAccountRepository, "findById"> = {
    async findById(id) {
      return taById.get(id) ?? null;
    },
  };

  const now = seed.now ?? (() => new Date().toISOString());

  const service = new VoucherService({
    documents: docRepo,
    ledger,
    accounts,
    periods,
    numbering: new NextNumberService(sequence),
    treasuryAccounts,
    allocations,
    invoices,
    settings: {
      async get() {
        return { preventNegativeCashBalance: true } as never;
      },
      async save() {},
    },
    resolveGateConfig: () => null,
    now,
    actor: "demo",
    actorRoles: ["*"],
  });

  // Opening balances first (Dr treasury / Cr capital) so cash accounts have funds.
  let seedNo = 0;
  for (const ob of seed.openingBalances ?? []) {
    seedNo += 1;
    void ledger.save({
      id: `ob-${seedNo}`,
      entryNo: `OB-${seedNo}`,
      date: seed.period.startDate,
      memo: "الرصيد الافتتاحي",
      status: "posted",
      source: "system",
      lines: [
        { accountId: ob.glAccountId, debit: Money.fromMajor(ob.amount), credit: Money.zero(), memo: null },
        { accountId: "3100", debit: Money.zero(), credit: Money.fromMajor(ob.amount), memo: null },
      ],
      createdAt: `${seed.period.startDate}T00:00:00.000Z`,
      postedAt: `${seed.period.startDate}T00:00:00.000Z`,
      reversesEntryId: null,
      reversedByEntryId: null,
    });
  }

  // Seed confirmed vouchers + their JEs (posting derived from the real type def).
  for (const doc of seed.seededVouchers ?? []) {
    void docRepo.save(doc);
    if (doc.journalEntryId && doc.status === "confirmed") {
      const posting = voucherDocumentType.buildGlPosting?.(doc);
      if (posting) {
        void ledger.save({
          id: doc.journalEntryId,
          entryNo: doc.docNo,
          date: doc.date,
          memo: doc.memo,
          status: "posted",
          source: "system",
          lines: posting.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo ?? null })),
          createdAt: doc.createdAt,
          postedAt: doc.confirmedAt,
          reversesEntryId: null,
          reversedByEntryId: null,
        });
      }
    }
  }
  for (const alloc of seed.seededAllocations ?? []) allocations.seed(alloc);

  return {
    service,
    accounts: seed.accounts.filter((a) => !a.isHeader && a.status === "active"),
    treasuryAccounts: seed.treasuryAccounts,
    customers: seed.customers,
    suppliers: seed.suppliers,
    snapshot: () => docRepo.snapshot(),
    openInvoices: () => invoices.snapshot(),
    allocations: () => allocations.snapshot(),
  };
}
