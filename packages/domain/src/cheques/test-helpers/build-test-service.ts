import type { Account, AccountRepository } from "../../accounts/account.js";
import type { FiscalPeriod, FiscalPeriodRepository } from "../../fiscal-periods/fiscal-period.js";
import { NextNumberService } from "../../numbering/index.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../../gl/test-helpers/in-memory-ledger-repository.js";
import type { Cheque, ChequeListFilter, ChequeRepository } from "../cheque.js";
import { ChequeService } from "../cheque-service.js";

function leaf(id: string, type: Account["type"], naturalBalance: Account["naturalBalance"]): Account {
  return { id, code: id, nameAr: id, nameEn: null, type, naturalBalance, parentId: null, isHeader: false, status: "active" };
}

export const TEST_ACCOUNTS: Account[] = [
  leaf("1100", "asset", "debit"), // AR
  leaf("1310", "asset", "debit"), // bank
  leaf("1320", "asset", "debit"), // cheques under collection
  leaf("1360", "asset", "debit"), // bounced cheques receivable
  leaf("2100", "liability", "credit"), // AP
  leaf("2150", "liability", "credit"), // cheques payable (outgoing control)
];

export const TEST_PERIOD: FiscalPeriod = {
  id: "fp-2026-08",
  year: 2026,
  periodNumber: 8,
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  status: "open",
};

/** A trivial in-memory {@link ChequeRepository} for domain-layer unit tests. */
export class InMemoryChequeRepository implements ChequeRepository {
  private readonly rows = new Map<string, Cheque>();

  async save(cheque: Cheque): Promise<void> {
    this.rows.set(cheque.id, cheque);
  }
  async update(cheque: Cheque): Promise<void> {
    this.rows.set(cheque.id, cheque);
  }
  async findById(id: string): Promise<Cheque | null> {
    return this.rows.get(id) ?? null;
  }
  async findByChequeNumber(direction: Cheque["direction"], chequeNumber: string): Promise<Cheque | null> {
    for (const c of this.rows.values()) {
      if (c.direction === direction && c.chequeNumber === chequeNumber) return c;
    }
    return null;
  }
  async list(filter: ChequeListFilter = {}): Promise<readonly Cheque[]> {
    return [...this.rows.values()]
      .filter((c) => (filter.direction ? c.direction === filter.direction : true))
      .filter((c) => (filter.status ? c.status === filter.status : true))
      .filter((c) => (filter.fromDate ? c.dueDate >= filter.fromDate : true))
      .filter((c) => (filter.toDate ? c.dueDate <= filter.toDate : true))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

export interface TestHarness {
  readonly service: ChequeService;
  readonly cheques: InMemoryChequeRepository;
  readonly ledger: InMemoryLedgerRepository;
}

/**
 * Stand up a real {@link ChequeService} over in-memory stores — the GL posting
 * engine real, only persistence faked. Mirrors `vouchers/test-helpers`.
 */
export function buildTestService(now: () => string = () => "2026-08-22T10:00:00.000Z"): TestHarness {
  const ledger = new InMemoryLedgerRepository();
  const cheques = new InMemoryChequeRepository();
  const numbering = new NextNumberService(new InMemorySequenceStore());

  const accountsById = new Map(TEST_ACCOUNTS.map((a) => [a.id, a]));
  const accounts: Pick<AccountRepository, "findById"> = {
    async findById(id) {
      return accountsById.get(id) ?? null;
    },
  };
  const periods: Pick<FiscalPeriodRepository, "findByDate"> = {
    async findByDate(date) {
      return date >= TEST_PERIOD.startDate && date <= TEST_PERIOD.endDate ? TEST_PERIOD : null;
    },
  };

  const service = new ChequeService({
    cheques,
    gl: { ledger, accounts, periods, numbering, now, actor: "tester" },
    now,
  });

  return { service, cheques, ledger };
}
