import type Database from "better-sqlite3";
import type { App, AuthContextResolver, PeriodCloseGuardSlot, ReconciliationControl, SessionRegistry } from "@mezan/api";
import type { EtaReceiptIssuer } from "./eta-receipts.js";
import type { AuditSink, CustomerMessageOutbox, DrainResult, EventBus, PayrollBindings, UnitOfWork } from "@mezan/domain";
import type {
  createScryptHasher,
  createSqliteAccountRepository,
  createSqliteBranchStore,
  createSqliteCostCenterRepository,
  createSqliteCustomerRepository,
  createSqliteEmployeeRepository,
  createSqliteEtaStore,
  createSqliteFiscalPeriodRepository,
  createSqliteItemStore,
  createSqliteLedgerStore,
  createSqlitePriceListStore,
  createSqlitePromotionStore,
  createSqliteSalesInvoiceStore,
  createSqliteSequenceConfigStore,
  createSqliteSequenceStore,
  createSqliteSettingsStore,
  createSqliteStockLedgerStore,
  createSqliteSupplierRepository,
  createSqliteTaxRateRepository,
  createSqliteTreasuryAccountRepository,
  createSqliteVoucherStore,
  createSqliteWarehouseStore,
} from "@mezan/persistence";

export interface BackendStores {
  readonly settings: ReturnType<typeof createSqliteSettingsStore>;
  readonly branches: ReturnType<typeof createSqliteBranchStore>;
  readonly warehouses: ReturnType<typeof createSqliteWarehouseStore>;
  readonly accounts: ReturnType<typeof createSqliteAccountRepository>;
  readonly customers: ReturnType<typeof createSqliteCustomerRepository>;
  readonly suppliers: ReturnType<typeof createSqliteSupplierRepository>;
  readonly items: ReturnType<typeof createSqliteItemStore>;
  readonly taxRates: ReturnType<typeof createSqliteTaxRateRepository>;
  readonly costCenters: ReturnType<typeof createSqliteCostCenterRepository>;
  readonly treasuryAccounts: ReturnType<typeof createSqliteTreasuryAccountRepository>;
  readonly fiscalPeriods: ReturnType<typeof createSqliteFiscalPeriodRepository>;
  readonly ledger: ReturnType<typeof createSqliteLedgerStore>;
  readonly stockLedger: ReturnType<typeof createSqliteStockLedgerStore>;
  readonly salesInvoices: ReturnType<typeof createSqliteSalesInvoiceStore>;
  readonly vouchers: ReturnType<typeof createSqliteVoucherStore>;
  readonly priceLists: ReturnType<typeof createSqlitePriceListStore>;
  readonly promotions: ReturnType<typeof createSqlitePromotionStore>;
  readonly eta: ReturnType<typeof createSqliteEtaStore>;
  readonly employees: ReturnType<typeof createSqliteEmployeeRepository>;
  readonly sequenceConfig: ReturnType<typeof createSqliteSequenceConfigStore>;
  readonly sequenceCounters: ReturnType<typeof createSqliteSequenceStore>;
}

/**
 * What `createBackend` hands every POS and enhancement area once, after the
 * core API is mounted. An area opens its own store handles on `sqlite`: every
 * store shares that ONE connection (see `createBackend`), so a second handle on
 * another area's tables is cheap and never a second writer.
 */
export interface BackendModuleContext {
  readonly app: App;
  readonly sqlite: Database.Database;
  readonly uow: UnitOfWork;
  readonly resolveAuthContext: AuthContextResolver;
  readonly sessions: SessionRegistry;
  readonly hasher: ReturnType<typeof createScryptHasher>;
  readonly audit: AuditSink;
  readonly eventBus: EventBus;
  /** Issues a sale's e-receipt synchronously with the terminal's serial and tender (D283). */
  readonly etaReceipts: EtaReceiptIssuer;
  readonly stores: BackendStores;
  /** The customer-addressed mail queue and the operator-initiated drain that sends it through the tenant's SMTP session. */
  readonly customerMail: {
    readonly outbox: CustomerMessageOutbox;
    readonly drain: () => Promise<DrainResult>;
    readonly configured: () => Promise<boolean>;
  };
  /** LEDGER INVARIANT: the one derived cash-and-bank set (cash-and-bank-accounts.ts) — a module that says "cash" reads this, never the treasury directory or an account-code prefix. */
  readonly cashAndBankAccountIds: () => Promise<readonly string[]>;
  readonly reconciliationControls: (asOfDate?: string) => Promise<readonly ReconciliationControl[]>;
  readonly payrollBindings: PayrollBindings;
  readonly treasuryFx: {
    foreignCurrencyByGlAccount(): Promise<ReadonlyMap<string, string>>;
    rateOn(currency: string, date: string): Promise<string | null>;
  };
  readonly periodCloseGuard: PeriodCloseGuardSlot;
  readonly addCloser: (closer: { close(): void }) => void;
}

export interface BackendArea {
  readonly mount?: (ctx: BackendModuleContext) => void | Promise<void>;
}
