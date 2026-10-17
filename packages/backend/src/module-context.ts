import type Database from "better-sqlite3";
import type { App, AuthContextResolver, LicenseStateResolver, OwnerDigestBackupReading, PeriodCloseGuardSlot, ReconciliationControl, ReportsRoutesDeps, ScheduledDigestResult, SessionRegistry } from "@mezan/api";
import type { EtaReceiptIssuer } from "./eta-receipts.js";
import type { ScheduledJobStatus } from "./scheduled-jobs.js";
import type { IntegrationsGateway } from "./integrations/gateway.js";
import type { WebhookTransport } from "./integrations/webhook-transport.js";
import type { ApprovalRequestRepository, AuditChainHeadReason, AuditQueryPort, AuditSink, DrainResult, EventBus, InventoryDomainEvent, PayrollBindings, UnitOfWork } from "@mezan/domain";
import type {
  createScryptHasher,
  createSqliteAccountRepository,
  createSqliteBranchStore,
  createSqliteCostCenterRepository,
  createSqliteCollectionsStore,
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
  SecretBox,
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
  /** Runs synchronously INSIDE the posting's transaction: a subscriber must not await, must not throw, and may only write rows that belong with the posting. */
  readonly inventoryEvents: { readonly subscribe: (handler: (event: InventoryDomainEvent) => void) => () => void };
  /** The customer-addressed mail queue and the operator-initiated drain that sends it through the tenant's SMTP session. */
  readonly customerMail: {
    readonly store: ReturnType<typeof createSqliteCollectionsStore>;
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
  /** True on the cloud edition, where sessions live in the database. */
  readonly cloud: boolean;
  readonly auditQuery: AuditQueryPort;
  readonly approvalRequests: ApprovalRequestRepository;
  readonly notificationOutbox: {
    /** Sends only these queued notifications through the tenant's SMTP session. */
    readonly drainOnly: (ids: ReadonlySet<string>) => Promise<DrainResult>;
    readonly configured: () => Promise<boolean>;
  };
  readonly backupStatus: (() => Promise<OwnerDigestBackupReading | null>) | undefined;
  readonly ownerDigestSlot: OwnerDigestSlot;
  readonly auditChain: { verifyHead(): { reason: AuditChainHeadReason; headRowId: number | null } };
  readonly scheduledJobStatus: () => readonly ScheduledJobStatus[];
  readonly resolveLicenseState?: LicenseStateResolver;
  readonly cloudTenant: boolean;
  readonly integrations: IntegrationsSurface | null;
  readonly integrationsSlot: IntegrationsSlot;
  readonly addCloser: (closer: { close(): void }) => void;
  /** The exact deps `/reports` runs on, so an area that reproduces a report reproduces the on-screen figure. */
  readonly reports: ReportsRoutesDeps;
  // SECURITY: the database encryption key (desktop: sealed in the OS keychain). Only for deriving install keys; never logged or returned.
  readonly databaseKey?: string;
  readonly secrets?: SecretBox;
}

export interface IntegrationsSurface {
  readonly tenantCode: string;
  readonly transport?: WebhookTransport;
}

/** Filled by the integrations area; read by the backend handle so the cloud gateway can verify an API key without an HTTP route. */
export interface IntegrationsSlot {
  gateway?: IntegrationsGateway;
}

/** Filled by the owner-digest area; read by the backend handle so a host timer can run the tenant's schedule without an HTTP request. */
export interface OwnerDigestSlot {
  run?: () => Promise<ScheduledDigestResult>;
}

export interface BackendArea {
  readonly mount?: (ctx: BackendModuleContext) => void | Promise<void>;
}
