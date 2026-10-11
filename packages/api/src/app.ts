import { Hono, type Context } from "hono";
import type { ItemCatalogCheck } from "./item-check.js";
import {
  Money,
  can,
  SeatSessionRegistry,
  createEntitlements,
  type UnitOfWork,
  type AccountRepository,
  type SettingsRepository,
  type BranchRepository,
  type WarehouseRepository,
  type CustomerRepository,
  type SupplierRepository,
  type ItemRepository,
  type ItemUnitRepository,
  type ItemCategoryRepository,
  type AccountRoutingRepository,
  type TaxGroupRepository,
  type ItemBrandRepository,
  type ItemSeasonRepository,
  type ItemSpecificationRepository,
  type ItemSpecificationUsageCounter,
  type AttachmentRepository,
  type EventCode,
  type AllocatableInvoiceRepository,
  type BarcodeConfigRepository,
  type AuditQueryPort,
  type AuditSink,
  type LabelLayoutRepository,
  type Entitlements,
  type TaxRateRepository,
  type CostCenterRepository,
  type TreasuryAccountRepository,
  type FiscalPeriodRepository,
  type StockLedgerService,
  type StockReservationSource,
  postJournalEntry,
  type NextNumberService,
  type JournalPostingDeps,
  type PurchaseOrderRepository,
  type GoodsReceiptRepository,
  type PurchaseInvoiceRepository,
  type PurchaseGlAccounts,
  type PurchaseGlPosting,
  type WacSnapshotRepository,
  type PurchaseGlPostingPort,
  type PurchaseGlReversalPort,
  type PurchasePolicy,
  type BomRepository,
  type WorkOrderRepository,
  type ConfigurableProductRepository,
  type ConfigInstanceRepository,
  type WorkStationRepository,
  type WorkOrderGlAccounts,
  type ManufacturingGlPosting,
  type ManufacturingGlPostingPort,
  type CostLayerRepository,
  type PurchaseRfqRepository,
  type RfqQuoteRepository,
  type HistoricalPurchaseArchiveRepository,
  type HistoricalImportGlPostingPort,
  type HistoricalImportGlAccounts,
  type HistoricalSalesArchiveRepository,
  type HistoricalSalesImportGlPostingPort,
  type HistoricalSalesImportGlAccounts,
  type TenantSettings,
  createDefaultSettings,
  reverseJournalEntry,
  type DocumentService,
  type LandedCostService,
  type PurchaseInvoiceLookupPort,
  type SalesInvoiceLookupPort,
  type SalesReturnRefundPort,
  type SalesReturnLine,
  type PurchaseReturnLine,
  type LandedCostLine,
  type PriceListRepository,
  type PromotionRepository,
  type NotificationRuleRepository,
  type NotificationRepository,
  createSalesInvoiceCustomerExposureHook,
  createSalesInvoicePromotionHook,
  type StockAdjustmentDocLine,
  type StockTransferDocLine,
  type PhysicalCountService,
  type PrintTemplateConfigRepository,
  type DepartmentRepository,
  type EmployeeRepository,
  type AssetCategoryRepository,
  type AssetRepository,
  VoucherService,
  SalesInvoiceService,
  type ApprovalRequestRecord,
  type GateableActionType,
  MODULE_CATALOG,
} from "@mezan/domain";
import { createScryptHasher } from "@mezan/persistence";
import { createLanRoutes } from "./lan/routes.js";
import { sessionOriginReporting, type SessionRegistry } from "./session-auth.js";
import type { LoginThrottle } from "./login-throttle.js";
import { applyModuleGates, entitlementsBinding, type EntitlementsResolver } from "./module-gate.js";
import { createAccountsRouter } from "./accounts.js";
import { createPermissionGate, insecureHeaderAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";
import {
  createWriteGate,
  WRITABLE_LICENSE_STATE,
  type LicenseStateResolver,
} from "./license-gate.js";
import { createSettingsRoutes } from "./settings-routes.js";
import { tenantTimeZoneMiddleware } from "./tenant-day.js";
import { createCurrencyCheck, type CurrencyCheck } from "./currency-policy.js";
import { createBranchesRoutes } from "./branches-routes.js";
import { createWarehousesRoutes } from "./warehouses-routes.js";
import {
  createCustomersRouter,
  type CustomerReceivablesSource,
  type PartyOpeningBalancePoster,
} from "./customers-routes.js";
import { createSuppliersRouter, type SupplierPayablesSource } from "./suppliers-routes.js";
import { createItemsRouter } from "./items-routes.js";
import {
  createItemCategoriesRoutes,
  createItemBrandsRoutes,
  createItemSeasonsRoutes,
  createItemUnitsRoutes,
} from "./item-catalog-routes.js";
import { createItemSpecificationsRoutes } from "./item-specifications-routes.js";
import { createAttachmentsRoutes } from "./attachments-routes.js";
import { createAccountRoutingRoutes } from "./account-routing-routes.js";
import { createRolesRoutes } from "./roles-routes.js";
import { createUsersRoutes } from "./users-routes.js";
import { createUserErasurePort } from "./user-erasure.js";
import { createTaxRatesRoutes } from "./tax-rates-routes.js";
import { createTaxGroupsRoutes } from "./tax-groups-routes.js";
import { createCostCentersRoutes } from "./cost-centers-routes.js";
import { createTreasuryAccountsRoutes } from "./treasury-accounts-routes.js";
import { createFiscalPeriodsRoutes } from "./fiscal-periods-routes.js";
import { createInventoryRoutes } from "./inventory-routes.js";
import { createGlRoutes, type GlRoutesDeps } from "./gl-routes.js";
import { createVouchersRoutes, createAllocationRoutes, type VoucherRoutesDeps } from "./vouchers-routes.js";
import { createSalesInvoicesRoutes, type SalesInvoiceRoutesDeps } from "./sales-invoices-routes.js";
import { createSalesInvoiceQuota } from "./plan-quota-wiring.js";
import { createPlanUsageRoutes } from "./plan-usage-routes.js";
import { planLocationsBinding } from "./plan-locations.js";
import { createSalesReturnsRoutes } from "./sales-returns-routes.js";
import { createPurchaseReturnsRoutes } from "./purchase-returns-routes.js";
import { createLandedCostsRoutes } from "./landed-costs-routes.js";
import { createInstallmentsRoutes, type InstallmentsRoutesDeps } from "./installments-routes.js";
import { createDocumentsRoutes } from "./documents-routes.js";
import { createPurchasesRoutes, type PurchasesRoutesDeps } from "./purchases-routes.js";
import { createManufacturingRoutes, type ManufacturingRoutesDeps } from "./manufacturing-routes.js";
import { createRfqRoutes } from "./rfq-routes.js";
import type { MasterDataChecks } from "./master-data-check.js";
import { createHistoricalImportRoutes } from "./historical-import-routes.js";
import { createPrintTemplateConfigRoutes } from "./print-template-config-routes.js";
import { createDataMigrationRoutes, type DataMigrationRoutesDeps, type DataMigrationTransactor } from "./data-migration-routes.js";
import { createSalesHistoricalImportRoutes } from "./sales-historical-import-routes.js";
import { createPriceListsRoutes } from "./price-lists-routes.js";
import { createPromotionsRoutes } from "./promotions-routes.js";
import { createNotificationRulesRoutes } from "./notification-rules-routes.js";
import { createNotificationsRoutes } from "./notifications-routes.js";
import { createSalesQuotesRoutes, type SalesQuoteRoutesDeps } from "./sales-quotes-routes.js";
import { createExchangeRatesRoutes } from "./exchange-rates-routes.js";
import { createCostCenterPnLRoutes, type CostCenterPnLRoutesDeps } from "./cost-center-pl-routes.js";
import { createFxRevaluationRoutes, type FxRevaluationRoutesDeps } from "./fx-revaluation-routes.js";
import { createReconciliationRoutes, type ReconciliationRoutesDeps } from "./reconciliation-routes.js";
import { createOpeningBalanceDuplicatesRoutes, type OpeningBalanceDuplicatesRoutesDeps } from "./opening-balance-duplicates-routes.js";
import { createEtaRoutes, type EtaRoutesDeps } from "./eta-routes.js";
import type { ExchangeRateRepository } from "@mezan/domain";
import type { DocumentEventPublisher } from "@mezan/domain";
import { createReportsRoutes, customerAgingOwed, supplierAgingOwed, type ReportsRoutesDeps } from "./reports-routes.js";
import { createChequesRoutes, type ChequeRoutesDeps } from "./cheques-routes.js";
import { createBankReconciliationRoutes, type BankReconciliationRoutesDeps } from "./bank-reconciliation-routes.js";
import { createCrmRoutes, type CrmRoutesDeps } from "./crm-routes.js";
import { createHrRoutes, type HrRoutesDeps } from "./hr-routes.js";
import { createProjectsRoutes, type ProjectsRoutesDeps } from "./projects-routes.js";
import { createContractingGuaranteesRoutes, type ContractingGuaranteesRoutesDeps } from "./contracting-guarantees-routes.js";
import {
  createContractingContractsRoutes,
  createVariationOrdersRoutes,
  type ContractingContractsRoutesDeps,
} from "./contracting-contracts-routes.js";
import { createContractingSiteRoutes, type ContractingSiteRoutesDeps } from "./contracting-site-routes.js";
import {
  createContractingCertificatesRoutes,
  type ContractingCertificatesRoutesDeps,
} from "./contracting-certificates-routes.js";
import {
  createContractingRecognitionRoutes,
  type ContractingRecognitionRoutesDeps,
} from "./contracting-recognition-routes.js";
import {
  createContractingReportsRoutes,
  createContractingRetentionRoutes,
  type ContractingControlsRoutesDeps,
} from "./contracting-controls-routes.js";
import {
  createContractingSubcontractsRoutes,
  createSubcontractCertificatesRoutes,
  type ContractingSubcontractsRoutesDeps,
} from "./contracting-subcontracts-routes.js";
import { createFixedAssetsRoutes, type FixedAssetsRoutesDeps } from "./fixed-assets-routes.js";
import { createFieldSalesRoutes, createVansRoutes, type FieldSalesRoutesDeps } from "./field-sales-routes.js";
import {
  createStockAdjustmentsRoutes,
  createStockTransfersRoutes,
  createPhysicalCountsRoutes,
} from "./stock-documents-routes.js";
import {
  createInventoryWritedownRoutes,
  type InventoryWritedownRoutesDeps,
} from "./inventory-writedown-routes.js";
import {
  createProductTemplatesRoutes,
  type ProductTemplatesRoutesDeps,
} from "./product-templates-routes.js";
import { createWorkflowRoutes, type HeldDocumentActions, type WorkflowRoutesDeps } from "./workflow-routes.js";
import { createFinancialReportsRoutes, type FinancialReportsRoutesDeps } from "./financial-reports-routes.js";
import { createLabelLayoutsRouter } from "./label-routes.js";
import { createSequencesRoutes, type SequencesRoutesDeps } from "./sequences-routes.js";
import { createAuditRoutes } from "./audit-routes.js";
import { AUDITED_MOUNTS, MutatingMethod, auditBoundary, beforeTheTurn, connectionTurn, type BoundaryPreparation } from "./audit-boundary.js";
import { createPrecomputingHasher, type PrecomputingHasher } from "./precomputed-secrets.js";
import { requestBodyLimit } from "./body-limit.js";
import { IDEMPOTENT_CREATES, idempotentCreate, type IdempotentRequests } from "./idempotent-create.js";
import { createSecurityReportsRoutes } from "./security-reports-routes.js";
import { isProductionRuntime, permissionRefusalReporting, type PermissionRefusalReporter } from "./permission-gate.js";
import { createBarcodeConfigRoutes } from "./barcode-config-routes.js";
import { createProfileRoutes } from "./profile-routes.js";

function defaultEntitlementsResolver(): EntitlementsResolver {
  const entitlements: Entitlements = createEntitlements({
    plan: "ENTERPRISE",
    activeModules: MODULE_CATALOG,
    features: {},
    seats: 10,
    expiresAt: null,
  });
  return () => entitlements;
}

/**
 * تحصيل قسط — turns an instalment collection into a real confirmed customer
 * collection voucher allocated to the plan line's source invoice, exactly as
 * the sales invoice `collect` port does. Without it an instalment's
 * `paidAmount` could only ever move with nothing posted behind it (D1's shape).
 */
export type InstallmentCollectPort = (input: {
  invoiceId: string;
  customerId: string;
  branchId: string;
  amount: Money;
  treasuryAccountId: string;
  paymentMethod: "cash" | "bank" | "cheque" | "card" | "wallet";
  date: string;
  referenceNo?: string | null;
  memo?: string | null;
  actor?: string;
}) => Promise<{ voucherId: string }>;

export interface CreateAppOptions {
  // EXTERNAL CONTRACT: the body of `GET /health`, which main/lan-client.ts reads
  // at startup to detect host/client version skew.
  readonly health?: () => Readonly<Record<string, unknown>>;
  /**
   * Mounts `/lan/*` (docs/archive/plan.md §2.6/§6.3.3) on this same app instance when
   * present. Desktop passes this so the SAME app answers both over IPC
   * (host-local) and a LAN socket (till/tablet clients) — omit it and the app
   * behaves exactly as before (no `/lan` routes at all), which is what
   * apps/server and every existing caller/test still gets by default.
   */
  readonly lan?: {
    readonly resolveEntitlements: EntitlementsResolver;
    /** Pass a shared instance to persist seat state across app.fetch() calls; defaults to a fresh, empty registry. */
    readonly registry?: SeatSessionRegistry;
    readonly sseHeartbeatMs?: number;
    /**
     * The auth session registry, so disconnecting a till actually EVICTS it.
     *
     * Without this the admin action moved a number and nothing else: the
     * device kept working and its bearer token stayed valid, so "disconnect"
     * was cosmetic against exactly the rogue or hung device it exists for.
     */
    readonly sessions?: SessionRegistry;
  };
  /**
   * Mounts `/accounts/*` (docs/archive/catalog/04 "دليل الحسابات") when present. The
   * Chart of Accounts isn't part of the journal-posting `UnitOfWork` yet, so
   * its repository is injected separately — omit it and the app behaves
   * exactly as before (no `/accounts` routes), same as any existing caller.
   */
  readonly accounts?: {
    readonly repo: AccountRepository;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /**
   * Mounts `/items` (docs/archive/catalog/03 "الأصناف") when present. Items aren't
   * part of the journal-posting `UnitOfWork` yet, so its repository is
   * injected separately — omit it and the app behaves exactly as before (no
   * `/items` routes), same as any existing caller.
   */
  readonly items?: {
    readonly repo: ItemRepository;
    readonly resolveAuthContext?: AuthContextResolver;
    /** Supplies the item detail's real on-hand position; omit and it reports none. */
    readonly snapshots?: WacSnapshotRepository;
  };
  /**
   * Mounts `/item-units` and `/item-categories` (docs/archive/catalog/03 §"وحدة
   * القياس" / §"تصنيفات الأصناف") when present — the item master-data
   * catalogs an item's `baseUnitCode` / `categoryId` resolve against.
   */
  /** توجيه الحسابات (R6.1) — mounts `/accounting/account-routing` when present. */
  readonly accountRouting?: {
    readonly repo: AccountRoutingRepository;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  readonly itemCatalog?: {
    readonly units: ItemUnitRepository;
    readonly categories: ItemCategoryRepository;
    /** العلامات التجارية والمواسم (R5.10) — omit and neither route mounts. */
    readonly brands?: ItemBrandRepository;
    readonly seasons?: ItemSeasonRepository;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /**
   * Mounts `/item-specifications` (المواصفات — the reusable specification /
   * attribute registry) when present. `usage` counts what binds to a
   * specification; it drives the الاستخدام column and the delete guard, and is
   * supplied by the composition root because only it knows the consumers.
   */
  readonly itemSpecifications?: {
    readonly repo: ItemSpecificationRepository;
    readonly usage: ItemSpecificationUsageCounter;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /** Mounts `/sequences` (docs/archive/catalog/09 §"تسلسلات الترقيم") when present. */
  readonly sequences?: SequencesRoutesDeps & { readonly resolveAuthContext?: AuthContextResolver };
  /** Mounts `/barcode-config` when present. */
  readonly barcodeConfigStore?: BarcodeConfigRepository;
  /** Shared audit sink for profile security events. */
  readonly auditSink?: AuditSink;
  /**
   * The live session registry and the login throttle, so administrative acts
   * can reach them.
   *
   * Both are owned by `createBackend` (it is the composition that mounts
   * `/auth`), and both have to be the SAME instances those routes use:
   * revoking a deactivated user's sessions against a different registry
   * revokes nothing, and clearing a lockout on a second throttle leaves the
   * account locked.
   */
  readonly security?: {
    readonly sessions?: SessionRegistry;
    readonly loginThrottle?: LoginThrottle;
  };
  /**
   * Called when a gated route refuses a caller. Omit and refusals go
   * unrecorded, which is what every app did before: a 403 wrote nothing, so
   * probing left no trace at all.
   */
  readonly onPermissionRefused?: PermissionRefusalReporter;
  /** Mounts `/audit` — the read-only audit query surface — when present. */
  readonly audit?: { readonly store: AuditQueryPort; readonly resolveAuthContext?: AuthContextResolver };
  /** Mounts `/label-layouts` when present — the sticker-sheet geometries the label screen renders. */
  readonly labelLayouts?: {
    readonly repo: LabelLayoutRepository;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /** Mounts `/financial-reports` (the 7 statements over the live posted ledger) when present. */
  readonly financialReports?: FinancialReportsRoutesDeps;
  /** Mounts `/settings` (docs/archive/catalog/09) when present — omit it for no `/settings` route. */
  readonly settingsStore?: SettingsRepository;
  /** Mounts `/branches` (docs/archive/catalog/09) when present — omit it for no `/branches` route. */
  readonly branchStore?: BranchRepository;
  /** Mounts `/warehouses` (docs/archive/catalog/09) when present — omit it for no `/warehouses` route. */
  readonly warehouseStore?: WarehouseRepository;
  /** Mounts `/customers` (docs/archive/catalog/01 "العملاء") when present — omit it for no `/customers` route. */
  readonly customerStore?: CustomerRepository;
  /** Mounts `/suppliers` (docs/archive/catalog/02 "الموردون") when present — omit it for no `/suppliers` route. */
  readonly supplierStore?: SupplierRepository;
  /**
   * Posts a customer's رصيد افتتاحي into the ledger (B-2). Omit it and the
   * field is stored master data that no report counts — which is what put the
   * customer KPI above the aging ladder by Σ opening balances.
   */
  readonly customerOpeningBalances?: PartyOpeningBalancePoster;
  /** The supplier-side twin of {@link customerOpeningBalances} (B-2). */
  readonly supplierOpeningBalances?: PartyOpeningBalancePoster;
  /** مجموعات الضرائب (R6.4) — mounts `/tax-groups` when present. */
  readonly taxGroupRepo?: TaxGroupRepository;
  /** Mounts `/tax-rates` (docs/archive/catalog/04 "الضرائب") when present — omit it for no `/tax-rates` route. */
  readonly taxRateRepo?: TaxRateRepository;
  /** Mounts `/cost-centers` (docs/archive/catalog/04 "مراكز التكلفة") when present — omit it for no `/cost-centers` route. */
  readonly costCenterRepo?: CostCenterRepository;
  /** Mounts `/treasury-accounts` (docs/archive/catalog/04 "حسابات الخزينة") when present — omit it for no `/treasury-accounts` route. */
  readonly treasuryAccountRepo?: TreasuryAccountRepository;
  /** Mounts `/fiscal-periods` (docs/archive/catalog/04 "الفترات المالية") when present — omit it for no `/fiscal-periods` route. */
  readonly fiscalPeriodRepo?: FiscalPeriodRepository;
  /**
   * Mounts `/inventory` (docs/archive/catalog/03 — the costing + stock-ledger engine)
   * when present. The caller builds the `StockLedgerService` (wiring the SQLite
   * store, the negative-stock policy, and any event/GL adapters) — omit it and
   * the app behaves exactly as before (no `/inventory` routes).
   */
  readonly inventory?: {
    readonly service: StockLedgerService;
    readonly resolveAuthContext?: AuthContextResolver;
    /** Open documents holding stock they have not yet moved (R5.6). */
    readonly reservations?: StockReservationSource;
  };
  /**
   * Mounts `/inventory/stock-adjustments` (docs/archive/catalog/03 §"تسويات المخزون")
   * — the document-layer draft/confirm CRUD built on `stockAdjustmentDocumentType`
   * — when present. Omit it for no such route (the raw `/inventory/adjustments`
   * engine endpoint above is unaffected either way).
   */
  readonly stockAdjustments?: {
    readonly service: DocumentService<StockAdjustmentDocLine>;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /** Mounts `/inventory/stock-transfers` (docs/archive/catalog/03 §"تحويلات المخزون") when present. */
  readonly stockTransfers?: {
    readonly service: DocumentService<StockTransferDocLine>;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /** Mounts `/inventory/physical-counts` (docs/archive/catalog/03 §"الجرد الفعلي") when present. */
  readonly physicalCounts?: {
    readonly service: PhysicalCountService;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /**
   * Mounts `/inventory/writedown-runs` (docs/archive/phase-backlog.md Phase 4 "aging-based
   * inventory write-down batch") when present: a manually-triggered,
   * per-period-idempotent monthly provisioning job that posts Dr write-down
   * expense / Cr the 1190-style contra-asset provision for slow-moving
   * stock, through the REAL GL posting engine. Never touches an item's
   * recorded WAC/cost layers.
   */
  readonly inventoryWritedown?: InventoryWritedownRoutesDeps;
  /**
   * Mounts `/inventory/product-templates` (docs/archive/catalog/03-inventory.md
   * §"قوالب المنتجات") when present: attribute-driven templates + the
   * variant/SKU generator (creates REAL Items).
   */
  readonly productTemplates?: ProductTemplatesRoutesDeps;
  /**
   * Mounts the GL posting engine under `/gl` (docs/archive/catalog/04 §القيود المحاسبية)
   * when present — omit it for no `/gl` routes. Bundles its own ledger,
   * account/period lookups and numbering engine (all connection-shared for
   * atomic no-gap numbering); optional audit sink + domain-event publisher.
   */
  readonly gl?: GlRoutesDeps;

  /**
   * Sales invoices (docs/archive/catalog/01). Mounted under `/sales-invoices` when
   * supplied. When `creditControl` isn't already set on these deps AND both
   * `settingsStore` and `customerStore` are also supplied, `createApp` wires
   * a REAL credit-control check automatically (tenant settings' الرقابة
   * الائتمانية + the customer's own الحد الائتماني + their live-invoice
   * exposure via `createSalesInvoiceCustomerExposureHook`) — omit either
   * store to get exactly today's behaviour (no credit check at all).
   */
  readonly salesInvoices?: SalesInvoiceRoutesDeps;
  /**
   * Mounts the historical sales-document import (docs/archive/catalog/01 §"استيراد
   * فواتير سابقة" / §"استيراد مرتجعات سابقة") under `/sales/historical-import`
   * when present — omit it for no such routes. `gl`/`accounts` are optional:
   * omit them to archive documents without ever posting a remaining-balance
   * journal entry.
   */
  readonly salesHistoricalImport?: {
    readonly archives: HistoricalSalesArchiveRepository;
    readonly gl?: HistoricalSalesImportGlPostingPort;
    readonly accounts?: HistoricalSalesImportGlAccounts;
    readonly resolveAuthContext?: AuthContextResolver;
    readonly now?: () => string;
  };
  /** Mounts `/price-lists` (docs/archive/catalog/01 "قوائم الأسعار") when present. */
  readonly priceListRepo?: PriceListRepository;
  /** Mounts `/promotions` (docs/archive/catalog/01 "العروض") when present. */
  readonly promotionRepo?: PromotionRepository;
  /** Mounts `/notification-rules` (docs/archive/catalog/09 §قواعد الإشعارات) when present. */
  readonly notificationRuleRepo?: NotificationRuleRepository;
  /**
   * The event codes this deployment really publishes onto the event bus —
   * what `/notification-rules/triggers` reports as `emitted`. The composition
   * root derives it from its own bridge wiring; omit it and every trigger is
   * honestly reported as not-yet-emitted.
   */
  readonly emittedEventCodes?: readonly EventCode[];
  /** Mounts `/notifications` (the top-bar bell panel's own data) when present. */
  readonly notificationRepo?: NotificationRepository;
  /** Drains the outbound notification queue; omitted, `POST /notifications/drain` answers 503. */
  readonly notificationDrain?: () => Promise<{
    attempted: number;
    sent: number;
    stillQueued: number;
    failed: number;
    skipped: number;
  }>;
  /**
   * Mounts `/sales-quotes` (docs/archive/catalog/01 "عروض الأسعار") when present. Its
   * `invoice` bridge (for "إنشاء من عرض سعر") is auto-filled from
   * `salesInvoices`'s repo/numbering/gl/stock when both are supplied and the
   * caller didn't already set `invoice` themselves.
   */
  readonly salesQuotes?: SalesQuoteRoutesDeps;
  /** Mounts `/exchange-rates` (docs/archive/catalog/04 "أسعار الصرف") when present. */
  readonly exchangeRateRepo?: ExchangeRateRepository;
  /** Mounts `/cost-center-pl` (docs/archive/catalog/04 "أرباح مراكز التكلفة") when present. */
  readonly costCenterPl?: CostCenterPnLRoutesDeps;
  /** Mounts `/revaluation` (docs/archive/catalog/04 "إعادة تقييم العملات الأجنبية") when present. */
  readonly fxRevaluation?: FxRevaluationRoutesDeps;
  /** Mounts `/reconciliation` (docs/archive/catalog/04 "مطابقة الأرصدة") when present. */
  readonly reconciliation?: ReconciliationRoutesDeps;
  /** Mounts `/gl/opening-balance-duplicates` (D241's exceptions report + repair action) when present. */
  readonly openingBalanceDuplicates?: OpeningBalanceDuplicatesRoutesDeps;
  /** Mounts `/eta` (docs/archive/catalog/04 "الفاتورة الإلكترونية") when present. */
  readonly eta?: EtaRoutesDeps;
  /**
   * Mounts the Treasury Vouchers routes (docs/archive/catalog/04 §"السندات النقدية") —
   * `/vouchers/*` plus the root `/allocations/:id/reverse` and `/open-invoices`
   * — when present. Bundles the voucher/allocation/invoice repositories with the
   * GL posting engine, numbering, treasury-account lookup and settings the
   * `VoucherService` composes. Omit it and the app behaves exactly as before.
   */
  readonly vouchers?: VoucherRoutesDeps;
  /**
   * Mounts the Cheque Register routes (docs/archive/catalog/04 §"سجل الشيكات") under
   * `/cheques` when present. Bundles the cheque repository with the GL
   * posting engine deps the `ChequeService` composes (see cheques-routes.ts).
   */
  readonly cheques?: ChequeRoutesDeps;
  /**
   * Mounts the Bank Statement Reconciliation routes (docs/archive/catalog/04
   * §"تسوية كشوف البنك") under `/bank-statements` when present. Bundles the
   * statement/column-mapping repositories with a `TreasuryLedgerReader`
   * (bind `createTreasuryLedgerReader` from `@mezan/domain` over the real
   * ledger + treasury-account repos).
   */
  readonly bankReconciliation?: BankReconciliationRoutesDeps;
  /**
   * Mounts CRM (docs/archive/catalog/06 "إدارة علاقات العملاء") under `/crm` when
   * present: leads, opportunities, pipeline stages, activities.
   */
  readonly crm?: CrmRoutesDeps;
  /**
   * Mounts HR master data (docs/archive/catalog/06 "الموارد البشرية") under `/hr`
   * when present: departments, job titles, employees, contracts, holidays,
   * the HR dashboard, and the leave-request slice backing إجازاتي (My Leave).
   */
  readonly hr?: HrRoutesDeps;
  /**
   * Mounts Projects (docs/archive/catalog/07 "المشاريع والمقاولات") under `/projects`
   * when present. Creating a project auto-creates its linked `PRJ-{code}`
   * cost center via the real cost-centers domain.
   */
  readonly projects?: ProjectsRoutesDeps;
  /**
   * Mounts العقود وجداول الكميات وأوامر التغيير — slice 1 of المقاولات
   * (docs/artifacts/mezan-contracting-designs.html §03) — under
   * `/contracting/contracts` and `/contracting/variation-orders`.
   */
  readonly contractingContracts?: ContractingContractsRoutesDeps;
  /**
   * Mounts المستخلصات — slice 2 of المقاولات
   * (docs/artifacts/mezan-contracting-designs.html §04, D-02/D-03/D-09) —
   * under `/contracting/certificates`: the cumulative certificate, its two
   * approvals, the invoice generated on clearance and مستخلص تنفيذي.
   */
  readonly contractingCertificates?: ContractingCertificatesRoutesDeps;
  /**
   * Mounts مستودعات المواقع والصرف والاستهلاك والعهدة وتشغيل المعدات — slice 4A
   * of المقاولات (D-11) — under `/contracting/site`.
   */
  readonly contractingSite?: ContractingSiteRoutesDeps;
  /**
   * Mounts خطابات الضمان — slice 5A of المقاولات
   * (docs/artifacts/mezan-contracting-designs.html §05) — under
   * `/contracting/guarantees`: the register, its bank-facility summary, and
   * the memorandum + restricted-cash postings behind every status move.
   */
  readonly contractingGuarantees?: ContractingGuaranteesRoutesDeps;
  /**
   * Mounts تشغيل الاعتراف بالإيراد — slice 4B of المقاولات
   * (docs/artifacts/mezan-contracting-designs.html D-03, D-12) — under
   * `/contracting/recognition`: the cost-to-complete workspace, the monthly
   * EAS 48 run and its reversal.
   */
  readonly contractingRecognition?: ContractingRecognitionRoutesDeps;
  /**
   * Mounts تقارير الاستثناءات الستة والإفراج عن المحتجزات وتقويمها — slice 5B
   * of المقاولات (docs/artifacts/mezan-contracting-designs.html §06) — under
   * `/contracting/reports` and `/contracting/retention`.
   */
  readonly contractingControls?: ContractingControlsRoutesDeps;
  /**
   * Mounts عقود الباطن ومستخلصات مقاولي الباطن — slice 3 of المقاولات
   * (docs/artifacts/mezan-contracting-designs.html §03 "THE MIRROR", D-04,
   * D-05) — under `/contracting/subcontracts` and
   * `/contracting/subcontract-certificates`.
   */
  readonly contractingSubcontracts?: ContractingSubcontractsRoutesDeps;
  /**
   * Mounts Fixed Assets (docs/archive/catalog/07 "الأصول الثابتة") under `/assets`
   * when present: asset categories, the asset register, and depreciation
   * runs (posting a REAL balanced GL entry through the GL posting engine).
   */
  readonly fixedAssets?: FixedAssetsRoutesDeps;
  /**
   * Mounts Field/Van Sales (docs/archive/catalog/07 "رحلات المندوبين") under
   * `/field/van-trips` when present: open (crew, van warehouse, opening cash
   * float, stock load) through settle (cash + stock variance).
   */
  readonly fieldSales?: FieldSalesRoutesDeps;
  /**
   * Mounts the purchase chain under `/purchases` (docs/archive/catalog/02): أوامر الشراء
   * → استلام البضائع → فواتير المشتريات. The caller supplies the three document
   * repositories, the numbering engine, the costing/stock-ledger service (for
   * stock IN on receipt/manual-invoice confirmation) and the GL posting deps
   * (for the invoice's inventory + payable + tax journal entry). Omit it and the
   * app behaves exactly as before (no `/purchases` routes).
   */
  readonly purchases?: {
    /** Refuses a line naming an item the catalogue does not hold (D38's twin). */
    readonly itemCheck?: ItemCatalogCheck;
    /** Refuses a document naming a supplier, branch or warehouse no master record holds (D310). */
    readonly masterData?: PurchasesRoutesDeps["masterData"];
    readonly orders: PurchaseOrderRepository;
    readonly receipts: GoodsReceiptRepository;
    readonly invoices: PurchaseInvoiceRepository;
    /** N-9 — optimistic concurrency for orders and invoices; omit for the previous last-write-wins behaviour. */
    readonly orderVersions?: NonNullable<PurchasesRoutesDeps["orderVersions"]>;
    readonly invoiceVersions?: NonNullable<PurchasesRoutesDeps["invoiceVersions"]>;
    readonly numbering: NextNumberService;
    readonly stock: StockLedgerService;
    /** GL posting engine deps — the invoice confirm builds a JE and posts it here. */
    readonly gl: JournalPostingDeps;
    readonly accounts: PurchaseGlAccounts;
    readonly allocatable?: AllocatableInvoiceRepository;
    /** Exchange rates, so a foreign-currency invoice posts at the rate of its own date (D24). */
    readonly exchangeRates?: {
      findRate(currency: string, asOfDate: string): Promise<{ rate: string } | null>;
      /** Full rate table, so the ALLOW_MISSING fx policy can reach an out-of-date rate. */
      list?(): Promise<readonly { currency: string; rate: string; effectiveDate: string; status: string }[]>;
    };
    /** The tenant's own currency; anything else on a document needs a rate. */
    readonly baseCurrency?: string;
    /**
     * A static policy value. Omit it (and supply `settingsStore`) to instead
     * derive the 3-gate procurement strictness policy from the LIVE tenant
     * settings on every request (docs/archive/catalog/09 §"التحكم في المشتريات") — no
     * server restart needed to see a toggle take effect.
     */
    readonly policy?: PurchasePolicy;
    /**
     * Cost-layer lookups for the "sold-item" cancellation guard + the two
     * cancel endpoints (`POST /receipts/:id/cancel`, `POST /invoices/:id/cancel`).
     * Omit and those two endpoints are not mounted.
     */
    readonly layers?: CostLayerRepository;
    readonly resolveTaxRate?: (itemId: string) => number | Promise<number>;
    readonly autoBatchNo?: (input: { itemId: string; receiptNumber: string; lineIndex: number }) => Promise<string | null>;
    readonly currencyCheck?: CurrencyCheck;
    /** Backs `POST /purchases/invoices/:id/payments`; omit it and that route answers 503. */
    readonly pay?: NonNullable<PurchasesRoutesDeps["pay"]>;
    readonly settlementPreview?: PurchasesRoutesDeps["settlementPreview"];
    readonly resolveAuthContext?: AuthContextResolver;
    /** Audit sink for the chain's confirm/cancel records; falls back to `options.auditSink`. */
    readonly audit?: AuditSink;
    /** Publishes the chain's confirm/cancel events (DEC-5). Omit it and purchases stay silent. */
    readonly events?: DocumentEventPublisher;
    readonly now?: () => string;
  };
  /**
   * Mounts the manufacturing module under `/manufacturing` (docs/archive/catalog/07):
   * BOMs, work orders (4-stage), configurable products and custom manufacturing.
   * The caller supplies the four document repositories, the numbering engine,
   * the costing/stock-ledger service (raw OUT on issue, finished-goods IN on
   * receipt) and the GL posting deps (the work-order completion journal entry).
   * Omit it and the app behaves exactly as before (no `/manufacturing` routes).
   */
  readonly manufacturing?: {
    /** Refuses a configured order naming a customer no master record holds (D310). */
    readonly masterData?: ManufacturingRoutesDeps["masterData"];
    readonly boms: BomRepository;
    readonly workOrders: WorkOrderRepository;
    readonly configurableProducts: ConfigurableProductRepository;
    readonly configInstances: ConfigInstanceRepository;
    /** محطات العمل — the registry behind `/manufacturing/work-stations` (R9.1). */
    readonly workStations: WorkStationRepository;
    /** المشغّلون — the employee registry an operator id on a shop-floor action is resolved against. */
    readonly operators?: { findById(id: string): Promise<{ id: string; fullName: string } | null> };
    /** المستودعات — the registry a work order's raw / WIP / finished-goods ids are resolved against. */
    readonly warehouses?: ManufacturingRoutesDeps["warehouses"];
    readonly numbering: NextNumberService;
    readonly stock: StockLedgerService;
    /** On-hand per (item, warehouse) for the materials tab's available/shortage columns (R9.2). */
    readonly positions?: () => Promise<readonly { itemId: string; warehouseId: string; onHand: number }[]>;
    /** The movements / journal-entries / audit feeds behind the detail tabs (R9.2). */
    readonly movementsOfDocument?: ManufacturingRoutesDeps["movementsOfDocument"];
    readonly journalEntriesOfDocument?: ManufacturingRoutesDeps["journalEntriesOfDocument"];
    readonly auditOfDocument?: ManufacturingRoutesDeps["auditOfDocument"];
    /** GL posting engine deps — the work-order complete builds a JE and posts it here. */
    readonly gl: JournalPostingDeps;
    readonly accounts: WorkOrderGlAccounts;
    readonly resolveUnitCost?: (itemId: string) => Promise<Money>;
    readonly resolveAuthContext?: AuthContextResolver;
    readonly now?: () => string;
  };
  /**
   * Mounts طلبات عروض الأسعار (RFQs, docs/archive/catalog/02) under `/rfqs` when
   * present — omit it for no `/rfqs` routes. Reuses `options.purchases.orders`
   * + `.numbering` at wiring time so a converted RFQ becomes a real PO.
   */
  readonly rfq?: {
    readonly rfqs: PurchaseRfqRepository;
    readonly quotes: RfqQuoteRepository;
    readonly orders: PurchaseOrderRepository;
    readonly numbering: NextNumberService;
    readonly resolveAuthContext?: AuthContextResolver;
    readonly now?: () => string;
    readonly masterData?: MasterDataChecks;
  };
  /**
   * Mounts the historical purchase-document import (docs/archive/catalog/02 §"استيراد
   * فواتير سابقة") under `/purchases/historical-import` when present — omit it
   * for no such routes. `gl`/`accounts` are optional: omit them to archive
   * documents without ever posting a remaining-balance journal entry.
   */
  readonly historicalImport?: {
    readonly archives: HistoricalPurchaseArchiveRepository;
    readonly gl?: HistoricalImportGlPostingPort;
    readonly accounts?: HistoricalImportGlAccounts;
    readonly resolveAuthContext?: AuthContextResolver;
    readonly now?: () => string;
  };
  /**
   * Mounts the 9-tab print-template designer's persisted config (docs/archive/catalog/09
   * §"قوالب الطباعة") under `/print-template-config` when present — GET
   * returns the tenant's saved config or the shared default, PUT validates
   * and saves. Omit for no such routes.
   */
  readonly printTemplateConfig?: {
    readonly repo: PrintTemplateConfigRepository;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /**
   * Mounts the Data Migration wizard's 9 master-data steps (docs/archive/catalog/09
   * §"نقل البيانات", steps 1-9 — الأقسام through الأصول الثابتة) under
   * `/data-migration` when present. The 4 historical-document steps (10-13)
   * are NOT here — they reuse `/purchases/historical-import` and the sibling
   * `/sales/historical-import` mount directly. Omit for no such routes.
   */
  readonly dataMigration?: DataMigrationRoutesDeps;
  /**
   * Mounts `/sales-returns` (docs/archive/catalog/01 §"مرتجعات المبيعات") when
   * present. The caller builds the `DocumentService` (repo + numbering + GL
   * hook + `createInventoryStockHook` + workflow gate) — omit it for no
   * `/sales-returns` routes.
   */
  readonly salesReturns?: {
    readonly service: DocumentService<SalesReturnLine>;
    readonly resolveAuthContext?: AuthContextResolver;
    /** Lets the server derive the returnable quantity rather than trusting the client's. */
    readonly invoices?: SalesInvoiceLookupPort;
    /** Treasury seam behind «استرداد للعميل» — without it the refund route 503s instead of faking a state change (R3.9). */
    readonly refunds?: SalesReturnRefundPort;
  };
  /** Mounts `/purchase-returns` (docs/archive/catalog/02 §"مرتجعات المشتريات") when present — mirrors `salesReturns`. */
  readonly purchaseReturns?: {
    readonly service: DocumentService<PurchaseReturnLine>;
    readonly resolveAuthContext?: AuthContextResolver;
    /** Lets the server derive the returnable quantity rather than trusting the client's. */
    readonly invoices?: PurchaseInvoiceLookupPort;
  };
  /**
   * Mounts `/landed-costs` (docs/archive/catalog/02 §"التكاليف الإضافية") when
   * present. `documents` drives list/create/cancel; `service` (the same
   * document service wrapped by `LandedCostService`) drives confirm so the
   * cost-layer revaluation runs alongside the GL post.
   */
  readonly landedCosts?: {
    readonly documents: DocumentService<LandedCostLine>;
    readonly service: LandedCostService;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /** Mounts `/installments` (docs/archive/catalog/05 §"خطط الأقساط" + §"متابعة التحصيل") when present. */
  readonly installments?: InstallmentsRoutesDeps & {
    readonly resolveAuthContext?: AuthContextResolver;
    readonly collect?: InstallmentCollectPort;
  };
  /**
   * Mounts `/reports` (docs/archive/catalog/08 — operational reports) when present.
   * Independent of `options.inventory`/`options.purchases`/etc. — it takes
   * its own repository references directly (not the higher-level services
   * those blocks wrap) since reports only ever READ, never post GL/stock
   * effects. Omit it and the app behaves exactly as before (no `/reports`
   * routes).
   */
  readonly reports?: ReportsRoutesDeps;
  /**
   * Resolves the caller's AuthContext for the settings/branches/warehouses/
   * customers/suppliers routes. Defaults to `insecureHeaderAuthContextResolver` (see
   * permission-gate.ts), the same default `createAccountsRouter` uses — omit
   * it to get that header-driven spike behavior; a real deployment injects a
   * resolver derived from the JWT/session instead.
   */
  readonly resolveAuthContext?: AuthContextResolver;
  /**
   * Entitlements resolver the `/roles` route validates permission grants
   * against (docs/archive/catalog/09 §الأدوار — only licensed-module permissions are
   * grantable), and that `GET /entitlements` reports. Defaults to
   * `MODULE_CATALOG` until a real per-tenant source is wired up.
   */
  readonly resolveEntitlements?: EntitlementsResolver;
  /** Secret hasher for `/users` password/PIN storage. Defaults to `createScryptHasher()`. */
  readonly hasher?: ReturnType<typeof createScryptHasher>;
  /** That hasher already wrapped, when the composition shares it with routes it mounts itself. Wins over `hasher`. */
  readonly secrets?: PrecomputingHasher;
  /** Where a create's answer is kept, so the same create sent again is answered with it (idempotent-create.ts). */
  readonly idempotentRequests?: IdempotentRequests;
  /** Work other mounts do ahead of the connection's turn, keyed by path (audit-boundary.ts `beforeTheTurn`). */
  readonly beforeTheTurn?: Readonly<Record<string, BoundaryPreparation>>;
  /**
   * Mounts `/workflow` (docs/archive/catalog/09 §سير العمل — إعدادات الموافقات
   * chain-builder + الموافقات inbox) when present: `/workflow/configs` CRUD
   * over the persisted `GateConfig` per action type, `/workflow/requests` for
   * submitting/listing/deciding approval instances.
   */
  readonly workflow?: WorkflowRoutesDeps;
  /**
   * Mounts `/attachments` (المرفقات — R1.4) when present. Files attached to a
   * document or an entity; every route derives its permission from the entity
   * the file hangs off, so there is no attachment permission of its own.
   */
  readonly attachments?: { readonly repo: AttachmentRepository; readonly resolveAuthContext?: AuthContextResolver };
  /**
   * The license state every mutating request is gated against, and that
   * `GET /license/state` reports (docs/archive/plan.md §2.5). Supplied by
   * apps/desktop from the verified offline license. Omitted everywhere else,
   * where the app stays fully writable (`WRITABLE_LICENSE_STATE`).
   */
  readonly resolveLicenseState?: LicenseStateResolver;
}

/**
 * Derive the purchase chain's 3-gate strictness policy (docs/archive/catalog/09
 * §"التحكم في المشتريات") from the live tenant settings — the settings UI's
 * three toggles map 1:1 onto `PurchasePolicy`'s fields (aside from the
 * over-receipt guard, which isn't part of that settings tab).
 */
function mapSettingsToPurchasePolicy(settings: TenantSettings): PurchasePolicy {
  return {
    requirePoForGrn: settings.requirePoForGrn,
    requireReceiptForInvoice: settings.requireGrnForInvoice,
    blockOverReceipt: false,
    trackSoldPurchaseItems: settings.trackSoldPurchaseItems,
  };
}

type FxRateSource = NonNullable<NonNullable<CreateAppOptions["purchases"]>["exchangeRates"]>;

/**
 * Applies the tenant's سياسة عدم وجود سعر صرف (settings §"عام" →
 * `fxRateMissingPolicy`) to a rate lookup. STRICT keeps today's behaviour: no
 * approved rate on or before the document's date and the document is refused.
 * ALLOW_MISSING falls back to the nearest approved rate the tenant holds for
 * that currency — deliberately NOT to 1:1, which would post foreign figures
 * into the base ledger as though the currency did not exist.
 */
function fxRatesUnder(source: FxRateSource | undefined, settingsStore: SettingsRepository | undefined): FxRateSource | undefined {
  if (!source || !settingsStore || !source.list) return source;
  const list = source.list.bind(source);
  return {
    list,
    findRate: async (currency, asOfDate) => {
      const onDate = await source.findRate(currency, asOfDate);
      if (onDate) return onDate;
      const settings = (await settingsStore.get()) ?? createDefaultSettings();
      if (settings.fxRateMissingPolicy === "STRICT") return null;
      const usable = (await list())
        .filter((r) => r.currency === currency && (r.status === "approved" || r.status === "locked"))
        .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
      const nearest = usable.at(0);
      return nearest ? { rate: nearest.rate } : null;
    },
  };
}

/**
 * The ONE Hono app. A Hono app is a `(Request) => Promise<Response>` function,
 * so this exact instance is mounted two ways with no code difference:
 *   - over HTTP by apps/server (cloud shape), and
 *   - in-process via `app.fetch(new Request(...))` by apps/desktop-spike
 *     (Electron main-process shape).
 * Routes carry no business logic — they validate, call the domain, serialize.
 */
export function createApp(uow: UnitOfWork, options: CreateAppOptions = {}) {
  /**
   * One resolver for every route on this app.
   *
   * Each mount used to take its own optional resolver and fall back to
   * `insecureHeaderAuthContextResolver` when none was supplied — and none ever was, so
   * every route on every edition read the caller's permissions out of a header
   * the caller wrote. A composition that supplies `resolveAuthContext` now
   * governs the whole app; one that does not still gets the header resolver,
   * which is what the route-level unit tests rely on.
   */
  // The last remaining fallback in the codebase, and it now fails loudly rather
  // than quietly: `insecureHeaderAuthContextResolver` throws on a packaged or
  // production build, so a composition that forgets to pass a real resolver
  // cannot ship — it can only fail in dev, where someone will see it.
  const resolveAuth = options.resolveAuthContext ?? insecureHeaderAuthContextResolver;
  const resolveEntitlements = options.resolveEntitlements ?? defaultEntitlementsResolver();
  const secrets = options.secrets ?? createPrecomputingHasher(options.hasher ?? createScryptHasher());
  const hasher = secrets.hasher;

  // Saving a user hashes its password and PIN, and scrypt gives the event loop
  // away. Done here, ahead of the audit transaction, and only for a caller who
  // may make the write at all — an anonymous request must not buy a hash.
  async function hashUserSecretsBeforeTheTransaction(c: Context): Promise<(() => void) | void> {
    const permission = c.req.method === MutatingMethod.Post ? "admin.users.create" : "admin.users.edit";
    if (!can(await resolveAuth(c), permission)) return;
    const body: unknown = await c.req.json().catch(() => null);
    if (body === null || typeof body !== "object") return;
    const { password, pin } = body as { password?: unknown; pin?: unknown };
    const toHash = [password, pin].filter((secret): secret is string => typeof secret === "string" && secret !== "");
    if (toHash.length === 0) return;
    return secrets.precompute({ hash: toHash });
  }

  const app = new Hono();

  // AN APP WITH NO SINK RECORDS NOTHING, AND SAYS SO AT BOOT.
  //
  // `recordAdminEvent` returns early when the sink is absent, so that dev and
  // route-level tests can mount without one. The cost of that is a composition
  // which omits the sink and writes no trail at all, quietly and forever — the same failure shape as the header resolver
  // that defaulted to trusting the client. Dev and tests may mount without one;
  // a real build may not, and finds out at construction rather than during the
  // incident the trail was for.
  if (!options.auditSink && isProductionRuntime()) {
    throw new Error(
      "createApp was given no auditSink on a production/packaged build. " +
        "Administrative acts would be unrecorded.",
    );
  }

  // Ahead of the connection's turn on purpose: liveness must answer while the
  // database is busy, and it reads nothing from it.
  const health = options.health;
  if (health) app.get("/health", (c) => c.json(health()));

  app.use("*", requestBodyLimit(resolveAuth));

  const preparations: Readonly<Record<string, BoundaryPreparation>> = { "/users": hashUserSecretsBeforeTheTransaction };
  for (const [prefix, prepare] of Object.entries(preparations)) {
    const prepared = beforeTheTurn(prepare);
    app.use(prefix, prepared);
    app.use(`${prefix}/*`, prepared);
  }
  for (const [path, prepare] of Object.entries(options.beforeTheTurn ?? {})) app.use(path, beforeTheTurn(prepare));

  if (options.idempotentRequests) {
    const replayed = idempotentCreate({ requests: options.idempotentRequests, resolveAuthContext: resolveAuth, audit: options.auditSink });
    for (const path of IDEMPOTENT_CREATES) app.use(path, replayed);
  }

  // Before anything reads or writes: a mutating request holds this tenant's
  // connection for its whole length, and a read waits out an open transaction
  // (audit-boundary.ts).
  app.use("*", connectionTurn(options.auditSink));

  // Registered before every route: a mutating request under an audited mount
  // runs inside the sink's transaction, so the write and its audit event commit
  // or roll back together (audit-boundary.ts).
  for (const mount of AUDITED_MOUNTS) {
    const boundary = auditBoundary(options.auditSink, mount);
    app.use(mount.prefix, boundary);
    app.use(`${mount.prefix}/*`, boundary);
  }

  // The tenant's timezone, published to every handler below so a route can
  // narrow an instant on the wire to the tenant's own calendar day before the
  // command is built (tenant-day.ts). Registered before every route.
  app.use("*", tenantTimeZoneMiddleware(options.settingsStore));

  // Bound per app, not per process: two backends in one process must not share
  // — or silently steal — each other's forensic trail. Registered before every
  // route so a refusal anywhere below reaches it.
  if (options.onPermissionRefused) app.use("*", permissionRefusalReporting(options.onPermissionRefused));

  // Binds this request's entitlements so every permission gate below can
  // refuse an unlicensed module (permission-gate.ts) — the module gate was
  // exported and unit-tested but never wired to a route until this mount.
  app.use("*", entitlementsBinding(resolveEntitlements));
  // Must sit BELOW the entitlements binding: the over-limit sets are a function
  // of the limits that binding publishes.
  app.use("*", planLocationsBinding({ branches: options.branchStore, warehouses: options.warehouseStore }));

  // A session token presented from an address it was not issued to. The
  // REFUSAL happens in session-auth.ts regardless of this mount (the resolver
  // revokes and the gate answers 401); this is only the forensic row, and it
  // has to be registered before every route so a mismatch anywhere below is
  // seen — including on the ungated `/auth/*` and `/lan/*` paths, which are
  // exactly the ones a copied till token would arrive on.
  //
  // BEFORE the licence gate, deliberately. This one never refuses anything, and
  // a stolen token presented past a lapsed licence is still a stolen token: if
  // the write gate turned it away first, the theft would go unrecorded.
  if (options.security?.sessions && options.auditSink) {
    app.use("*", sessionOriginReporting(options.security.sessions, options.auditSink));
  }

  /**
   * License write-gate, before every route mounted below — the `/auth` and
   * `/dashboard` routes createBackend adds to this same instance included.
   * Inert (never registered) when no license source is wired, so cloud and
   * tests stay fully writable; only a desktop install past its grace window
   * resolves to READ_ONLY and starts refusing new postings.
   */
  const resolveLicenseState = options.resolveLicenseState;
  if (resolveLicenseState) {
    app.use("*", createWriteGate(resolveLicenseState));
  }
  app.get("/license/state", async (c) =>
    c.json(resolveLicenseState ? await resolveLicenseState(c) : WRITABLE_LICENSE_STATE),
  );

  /**
   * MODULE gating, before every route mounted below — the other half of the
   * licence, and the half that had no call site at all: `createModuleGate`
   * existed, was exported, and gated nothing, so a Core-priced licence served
   * manufacturing, HR and assets in full.
   *
   * It reads the SAME `resolveEntitlements` the `/roles` route and `GET
   * /entitlements` read, so a build cannot report one capability set and serve
   * another. Inert wherever no source is wired: the default resolver grants
   * every module (`DEFAULT_ACTIVE_MODULES`), so cloud, tests and an unpackaged
   * desktop are unchanged; only a desktop install running under a verified
   * licence narrows it.
   */
  applyModuleGates(app, resolveEntitlements);

  if (options.settingsStore) {
    app.route("/settings", createSettingsRoutes(options.settingsStore, resolveAuth, options.auditSink));
  }
  if (options.branchStore) {
    app.route("/branches", createBranchesRoutes(options.branchStore, resolveAuth));
  }
  if (options.warehouseStore) {
    app.route("/warehouses", createWarehousesRoutes(options.warehouseStore, resolveAuth));
  }
  /** The customer aging ladder's own row totals — never a second derivation beside it (D195). */
  const reportsDeps = options.reports;
  const customerReceivables: CustomerReceivablesSource | undefined = reportsDeps
    ? { outstandingByCustomer: (today) => customerAgingOwed(reportsDeps, today) }
    : undefined;

  /** The supplier aging ladder's own row totals, as the customer side does (D201). */
  const supplierPayables: SupplierPayablesSource | undefined = reportsDeps
    ? { outstandingBySupplier: (today) => supplierAgingOwed(reportsDeps, today) }
    : undefined;

  if (options.customerStore) {
    app.route(
      "/customers",
      createCustomersRouter(
        options.customerStore,
        resolveAuth,
        options.auditSink,
        options.priceListRepo,
        customerReceivables,
        // The SAME poster the suppliers screen and the start-up backfill use
        // (B-2, D241) — a second, screen-only posting path is exactly the bug
        // this defect was.
        options.customerOpeningBalances,
      ),
    );
  }
  if (options.supplierStore) {
    app.route(
      "/suppliers",
      createSuppliersRouter(options.supplierStore, resolveAuth, supplierPayables, options.auditSink, options.supplierOpeningBalances),
    );
  }

  if (options.accounts) {
    app.route(
      "/accounts",
      createAccountsRouter(options.accounts.repo, options.accounts.resolveAuthContext ?? resolveAuth, options.gl?.ledger, options.auditSink),
    );
  }
  if (options.taxRateRepo) {
    app.route("/tax-rates", createTaxRatesRoutes(options.taxRateRepo, resolveAuth, options.auditSink));
    if (options.taxGroupRepo) {
      app.route("/tax-groups", createTaxGroupsRoutes(options.taxGroupRepo, options.taxRateRepo, resolveAuth));
    }
  }
  if (options.costCenterRepo) {
    app.route(
      "/cost-centers",
      createCostCentersRoutes(options.costCenterRepo, resolveAuth, options.hr?.departments, options.auditSink),
    );
  }
  if (options.treasuryAccountRepo) {
    app.route(
      "/treasury-accounts",
      createTreasuryAccountsRoutes(options.treasuryAccountRepo, resolveAuth, options.gl?.ledger, options.auditSink),
    );
  }
  if (options.fiscalPeriodRepo) {
    app.route("/fiscal-periods", createFiscalPeriodsRoutes(options.fiscalPeriodRepo, resolveAuth, options.auditSink));
  }
  if (options.gl) {
    app.route("/gl", createGlRoutes(options.gl, resolveAuth));
  }
  if (options.openingBalanceDuplicates) {
    app.route("/gl/opening-balance-duplicates", createOpeningBalanceDuplicatesRoutes(options.openingBalanceDuplicates, resolveAuth));
  }
  if (options.vouchers) {
    app.route("/vouchers", createVouchersRoutes(options.vouchers, resolveAuth));
    app.route("/", createAllocationRoutes(options.vouchers, resolveAuth));
  }
  if (options.cheques) {
    app.route("/cheques", createChequesRoutes(options.cheques, resolveAuth));
  }
  if (options.bankReconciliation) {
    app.route("/bank-statements", createBankReconciliationRoutes(options.bankReconciliation, resolveAuth));
  }
  if (options.crm) {
    app.route("/crm", createCrmRoutes({ ...options.crm, audit: options.crm.audit ?? options.auditSink }, resolveAuth));
  }
  if (options.hr) {
    app.route(
      "/hr",
      createHrRoutes(
        {
          ...options.hr,
          attachments: options.hr.attachments ?? options.attachments?.repo,
          printTemplates: options.hr.printTemplates ?? options.printTemplateConfig?.repo,
          tenantSettings: options.hr.tenantSettings ?? options.settingsStore,
        },
        resolveAuth,
      ),
    );
  }
  if (options.projects) {
    app.route("/projects", createProjectsRoutes(options.projects, resolveAuth));
  }
  if (options.contractingContracts) {
    app.route("/contracting/contracts", createContractingContractsRoutes(options.contractingContracts, resolveAuth));
    app.route("/contracting/variation-orders", createVariationOrdersRoutes(options.contractingContracts, resolveAuth));
  }
  if (options.contractingCertificates) {
    app.route("/contracting/certificates", createContractingCertificatesRoutes(options.contractingCertificates, resolveAuth));
  }
  if (options.contractingSite) {
    app.route("/contracting/site", createContractingSiteRoutes(options.contractingSite, resolveAuth));
  }
  if (options.contractingGuarantees) {
    app.route("/contracting/guarantees", createContractingGuaranteesRoutes(options.contractingGuarantees, resolveAuth));
  }
  if (options.contractingRecognition) {
    app.route("/contracting/recognition", createContractingRecognitionRoutes(options.contractingRecognition, resolveAuth));
  }
  if (options.contractingControls) {
    app.route("/contracting/reports", createContractingReportsRoutes(options.contractingControls, resolveAuth));
    app.route("/contracting/retention", createContractingRetentionRoutes(options.contractingControls, resolveAuth));
  }
  if (options.contractingSubcontracts) {
    app.route("/contracting/subcontracts", createContractingSubcontractsRoutes(options.contractingSubcontracts, resolveAuth));
    app.route(
      "/contracting/subcontract-certificates",
      createSubcontractCertificatesRoutes(options.contractingSubcontracts, resolveAuth),
    );
  }
  if (options.fixedAssets) {
    app.route("/assets", createFixedAssetsRoutes(options.fixedAssets, resolveAuth));
  }
  if (options.fieldSales) {
    app.route("/field/van-trips", createFieldSalesRoutes(options.fieldSales, resolveAuth));
    // Mounted from the SAME deps, so a composition that supplies a registry
    // gets both the list the trip form picks from and the cascade the trip
    // route enforces — never one without the other.
    if (options.fieldSales.vans) {
      app.route("/field/vans", createVansRoutes(options.fieldSales.vans, resolveAuth, options.fieldSales.masterData));
    }
  }
  if (options.salesInvoices) {
    const salesInvoices = options.salesInvoices;
    // Auto-wire credit control (docs/archive/catalog/01/09 §"الرقابة الائتمانية") when
    // the caller supplied the tenant-settings + customer stores but didn't
    // already hand-wire `creditControl` themselves.
    const creditControl =
      salesInvoices.creditControl ??
      (options.settingsStore && options.customerStore
        ? {
            exposure: createSalesInvoiceCustomerExposureHook(salesInvoices.repo),
            getCreditLimit: async (customerId: string) => {
              const customer = await options.customerStore?.findById(customerId);
              return customer?.creditLimit ?? Money.zero();
            },
            getPolicy: async () => {
              const settings = await options.settingsStore?.get();
              return {
                enabled: settings?.creditControlEnabled ?? false,
                mode: settings?.creditControlMode ?? "WARNING",
              };
            },
          }
        : undefined);
    // Auto-wire promotion evaluation on confirm when the composition has a
    // promotion store but didn't hand-wire the hook itself — otherwise a
    // tenant with promotions configured would silently never apply one.
    const promotions =
      salesInvoices.promotions ??
      (options.promotionRepo
        ? createSalesInvoicePromotionHook(options.promotionRepo, {
            categoryOfItem: async (itemId: string) => (await options.items?.repo.findById(itemId))?.categoryId ?? null,
          })
        : undefined);
    app.route(
      "/sales-invoices",
      createSalesInvoicesRoutes(
        {
          ...salesInvoices,
          creditControl,
          promotions,
          // DEC-31 rule 6 — the monthly invoice quota, counted from the stored
          // rows of the tenant's own calendar month and re-counted inside the
          // write transaction. Auto-wired so a composition cannot mount the
          // create route with the limit quietly missing.
          quota:
            salesInvoices.quota ??
            createSalesInvoiceQuota(salesInvoices.repo, (fn) => uow.transaction(fn)),
          // `view_own` narrows on `salespersonId`, which holds an Employee id.
          // Without this port it would be compared against a user id and match
          // nothing, so a real rep would see no invoices at all (D147).
          users: salesInvoices.users ?? uow.users,
          returns: salesInvoices.returns ?? options.salesReturns?.service,
          // Auto-wire the tenant's VAT rules (§"الضريبة") the same way credit
          // control is: a draft is stamped with the mode in force when it was
          // raised, so changing the setting never restates a posted invoice.
          currencyCheck:
            salesInvoices.currencyCheck ??
            (options.settingsStore ? createCurrencyCheck(options.settingsStore) : undefined),
          // Without this a permitted foreign currency still posts at par: the
          // currency check only decides whether the code is allowed, never what
          // it is worth (D24).
          exchangeRates: salesInvoices.exchangeRates ?? options.exchangeRateRepo,
          taxPolicy:
            salesInvoices.taxPolicy ??
            (options.settingsStore
              ? async () => {
                  const settings = (await options.settingsStore!.get()) ?? createDefaultSettings();
                  return {
                    enabled: settings.taxEnabled,
                    defaultRatePercent: settings.defaultTaxRate,
                    inclusive: settings.taxCalculation === "INCLUSIVE",
                  };
                }
              : undefined),
          discountPolicy:
            salesInvoices.discountPolicy ??
            (options.settingsStore
              ? async () => {
                  const settings = (await options.settingsStore!.get()) ?? createDefaultSettings();
                  return { maxLineDiscountPercent: settings.maxLineDiscountPercent };
                }
              : undefined),
        },
        resolveAuth,
      ),
    );
  }
  if (options.salesHistoricalImport) {
    app.route(
      "/sales/historical-import",
      createSalesHistoricalImportRoutes(
        options.salesHistoricalImport,
        (options.salesHistoricalImport.resolveAuthContext ?? resolveAuth) ?? resolveAuth,
      ),
    );
  }
  if (options.priceListRepo) {
    app.route("/price-lists", createPriceListsRoutes(options.priceListRepo, resolveAuth, options.customerStore, options.auditSink, options.items?.repo));
  }
  if (options.promotionRepo) {
    app.route(
      "/promotions",
      createPromotionsRoutes(options.promotionRepo, resolveAuth, {
        salesInvoices: options.salesInvoices?.repo,
        salesReturns: options.salesReturns?.service,
      }, options.auditSink),
    );
  }
  if (options.notificationRuleRepo) {
    app.route(
      "/notification-rules",
      createNotificationRulesRoutes(options.notificationRuleRepo, resolveAuth, options.emittedEventCodes, options.auditSink),
    );
  }
  if (options.notificationRepo) {
    app.route(
      "/notifications",
      createNotificationsRoutes(options.notificationRepo, resolveAuth, { drain: options.notificationDrain }),
    );
  }
  if (options.salesQuotes) {
    const salesQuotes = options.salesQuotes;
    // Auto-wire "إنشاء من عرض سعر" (convert to invoice) from the salesInvoices
    // deps when both are supplied and the caller didn't already set it.
    const invoice =
      salesQuotes.invoice ??
      (options.salesInvoices
        ? {
            repo: options.salesInvoices.repo,
            numbering: options.salesInvoices.numbering,
            gl: options.salesInvoices.gl,
            stock: options.salesInvoices.stock,
            quota:
              options.salesInvoices.quota ??
              createSalesInvoiceQuota(options.salesInvoices.repo, (fn) => uow.transaction(fn)),
          }
        : undefined);
    app.route("/sales-quotes", createSalesQuotesRoutes({ ...salesQuotes, invoice }, resolveAuth));
  }
  if (options.salesReturns) {
    app.route(
      "/sales-returns",
      createSalesReturnsRoutes(
        options.salesReturns.service,
        (options.salesReturns.resolveAuthContext ?? resolveAuth),
        options.salesReturns.invoices,
        options.salesReturns.refunds,
      ),
    );
  }
  if (options.purchaseReturns) {
    app.route(
      "/purchase-returns",
      createPurchaseReturnsRoutes(options.purchaseReturns.service, (options.purchaseReturns.resolveAuthContext ?? resolveAuth), options.purchaseReturns.invoices),
    );
  }
  if (options.landedCosts) {
    app.route(
      "/landed-costs",
      createLandedCostsRoutes(options.landedCosts.documents, options.landedCosts.service, (options.landedCosts.resolveAuthContext ?? resolveAuth)),
    );
  }
  if (options.installments) {
    app.route("/installments", createInstallmentsRoutes(options.installments, (options.installments.resolveAuthContext ?? resolveAuth)));
  }
  if (options.exchangeRateRepo) {
    app.route("/exchange-rates", createExchangeRatesRoutes(options.exchangeRateRepo, resolveAuth, options.auditSink));
  }
  if (options.costCenterPl) {
    app.route("/cost-center-pl", createCostCenterPnLRoutes(options.costCenterPl, resolveAuth));
  }
  if (options.fxRevaluation) {
    app.route("/revaluation", createFxRevaluationRoutes(options.fxRevaluation, resolveAuth));
  }
  if (options.reconciliation) {
    app.route("/reconciliation", createReconciliationRoutes(options.reconciliation, resolveAuth));
  }
  if (options.eta) {
    app.route("/eta", createEtaRoutes(options.eta, resolveAuth, options.auditSink));
  }
  // Generic document framework (docs/archive/plan.md §3): read-only type
  // registry + pure effects computation. No persistence, so always mounted.
  app.route("/documents", createDocumentsRoutes(resolveAuth));

  if (options.items) {
    app.route(
      "/items",
      createItemsRouter(options.items.repo, (options.items.resolveAuthContext ?? resolveAuth), options.items.snapshots, options.settingsStore, options.auditSink),
    );
  }
  if (options.accountRouting) {
    app.route(
      "/accounting/account-routing",
      createAccountRoutingRoutes(options.accountRouting.repo, (options.accountRouting.resolveAuthContext ?? resolveAuth)),
    );
  }
  if (options.itemCatalog) {
    app.route("/item-units", createItemUnitsRoutes(options.itemCatalog.units, (options.itemCatalog.resolveAuthContext ?? resolveAuth)));
    app.route(
      "/item-categories",
      createItemCategoriesRoutes(options.itemCatalog.categories, (options.itemCatalog.resolveAuthContext ?? resolveAuth)),
    );
    if (options.itemCatalog.brands) {
      app.route("/item-brands", createItemBrandsRoutes(options.itemCatalog.brands, options.itemCatalog.resolveAuthContext ?? resolveAuth, options.auditSink));
    }
    if (options.itemCatalog.seasons) {
      app.route("/item-seasons", createItemSeasonsRoutes(options.itemCatalog.seasons, options.itemCatalog.resolveAuthContext ?? resolveAuth, options.auditSink));
    }
  }
  if (options.itemSpecifications) {
    app.route(
      "/item-specifications",
      createItemSpecificationsRoutes(options.itemSpecifications, (options.itemSpecifications.resolveAuthContext ?? resolveAuth) ?? resolveAuth),
    );
  }
  if (options.barcodeConfigStore) {
    app.route("/barcode-config", createBarcodeConfigRoutes({ store: options.barcodeConfigStore }, resolveAuth));
  }
  if (options.sequences) {
    app.route("/sequences", createSequencesRoutes(options.sequences, (options.sequences.resolveAuthContext ?? resolveAuth)));
  }
  if (options.audit) {
    const auditAuth = options.audit.resolveAuthContext ?? resolveAuth;
    app.route("/audit", createAuditRoutes(options.audit.store, auditAuth));
    // تقارير الرقابة والأمان — the exception reports over the SAME trail
    // `/audit` serves raw. Wired off the same option deliberately: an install
    // that records a forensic trail and reports nothing on it is the gap these
    // exist to close, so the two must not be mountable apart.
    app.route(
      "/security-reports",
      createSecurityReportsRoutes(
        { audit: options.audit.store, users: uow.users, roles: uow.roles, settings: options.settingsStore },
        auditAuth,
      ),
    );
  }
  if (options.labelLayouts) {
    app.route("/label-layouts", createLabelLayoutsRouter(options.labelLayouts.repo, (options.labelLayouts.resolveAuthContext ?? resolveAuth)));
  }
  if (options.inventory) {
    app.route(
      "/inventory",
      createInventoryRoutes(
        options.inventory.service,
        (options.inventory.resolveAuthContext ?? resolveAuth),
        options.inventory.reservations,
        options.accountRouting?.repo,
        options.settingsStore,
      ),
    );
  }
  // Mounted BEFORE `/purchases` (below): Hono matches registration order for
  // overlapping wildcard mounts, and `/purchases` mounts a full sub-app at
  // `/purchases/*` that would otherwise shadow this more specific path.
  if (options.historicalImport) {
    app.route(
      "/purchases/historical-import",
      createHistoricalImportRoutes(
        options.historicalImport,
        (options.historicalImport.resolveAuthContext ?? resolveAuth) ?? resolveAuth,
      ),
    );
  }
  if (options.purchases) {
    const purchases = options.purchases;
    // Adapter: turn the chain's balanced posting into a system journal entry,
    // posted through the GL engine (which allocates the JE number atomically) —
    // and its mirror-image reversal for cancelling a confirmed invoice, keyed
    // by the SAME deterministic id the posting adapter used.
    const glPort: PurchaseGlPostingPort = {
      post: async (posting: PurchaseGlPosting) => {
        await postJournalEntry(
          {
            id: `PI-JE:${posting.sourceDocId}`,
            date: posting.date,
            memo: posting.memo,
            source: "system",
            sourceDocType: posting.sourceDocType,
            sourceDocId: posting.sourceDocId,
            sourceDocNumber: posting.sourceDocNumber ?? null,
            lines: posting.lines.map((l) => ({
              accountId: l.accountId,
              debit: l.debit,
              credit: l.credit,
              // Carried through, or the FX revaluation engine can never find
              // the foreign balance this entry created (D24), and the VAT
              // return can never report the rate this line was charged at (D28).
              currency: l.currency ?? null,
              fxRate: l.fxRate ?? null,
              taxRatePercent: l.taxRatePercent ?? null,
              projectId: l.projectId ?? null,
              costCategory: l.costCategory ?? null,
              branchId: l.branchId ?? null,
            })),
          },
          purchases.gl,
        );
      },
      // The confirm's atomic boundary (B-7): GL entry, stock receipt, invoice
      // status and the payables sub-ledger commit together or not at all.
      transaction: (fn) => purchases.gl.ledger.transaction(fn),
    };
    const glReversePort: PurchaseGlReversalPort = {
      reverse: async (sourceDocId, opts) => {
        await reverseJournalEntry(`PI-JE:${sourceDocId}`, purchases.gl, {
          reversalId: opts.reversalId,
          date: opts.date,
          memo: opts.memo,
        });
      },
    };
    // Derive the 3-gate procurement strictness policy from the LIVE tenant
    // settings when a settings store is mounted (no restart to apply a
    // toggle) — falls back to a static value/DEFAULT_PURCHASE_POLICY otherwise.
    const policy: PurchasePolicy | (() => Promise<PurchasePolicy> | PurchasePolicy) =
      purchases.policy ??
      (options.settingsStore
        ? async () => mapSettingsToPurchasePolicy((await options.settingsStore!.get()) ?? createDefaultSettings())
        : undefined) ??
      (() => mapSettingsToPurchasePolicy(createDefaultSettings()));

    app.route(
      "/purchases",
      createPurchasesRoutes(
        {
          itemCheck: purchases.itemCheck,
          masterData: purchases.masterData,
          orders: purchases.orders,
          receipts: purchases.receipts,
          invoices: purchases.invoices,
          // N-9: declared on the option but never forwarded, so the whole
          // optimistic-concurrency guard was dead through `createApp`.
          orderVersions: purchases.orderVersions,
          invoiceVersions: purchases.invoiceVersions,
          numbering: purchases.numbering,
          stock: purchases.stock,
          gl: glPort,
          // The same boundary the confirm uses, for every other purchase action:
          // the audit row and the writes it describes commit together.
          transactor: { transaction: (fn) => purchases.gl.ledger.transaction(fn) },
          glReverse: purchases.layers ? glReversePort : undefined,
          accounts: purchases.accounts,
          allocatable: purchases.allocatable,
          returns: options.purchaseReturns?.service,
          exchangeRates: fxRatesUnder(purchases.exchangeRates, options.settingsStore),
          baseCurrency: purchases.baseCurrency,
          policy,
          layers: purchases.layers,
          pay: purchases.pay,
          settlementPreview: purchases.settlementPreview,
          resolveTaxRate: purchases.resolveTaxRate,
          currencyCheck:
            purchases.currencyCheck ?? (options.settingsStore ? createCurrencyCheck(options.settingsStore) : undefined),
          autoBatchNo:
            purchases.autoBatchNo ??
            (options.settingsStore && options.items
              ? async ({ itemId, receiptNumber, lineIndex }) => {
                  const settings = (await options.settingsStore!.get()) ?? createDefaultSettings();
                  if (!settings.autoGenerateBatchNumbers) return null;
                  const item = await options.items!.repo.findById(itemId);
                  if (!item?.trackBatches) return null;
                  return `${receiptNumber}-${String(lineIndex + 1).padStart(2, "0")}`;
                }
              : undefined),
          audit: purchases.audit ?? options.auditSink,
          events: purchases.events,
          now: purchases.now,
        },
        purchases.resolveAuthContext ?? resolveAuth,
      ),
    );
  }

  if (options.manufacturing) {
    const mfg = options.manufacturing;
    // Adapter: turn a completed work order's balanced WIP posting into a system
    // journal entry, posted through the GL engine (atomic JE numbering).
    const glPort: ManufacturingGlPostingPort = {
      post: async (posting: ManufacturingGlPosting) => {
        await postJournalEntry(
          {
            id: posting.entryRef ?? `WO-JE:${posting.sourceDocId}`,
            date: posting.date,
            memo: posting.memo,
            source: "system",
            // The posting has carried these all along; this adapter dropped
            // them, so a completed work order's entry named no source document
            // and the journal filed it as manual.
            sourceDocType: posting.sourceDocType,
            sourceDocId: posting.sourceDocId,
            sourceDocNumber: posting.sourceDocNumber ?? null,
            lines: posting.lines.map((l) => ({
              accountId: l.accountId,
              debit: l.debit,
              credit: l.credit,
              projectId: l.projectId ?? null,
              costCategory: l.costCategory ?? null,
            })),
          },
          mfg.gl,
        );
      },
    };
    app.route(
      "/manufacturing",
      createManufacturingRoutes(
        {
          masterData: mfg.masterData,
          boms: mfg.boms,
          workOrders: mfg.workOrders,
          configurableProducts: mfg.configurableProducts,
          configInstances: mfg.configInstances,
          workStations: mfg.workStations,
          operators: mfg.operators,
          warehouses: mfg.warehouses,
          numbering: mfg.numbering,
          stock: mfg.stock,
          positions: mfg.positions,
          movementsOfDocument: mfg.movementsOfDocument,
          journalEntriesOfDocument: mfg.journalEntriesOfDocument,
          auditOfDocument: mfg.auditOfDocument,
          gl: glPort,
          accounts: mfg.accounts,
          resolveUnitCost: mfg.resolveUnitCost,
          now: mfg.now,
        },
        mfg.resolveAuthContext ?? resolveAuth,
      ),
    );
  }

  if (options.rfq) {
    app.route(
      "/rfqs",
      createRfqRoutes(options.rfq, (options.rfq.resolveAuthContext ?? resolveAuth) ?? resolveAuth),
    );
  }

  if (options.reports) {
    app.route("/reports", createReportsRoutes(options.reports, resolveAuth));
  }
  if (options.financialReports) {
    app.route("/financial-reports", createFinancialReportsRoutes(options.financialReports, resolveAuth));
  }
  if (options.stockAdjustments) {
    app.route(
      "/inventory/stock-adjustments",
      createStockAdjustmentsRoutes(options.stockAdjustments.service, (options.stockAdjustments.resolveAuthContext ?? resolveAuth)),
    );
  }
  if (options.stockTransfers) {
    app.route(
      "/inventory/stock-transfers",
      createStockTransfersRoutes(options.stockTransfers.service, (options.stockTransfers.resolveAuthContext ?? resolveAuth)),
    );
  }
  if (options.physicalCounts) {
    app.route(
      "/inventory/physical-counts",
      createPhysicalCountsRoutes(options.physicalCounts.service, (options.physicalCounts.resolveAuthContext ?? resolveAuth)),
    );
  }
  if (options.inventoryWritedown) {
    app.route(
      "/inventory/writedown-runs",
      createInventoryWritedownRoutes(options.inventoryWritedown, resolveAuth),
    );
  }
  if (options.productTemplates) {
    app.route(
      "/inventory/product-templates",
      createProductTemplatesRoutes(options.productTemplates, resolveAuth),
    );
  }

  /**
   * The live entitlements the roles engine validates every grant against —
   * exposed so the role editor offers exactly the licensed modules/permissions
   * the server would accept, instead of its own client-side copy.
   */
  /**
   * What this tenant has used against its plan's quotas and limits, on its own
   * calendar day (DEC-31 rule 7). Mounted unconditionally: a tenant with no
   * quotas answers an empty list rather than a 404 the screen has to guess at.
   */
  app.route(
    "/plan-usage",
    createPlanUsageRoutes(
      {
        quota: options.salesInvoices
          ? createSalesInvoiceQuota(options.salesInvoices.repo, (fn) => uow.transaction(fn))
          : undefined,
        users: uow.users,
        branches: options.branchStore,
        warehouses: options.warehouseStore,
      },
      resolveAuth,
    ),
  );

  app.get("/entitlements", async (c) => {
    const entitlements = await resolveEntitlements(c);
    if (!entitlements) return c.json({ error: "ENTITLEMENTS_UNAVAILABLE" }, 500);
    return c.json(entitlements);
  });

  /**
   * Which approval chains name a role code. Supplied only when the workflow
   * module is mounted — an app with no approval chains has nothing to protect
   * the role against.
   */
  const workflowUsage = options.workflow
    ? async (roleCode: string): Promise<readonly string[]> => {
        const configs = await options.workflow!.configs.list();
        return configs
          .filter((config) => config.steps.some((step) => step.role === roleCode))
          .map((config) => config.actionType);
      }
    : undefined;

  app.route(
    "/roles",
    createRolesRoutes(uow, resolveEntitlements, resolveAuth, { audit: options.auditSink, workflowUsage }),
  );
  app.route(
    "/users",
    createUsersRoutes(uow, hasher, resolveAuth, {
      readAllowedEmailDomains: async () => (await options.settingsStore?.get())?.allowedEmailDomains ?? [],
      audit: options.auditSink,
      sessions: options.security?.sessions,
      loginThrottle: options.security?.loginThrottle,
      erasure: options.hr
        ? createUserErasurePort({
            employees: options.hr.employees,
            attendance: options.hr.attendance,
            attachments: options.hr.attachments ?? options.attachments?.repo,
            clockCredentials: options.hr.clockCredentials,
            challenges: options.hr.challenges,
          })
        : undefined,
    }),
  );
  app.route("/profile", createProfileRoutes(uow, hasher, resolveAuth, options.auditSink));
  if (options.printTemplateConfig) {
    app.route(
      "/print-template-config",
      createPrintTemplateConfigRoutes(options.printTemplateConfig, (options.printTemplateConfig.resolveAuthContext ?? resolveAuth) ?? resolveAuth),
    );
  }
  if (options.dataMigration) {
    app.route(
      "/data-migration",
      createDataMigrationRoutes(options.dataMigration, (options.dataMigration.resolveAuthContext ?? resolveAuth) ?? resolveAuth, options.auditSink),
    );
  }

  if (options.lan) {
    const registry = options.lan.registry ?? new SeatSessionRegistry(0);
    app.route(
      "/lan",
      createLanRoutes({
        resolveEntitlements: options.lan.resolveEntitlements,
        registry,
        sseHeartbeatMs: options.lan.sseHeartbeatMs,
        // The mount that binds a LAN socket is the LAST place a route should
        // be left resolving its caller from headers.
        resolveAuthContext: resolveAuth,
        sessions: options.lan.sessions ?? options.security?.sessions,
      }),
    );
  }

  if (options.workflow) {
    app.route(
      "/workflow",
      createWorkflowRoutes(
        {
          ...options.workflow,
          heldDocuments: options.workflow.heldDocuments ?? buildHeldDocumentResolver(options),
          audit: options.workflow.audit ?? options.auditSink,
          // An approval step may only name a role that exists, so the code an
          // approval is matched on can never be freed and re-taken.
          roleExists: options.workflow.roleExists ?? (async (code) => (await uow.roles.list()).some((r) => r.code === code)),
        },
        resolveAuth,
      ),
    );
  }

  if (options.attachments) {
    app.route(
      "/attachments",
      createAttachmentsRoutes(options.attachments, (options.attachments.resolveAuthContext ?? resolveAuth) ?? resolveAuth),
    );
  }

  /**
   * The last net. A domain error a route file forgot to map used to propagate
   * out of the fetch handler as a rejected promise — Hono answered the plain
   * text «Internal Server Error» and, on the node server, the unhandled
   * rejection took the PROCESS down: one refused approval into a closed month
   * and every till on the LAN lost its backend.
   *
   * INVARIANT: this handler must never itself throw. It logs and answers a
   * JSON body in the shape every client already parses.
   */
  app.onError((err, c) => {
    try {
      console.error(`[api] unhandled error on ${c.req.method} ${c.req.path}`, err);
    } catch {
      // A logger that throws must not turn a 500 into a crash.
    }
    return c.json({ error: "INTERNAL", message: "خطأ داخلي" }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;

/**
 * Maps a decided approval request back to the document it was gating, so an
 * approval actually POSTS that document and a rejection hands it back as a
 * draft. Only the action types whose documents this app actually mounts are
 * resolvable; anything else decides the request alone.
 */
function buildHeldDocumentResolver(options: CreateAppOptions) {
  const fromDocumentService = <L>(svc: DocumentService<L>): HeldDocumentActions => ({
    heldRequestId: async (docId) => (await svc.findById(docId))?.workflowRequestId ?? null,
    confirm: async (docId, actor) => {
      await svc.confirm(docId, { actor });
    },
    returnToDraft: async (docId) => {
      await svc.returnToDraft(docId);
    },
  });

  const actions: Partial<Record<GateableActionType, HeldDocumentActions>> = {};
  if (options.salesReturns) actions.SALES_RETURN_CONFIRM = fromDocumentService(options.salesReturns.service);
  if (options.purchaseReturns) actions.PURCHASE_RETURN_CONFIRM = fromDocumentService(options.purchaseReturns.service);
  if (options.landedCosts) actions.PURCHASE_LANDED_COST_CONFIRM = fromDocumentService(options.landedCosts.documents);
  if (options.vouchers) {
    const vouchers = options.vouchers;
    actions.TREASURY_VOUCHER_CONFIRM = {
      heldRequestId: async (docId) => (await new VoucherService(vouchers).findById(docId))?.workflowRequestId ?? null,
      confirm: async (docId, actor) => {
        await new VoucherService({ ...vouchers, actor }).confirmVoucher(docId);
      },
      returnToDraft: async (docId) => {
        await new VoucherService(vouchers).returnVoucherToDraft(docId);
      },
    };
  }
  if (options.salesInvoices) {
    const invoices = options.salesInvoices;
    actions.SALES_INVOICE_CONFIRM = {
      heldRequestId: async (docId) => (await new SalesInvoiceService(invoices).findById(docId))?.workflowRequestId ?? null,
      confirm: async (docId, actor) => {
        await new SalesInvoiceService({ ...invoices, actor }).confirm(docId);
      },
      returnToDraft: async (docId) => {
        await new SalesInvoiceService(invoices).returnToDraft(docId);
      },
    };
  }
  return (record: ApprovalRequestRecord): HeldDocumentActions | null => actions[record.actionType] ?? null;
}
