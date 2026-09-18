import { Money } from "../../money/index.js";
import { NextNumberService } from "../../numbering/index.js";
import type { Account, AccountRepository } from "../../accounts/account.js";
import type { FiscalPeriod, FiscalPeriodRepository } from "../../fiscal-periods/fiscal-period.js";
import type { TreasuryAccount, TreasuryAccountRepository } from "../../treasury-accounts/treasury-account.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../../gl/test-helpers/in-memory-ledger-repository.js";
import { InMemoryDocumentRepository } from "../../documents/test-helpers/in-memory-document-repository.js";
import type { VoucherLine } from "../voucher-document.js";
import { VoucherService } from "../voucher-service.js";
import { InMemoryAllocationRepository, InMemoryInvoiceRepository } from "./in-memory-allocation-stores.js";
import type { AllocatableInvoice } from "../allocation.js";

function leaf(id: string, code: string, type: Account["type"], naturalBalance: Account["naturalBalance"]): Account {
  return { id, code, nameAr: code, nameEn: null, type, naturalBalance, parentId: null, isHeader: false, status: "active" };
}

export const TEST_ACCOUNTS: Account[] = [
  leaf("1300-1", "1300-1", "asset", "debit"), // cash 1
  leaf("1300-2", "1300-2", "asset", "debit"), // cash 2
  leaf("1310", "1310", "asset", "debit"), // bank
  leaf("1100", "1100", "asset", "debit"), // AR
  leaf("2100", "2100", "liability", "credit"), // AP
  leaf("2150", "2150", "liability", "credit"), // customer advances
  leaf("2200", "2200", "liability", "credit"), // tax payable
  leaf("3100", "3100", "equity", "credit"), // partner capital
  leaf("4900", "4900", "revenue", "credit"), // other income
  leaf("5900", "5900", "expense", "debit"), // other expense
  leaf("1160", "1160", "asset", "debit"), // employee advances (عهدة)
  leaf("2160", "2160", "liability", "credit"), // contracting customer advances
  leaf("2210", "2210", "liability", "credit"), // withholding tax payable
  leaf("3200", "3200", "equity", "debit"), // partner drawings (contra-equity)
  leaf("4910", "4910", "revenue", "credit"), // sundry income default
  leaf("5910", "5910", "expense", "debit"), // sundry expense default
];

export const TEST_TREASURY_ACCOUNTS: TreasuryAccount[] = [
  { id: "ta-cash1", code: "CASH-001", name: "صندوق 1", nameEn: null, type: "cash", currency: "EGP", branchId: "b1", glAccountId: "1300-1", openingBalance: Money.zero(), openingBalanceDate: null, guaranteeFacilityLimit: null, status: "active" },
  { id: "ta-cash2", code: "CASH-002", name: "صندوق 2", nameEn: null, type: "cash", currency: "EGP", branchId: "b1", glAccountId: "1300-2", openingBalance: Money.zero(), openingBalanceDate: null, guaranteeFacilityLimit: null, status: "active" },
  { id: "ta-bank1", code: "BANK-001", name: "بنك", nameEn: null, type: "bank", currency: "EGP", branchId: "b1", glAccountId: "1310", openingBalance: Money.zero(), openingBalanceDate: null, guaranteeFacilityLimit: null, status: "active" },
];

export const TEST_PERIOD: FiscalPeriod = {
  id: "fp-2026-08",
  year: 2026,
  periodNumber: 8,
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  status: "open",
};

export interface TestHarness {
  readonly service: VoucherService;
  readonly ledger: InMemoryLedgerRepository;
  readonly documents: InMemoryDocumentRepository<VoucherLine>;
  readonly allocations: InMemoryAllocationRepository;
  readonly invoices: InMemoryInvoiceRepository;
  /** Post a starting cash balance into a treasury GL account so payment tests have funds. */
  seedCashBalance(glAccountId: string, amountMajor: string): Promise<void>;
}

let seedSeq = 0;

/**
 * Stand up a real {@link VoucherService} over in-memory stores — the GL posting
 * engine, numbering engine, workflow gate and document framework all real, only
 * persistence faked. Mirrors how the GL/document tests wire their harnesses.
 */
export function buildTestService(
  opts: {
    preventNegativeCashBalance?: boolean;
    invoices?: readonly AllocatableInvoice[];
    /** Approved rates by currency, so a foreign-currency voucher can confirm (B-4). */
    rates?: Readonly<Record<string, string>>;
    /** Confirmed return credit per invoice id (D242). */
    returned?: Readonly<Record<string, string>>;
  } = {},
): TestHarness {
  const ledger = new InMemoryLedgerRepository();
  const documents = new InMemoryDocumentRepository<VoucherLine>();
  const allocations = new InMemoryAllocationRepository();
  const invoices = new InMemoryInvoiceRepository(opts.invoices ?? []);
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
  const taById = new Map(TEST_TREASURY_ACCOUNTS.map((t) => [t.id, t]));
  const treasuryAccounts: Pick<TreasuryAccountRepository, "findById"> = {
    async findById(id) {
      return taById.get(id) ?? null;
    },
  };

  const service = new VoucherService({
    documents,
    ledger,
    accounts,
    periods,
    numbering,
    treasuryAccounts,
    allocations,
    invoices,
    settings: {
      async get() {
        return { preventNegativeCashBalance: opts.preventNegativeCashBalance ?? true } as never;
      },
      async save() {},
    },
    exchangeRates: {
      async findRate(currency) {
        const rate = opts.rates?.[currency];
        return rate ? { rate } : null;
      },
    },
    baseCurrency: "EGP",
    ...(opts.returned
      ? {
          returns: {
            async returnedByIds(ids: readonly string[]) {
              return new Map(ids.filter((id) => opts.returned?.[id]).map((id) => [id, Money.fromMajor(opts.returned![id]!)]));
            },
          },
        }
      : {}),
    now: () => "2026-08-22T10:00:00.000Z",
    actor: "tester",
    actorRoles: ["*"],
  });

  async function seedCashBalance(glAccountId: string, amountMajor: string): Promise<void> {
    seedSeq += 1;
    await ledger.save({
      id: `seed-${seedSeq}`,
      entryNo: `SEED-${seedSeq}`,
      date: "2026-08-01",
      memo: "seed",
      status: "posted",
      source: "system",
      lines: [
        { accountId: glAccountId, debit: Money.fromMajor(amountMajor), credit: Money.zero(), memo: null },
        { accountId: "3100", debit: Money.zero(), credit: Money.fromMajor(amountMajor), memo: null },
      ],
      createdAt: "2026-08-01T00:00:00.000Z",
      postedAt: "2026-08-01T00:00:00.000Z",
      reversesEntryId: null,
      reversedByEntryId: null,
    });
  }

  return { service, ledger, documents, allocations, invoices, seedCashBalance };
}
