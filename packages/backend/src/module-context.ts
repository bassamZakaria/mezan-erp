import type Database from "better-sqlite3";
import type { App, AuthContextResolver, LicenseStateResolver, OwnerDigestBackupReading, PeriodCloseGuardSlot, ReconciliationControl, ReportsRoutesDeps, ScheduledDigestResult, SessionRegistry } from "@mezan/api";
import type { EtaReceiptIssuer } from "./eta-receipts.js";
import type { ScheduledJobStatus } from "./scheduled-jobs.js";
import type { IntegrationsGateway } from "./integrations/gateway.js";
import type { WebhookTransport } from "./integrations/webhook-transport.js";
import type { ApprovalRequestRepository, AuditChainHeadReason, AuditQueryPort, AuditSink, DrainResult, EventBus, InventoryDomainEvent, PayrollBindings, UnitOfWork } from "@mezan/domain";
import type { SqlDb } from "@mezan/persistence";
import type {
  createScryptHasher,
  createAccountRepository,
  createBranchStore,
  createCostCenterRepository,
  createCollectionsStore,
  createCustomerRepository,
  createEmployeeRepository,
  createEtaStore,
  createFiscalPeriodRepository,
  createItemStore,
  createLedgerStore,
  createPriceListStore,
  createPromotionStore,
  createSalesInvoiceStore,
  createSequenceConfigStore,
  createSequenceStore,
  createSettingsStore,
  createStockLedgerStore,
  createSupplierRepository,
  createTaxRateRepository,
  createTreasuryAccountRepository,
  createVoucherStore,
  createWarehouseStore,
  SecretBox,
} from "@mezan/persistence";

export interface BackendStores {
  readonly settings: Awaited<ReturnType<typeof createSettingsStore>>;
  readonly branches: ReturnType<typeof createBranchStore>;
  readonly warehouses: ReturnType<typeof createWarehouseStore>;
  readonly accounts: ReturnType<typeof createAccountRepository>;
  readonly customers: ReturnType<typeof createCustomerRepository>;
  readonly suppliers: ReturnType<typeof createSupplierRepository>;
  readonly items: ReturnType<typeof createItemStore>;
  readonly taxRates: ReturnType<typeof createTaxRateRepository>;
  readonly costCenters: ReturnType<typeof createCostCenterRepository>;
  readonly treasuryAccounts: ReturnType<typeof createTreasuryAccountRepository>;
  readonly fiscalPeriods: ReturnType<typeof createFiscalPeriodRepository>;
  readonly ledger: ReturnType<typeof createLedgerStore>;
  readonly stockLedger: ReturnType<typeof createStockLedgerStore>;
  readonly salesInvoices: ReturnType<typeof createSalesInvoiceStore>;
  readonly vouchers: ReturnType<typeof createVoucherStore>;
  readonly priceLists: ReturnType<typeof createPriceListStore>;
  readonly promotions: ReturnType<typeof createPromotionStore>;
  readonly eta: ReturnType<typeof createEtaStore>;
  readonly employees: ReturnType<typeof createEmployeeRepository>;
  readonly sequenceConfig: ReturnType<typeof createSequenceConfigStore>;
  readonly sequenceCounters: ReturnType<typeof createSequenceStore>;
}

/**
 * What `createBackend` hands every POS and enhancement area once, after the
 * core API is mounted. An area opens its own store handles through `store`, on
 * the ONE database the backend runs on (see `createBackend`), so a second handle
 * on another area's tables is cheap and never a second writer.
 */
export interface BackendModuleContext {
  readonly app: App;
  readonly db: SqlDb;
  readonly sqlite?: Database.Database;
  readonly store: <T>(viaSqlite: (sqlite: Database.Database) => T, viaDb: (db: SqlDb) => T) => T;
  readonly uow: UnitOfWork;
  readonly resolveAuthContext: AuthContextResolver;
  readonly sessions: SessionRegistry;
  readonly hasher: ReturnType<typeof createScryptHasher>;
  readonly audit: AuditSink;
  readonly eventBus: EventBus;
  /** Issues a sale's e-receipt synchronously with the terminal's serial and tender (D283). */
  readonly etaReceipts: EtaReceiptIssuer;
  readonly stores: BackendStores;
  /** CONTRACT: handlers are awaited one after another INSIDE the posting's transaction, each in its own savepoint, and may only write rows that belong with the posting. A handler that throws has its own writes rolled back and is logged; the posting still commits. */
  readonly inventoryEvents: { readonly subscribe: (handler: (event: InventoryDomainEvent) => Promise<void>) => () => void };
  /** The customer-addressed mail queue and the operator-initiated drain that sends it through the tenant's SMTP session. */
  readonly customerMail: {
    readonly store: ReturnType<typeof createCollectionsStore>;
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
  readonly collectionsScheduleSlot: CollectionsScheduleSlot;
  readonly auditChain: { verifyHead(): Promise<{ reason: AuditChainHeadReason; headRowId: number | null }> };
  readonly scheduledJobStatus: () => readonly ScheduledJobStatus[];
  readonly resolveLicenseState?: LicenseStateResolver;
  readonly cloudTenant: boolean;
  readonly integrations: IntegrationsSurface | null;
  readonly integrationsSlot: IntegrationsSlot;
  readonly addCloser: (closer: object) => void;
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

export interface ScheduledCollectionsResult {
  readonly ran: boolean;
  readonly queued: number;
  readonly sent: number;
}

/** Filled by the collections area; read by the backend handle so the cloud host's timer can run the tenant's opted-in dunning without an HTTP request. */
export interface CollectionsScheduleSlot {
  run?: () => Promise<ScheduledCollectionsResult | null>;
}

export interface BackendArea {
  readonly mount?: (ctx: BackendModuleContext) => void | Promise<void>;
}
