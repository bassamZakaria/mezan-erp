import { Hono } from "hono";
import {
  Money,
  postJournalEntrySpike,
  UnbalancedEntryError,
  InvalidJournalEntryError,
  SeatSessionRegistry,
  createEntitlements,
  type JournalEntry,
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
  type ApiKeyRepository,
  type BarcodeConfigRepository,
  type AuditQueryPort,
  type AuditSink,
  type WebhookDeliveryRepository,
  type WebhookRepository,
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
} from "@mezan/domain";
import { createScryptHasher } from "@mezan/persistence";
import { createJournalEntrySchema } from "@mezan/contracts";
import { createLanRoutes } from "./lan/routes.js";
import type { EntitlementsResolver } from "./module-gate.js";
import { createAccountsRouter } from "./accounts.js";
import type { AuthContextResolver } from "./permission-gate.js";
import { createSettingsRoutes } from "./settings-routes.js";
import { createCurrencyCheck, type CurrencyCheck } from "./currency-policy.js";
import { createBranchesRoutes } from "./branches-routes.js";
import { createWarehousesRoutes } from "./warehouses-routes.js";
import { createCustomersRouter } from "./customers-routes.js";
import { createSuppliersRouter } from "./suppliers-routes.js";
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
import { createTaxRatesRoutes } from "./tax-rates-routes.js";
import { createTaxGroupsRoutes } from "./tax-groups-routes.js";
import { createCostCentersRoutes } from "./cost-centers-routes.js";
import { createTreasuryAccountsRoutes } from "./treasury-accounts-routes.js";
import { createFiscalPeriodsRoutes } from "./fiscal-periods-routes.js";
import { createInventoryRoutes } from "./inventory-routes.js";
import { createGlRoutes, type GlRoutesDeps } from "./gl-routes.js";
import { createVouchersRoutes, createAllocationRoutes, type VoucherRoutesDeps } from "./vouchers-routes.js";
import { createSalesInvoicesRoutes, type SalesInvoiceRoutesDeps } from "./sales-invoices-routes.js";
import { createSalesReturnsRoutes } from "./sales-returns-routes.js";
import { createPurchaseReturnsRoutes } from "./purchase-returns-routes.js";
import { createLandedCostsRoutes } from "./landed-costs-routes.js";
import { createInstallmentsRoutes, type InstallmentsRoutesDeps } from "./installments-routes.js";
import { createDocumentsRoutes } from "./documents-routes.js";
import { createPurchasesRoutes, type PurchasesRoutesDeps } from "./purchases-routes.js";
import { createManufacturingRoutes, type ManufacturingRoutesDeps } from "./manufacturing-routes.js";
import { createRfqRoutes } from "./rfq-routes.js";
import { createHistoricalImportRoutes } from "./historical-import-routes.js";
import { createPrintTemplateConfigRoutes } from "./print-template-config-routes.js";
import { createDataMigrationRoutes, type DataMigrationTransactor } from "./data-migration-routes.js";
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
import { createEtaRoutes, type EtaRoutesDeps } from "./eta-routes.js";
import type { ExchangeRateRepository } from "@mezan/domain";
import { createReportsRoutes, type ReportsRoutesDeps } from "./reports-routes.js";
import { createChequesRoutes, type ChequeRoutesDeps } from "./cheques-routes.js";
import { createBankReconciliationRoutes, type BankReconciliationRoutesDeps } from "./bank-reconciliation-routes.js";
import { createCrmRoutes, type CrmRoutesDeps } from "./crm-routes.js";
import { createHrRoutes, type HrRoutesDeps } from "./hr-routes.js";
import { createProjectsRoutes, type ProjectsRoutesDeps } from "./projects-routes.js";
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
import { createBarcodeConfigRoutes } from "./barcode-config-routes.js";
import { createProfileRoutes } from "./profile-routes.js";
import { createApiKeysRoutes } from "./api-keys-routes.js";
import { createWebhooksRoutes } from "./webhooks-routes.js";

/**
 * Modules this build can actually serve, used as the default entitlements the
 * `/roles` route validates grants against and as what `GET /entitlements`
 * reports. Listing a module here makes its permissions grantable, so an
 * unimplemented domain must stay out: `pos` has no domain, routes or
 * persistence anywhere in this repo. Ids are ENTITLEMENT ids, not catalog
 * ids — the catalog's `cheques` module is the `financial_papers` entitlement
 * (packages/domain/src/permissions/module-licensing.ts).
 */
const DEFAULT_ACTIVE_MODULES = [
  "dashboard",
  "sales",
  "purchases",
  "inventory",
  "accounting",
  "treasury",
  "installments",
  "financial_papers",
  "crm",
  "hr",
  "manufacturing",
  "assets",
  "field",
  "workflow",
  "audit",
  "transactions",
  "admin",
  "notifications",
  "projects",
];

function defaultEntitlementsResolver(): EntitlementsResolver {
  const entitlements: Entitlements = createEntitlements({
    plan: "ENTERPRISE",
    activeModules: DEFAULT_ACTIVE_MODULES,
    features: {},
    seats: 10,
    expiresAt: null,
  });
  return () => entitlements;
}

/** Wire representation of an entry — money as decimal strings, byte-stable. */
function serialize(entry: JournalEntry) {
  return {
    id: entry.id,
    date: entry.date,
    memo: entry.memo,
    status: entry.status,
    lines: entry.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit.toString(),
      credit: l.credit.toString(),
    })),
  };
}

export interface CreateAppOptions {
  /**
   * Mounts `/lan/*` (docs/plan.md §2.6/§6.3.3) on this same app instance when
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
  };
  /**
   * Mounts `/accounts/*` (docs/catalog/04 "دليل الحسابات") when present. The
   * Chart of Accounts isn't part of the journal-posting `UnitOfWork` yet, so
   * its repository is injected separately — omit it and the app behaves
   * exactly as before (no `/accounts` routes), same as any existing caller.
   */
  readonly accounts?: {
    readonly repo: AccountRepository;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /**
   * Mounts `/items` (docs/catalog/03 "الأصناف") when present. Items aren't
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
   * Mounts `/item-units` and `/item-categories` (docs/catalog/03 §"وحدة
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
  /** Mounts `/sequences` (docs/catalog/09 §"تسلسلات الترقيم") when present. */
  readonly sequences?: SequencesRoutesDeps & { readonly resolveAuthContext?: AuthContextResolver };
  /** Mounts `/barcode-config` when present. */
  readonly barcodeConfigStore?: BarcodeConfigRepository;
  /** Shared audit sink for profile security events and API-key/webhook writes. */
  readonly auditSink?: AuditSink;
  /** Mounts `/api-keys` when present. */
  readonly apiKeys?: { readonly repo: ApiKeyRepository; readonly resolveAuthContext?: AuthContextResolver };
  /** Mounts `/webhooks` when present. */
  readonly webhooks?: {
    readonly webhooks: WebhookRepository;
    readonly deliveries: WebhookDeliveryRepository;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /** Mounts `/audit` — the read-only audit query surface — when present. */
  readonly audit?: { readonly store: AuditQueryPort; readonly resolveAuthContext?: AuthContextResolver };
  /** Mounts `/label-layouts` when present — the sticker-sheet geometries the label screen renders. */
  readonly labelLayouts?: {
    readonly repo: LabelLayoutRepository;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /** Mounts `/financial-reports` (the 7 statements over the live posted ledger) when present. */
  readonly financialReports?: FinancialReportsRoutesDeps;
  /** Mounts `/settings` (docs/catalog/09) when present — omit it for no `/settings` route. */
  readonly settingsStore?: SettingsRepository;
  /** Mounts `/branches` (docs/catalog/09) when present — omit it for no `/branches` route. */
  readonly branchStore?: BranchRepository;
  /** Mounts `/warehouses` (docs/catalog/09) when present — omit it for no `/warehouses` route. */
  readonly warehouseStore?: WarehouseRepository;
  /** Mounts `/customers` (docs/catalog/01 "العملاء") when present — omit it for no `/customers` route. */
  readonly customerStore?: CustomerRepository;
  /** Mounts `/suppliers` (docs/catalog/02 "الموردون") when present — omit it for no `/suppliers` route. */
  readonly supplierStore?: SupplierRepository;
  /** مجموعات الضرائب (R6.4) — mounts `/tax-groups` when present. */
  readonly taxGroupRepo?: TaxGroupRepository;
  /** Mounts `/tax-rates` (docs/catalog/04 "الضرائب") when present — omit it for no `/tax-rates` route. */
  readonly taxRateRepo?: TaxRateRepository;
  /** Mounts `/cost-centers` (docs/catalog/04 "مراكز التكلفة") when present — omit it for no `/cost-centers` route. */
  readonly costCenterRepo?: CostCenterRepository;
  /** Mounts `/treasury-accounts` (docs/catalog/04 "حسابات الخزينة") when present — omit it for no `/treasury-accounts` route. */
  readonly treasuryAccountRepo?: TreasuryAccountRepository;
  /** Mounts `/fiscal-periods` (docs/catalog/04 "الفترات المالية") when present — omit it for no `/fiscal-periods` route. */
  readonly fiscalPeriodRepo?: FiscalPeriodRepository;
  /**
   * Mounts `/inventory` (docs/catalog/03 — the costing + stock-ledger engine)
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
   * Mounts `/inventory/stock-adjustments` (docs/catalog/03 §"تسويات المخزون")
   * — the document-layer draft/confirm CRUD built on `stockAdjustmentDocumentType`
   * — when present. Omit it for no such route (the raw `/inventory/adjustments`
   * engine endpoint above is unaffected either way).
   */
  readonly stockAdjustments?: {
    readonly service: DocumentService<StockAdjustmentDocLine>;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /** Mounts `/inventory/stock-transfers` (docs/catalog/03 §"تحويلات المخزون") when present. */
  readonly stockTransfers?: {
    readonly service: DocumentService<StockTransferDocLine>;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /** Mounts `/inventory/physical-counts` (docs/catalog/03 §"الجرد الفعلي") when present. */
  readonly physicalCounts?: {
    readonly service: PhysicalCountService;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /**
   * Mounts `/inventory/writedown-runs` (docs/backlog.md Phase 4 "aging-based
   * inventory write-down batch") when present: a manually-triggered,
   * per-period-idempotent monthly provisioning job that posts Dr write-down
   * expense / Cr the 1190-style contra-asset provision for slow-moving
   * stock, through the REAL GL posting engine. Never touches an item's
   * recorded WAC/cost layers.
   */
  readonly inventoryWritedown?: InventoryWritedownRoutesDeps;
  /**
   * Mounts `/inventory/product-templates` (docs/catalog/03-inventory.md
   * §"قوالب المنتجات") when present: attribute-driven templates + the
   * variant/SKU generator (creates REAL Items).
   */
  readonly productTemplates?: ProductTemplatesRoutesDeps;
  /**
   * Mounts the GL posting engine under `/gl` (docs/catalog/04 §القيود المحاسبية)
   * when present — omit it for no `/gl` routes. Bundles its own ledger,
   * account/period lookups and numbering engine (all connection-shared for
   * atomic no-gap numbering); optional audit sink + domain-event publisher.
   */
  readonly gl?: GlRoutesDeps;

  /**
   * Sales invoices (docs/catalog/01). Mounted under `/sales-invoices` when
   * supplied. When `creditControl` isn't already set on these deps AND both
   * `settingsStore` and `customerStore` are also supplied, `createApp` wires
   * a REAL credit-control check automatically (tenant settings' الرقابة
   * الائتمانية + the customer's own الحد الائتماني + their live-invoice
   * exposure via `createSalesInvoiceCustomerExposureHook`) — omit either
   * store to get exactly today's behaviour (no credit check at all).
   */
  readonly salesInvoices?: SalesInvoiceRoutesDeps;
  /**
   * Mounts the historical sales-document import (docs/catalog/01 §"استيراد
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
  /** Mounts `/price-lists` (docs/catalog/01 "قوائم الأسعار") when present. */
  readonly priceListRepo?: PriceListRepository;
  /** Mounts `/promotions` (docs/catalog/01 "العروض") when present. */
  readonly promotionRepo?: PromotionRepository;
  /** Mounts `/notification-rules` (docs/catalog/09 §قواعد الإشعارات) when present. */
  readonly notificationRuleRepo?: NotificationRuleRepository;
  /**
   * The event codes this deployment really publishes onto the event bus —
   * what `/notification-rules/triggers` reports as `emitted`, and the set
   * `/webhooks` will accept a subscription on. The composition root derives it
   * from its own bridge wiring; omit it and every trigger is honestly reported
   * as not-yet-emitted and the webhook check is off.
   */
  readonly emittedEventCodes?: readonly EventCode[];
  /** Mounts `/notifications` (the top-bar bell panel's own data) when present. */
  readonly notificationRepo?: NotificationRepository;
  /**
   * Mounts `/sales-quotes` (docs/catalog/01 "عروض الأسعار") when present. Its
   * `invoice` bridge (for "إنشاء من عرض سعر") is auto-filled from
   * `salesInvoices`'s repo/numbering/gl/stock when both are supplied and the
   * caller didn't already set `invoice` themselves.
   */
  readonly salesQuotes?: SalesQuoteRoutesDeps;
  /** Mounts `/exchange-rates` (docs/catalog/04 "أسعار الصرف") when present. */
  readonly exchangeRateRepo?: ExchangeRateRepository;
  /** Mounts `/cost-center-pl` (docs/catalog/04 "أرباح مراكز التكلفة") when present. */
  readonly costCenterPl?: CostCenterPnLRoutesDeps;
  /** Mounts `/revaluation` (docs/catalog/04 "إعادة تقييم العملات الأجنبية") when present. */
  readonly fxRevaluation?: FxRevaluationRoutesDeps;
  /** Mounts `/reconciliation` (docs/catalog/04 "مطابقة الأرصدة") when present. */
  readonly reconciliation?: ReconciliationRoutesDeps;
  /** Mounts `/eta` (docs/catalog/04 "الفاتورة الإلكترونية") when present. */
  readonly eta?: EtaRoutesDeps;
  /**
   * Mounts the Treasury Vouchers routes (docs/catalog/04 §"السندات النقدية") —
   * `/vouchers/*` plus the root `/allocations/:id/reverse` and `/open-invoices`
   * — when present. Bundles the voucher/allocation/invoice repositories with the
   * GL posting engine, numbering, treasury-account lookup and settings the
   * `VoucherService` composes. Omit it and the app behaves exactly as before.
   */
  readonly vouchers?: VoucherRoutesDeps;
  /**
   * Mounts the Cheque Register routes (docs/catalog/04 §"سجل الشيكات") under
   * `/cheques` when present. Bundles the cheque repository with the GL
   * posting engine deps the `ChequeService` composes (see cheques-routes.ts).
   */
  readonly cheques?: ChequeRoutesDeps;
  /**
   * Mounts the Bank Statement Reconciliation routes (docs/catalog/04
   * §"تسوية كشوف البنك") under `/bank-statements` when present. Bundles the
   * statement/column-mapping repositories with a `TreasuryLedgerReader`
   * (bind `createTreasuryLedgerReader` from `@mezan/domain` over the real
   * ledger + treasury-account repos).
   */
  readonly bankReconciliation?: BankReconciliationRoutesDeps;
  /**
   * Mounts CRM (docs/catalog/06 "إدارة علاقات العملاء") under `/crm` when
   * present: leads, opportunities, pipeline stages, activities.
   */
  readonly crm?: CrmRoutesDeps;
  /**
   * Mounts HR master data (docs/catalog/06 "الموارد البشرية") under `/hr`
   * when present: departments, job titles, employees, contracts, holidays,
   * the HR dashboard, and the leave-request slice backing إجازاتي (My Leave).
   */
  readonly hr?: HrRoutesDeps;
  /**
   * Mounts Projects (docs/catalog/07 "المشاريع والمقاولات") under `/projects`
   * when present. Creating a project auto-creates its linked `PRJ-{code}`
   * cost center via the real cost-centers domain.
   */
  readonly projects?: ProjectsRoutesDeps;
  /**
   * Mounts Fixed Assets (docs/catalog/07 "الأصول الثابتة") under `/assets`
   * when present: asset categories, the asset register, and depreciation
   * runs (posting a REAL balanced GL entry through the GL posting engine).
   */
  readonly fixedAssets?: FixedAssetsRoutesDeps;
  /**
   * Mounts Field/Van Sales (docs/catalog/07 "رحلات المندوبين") under
   * `/field/van-trips` when present: open (crew, van warehouse, opening cash
   * float, stock load) through settle (cash + stock variance).
   */
  readonly fieldSales?: FieldSalesRoutesDeps;
  /**
   * Mounts the purchase chain under `/purchases` (docs/catalog/02): أوامر الشراء
   * → استلام البضائع → فواتير المشتريات. The caller supplies the three document
   * repositories, the numbering engine, the costing/stock-ledger service (for
   * stock IN on receipt/manual-invoice confirmation) and the GL posting deps
   * (for the invoice's inventory + payable + tax journal entry). Omit it and the
   * app behaves exactly as before (no `/purchases` routes).
   */
  readonly purchases?: {
    readonly orders: PurchaseOrderRepository;
    readonly receipts: GoodsReceiptRepository;
    readonly invoices: PurchaseInvoiceRepository;
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
     * settings on every request (docs/catalog/09 §"التحكم في المشتريات") — no
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
    readonly resolveAuthContext?: AuthContextResolver;
    /** Audit sink for the chain's confirm/cancel records; falls back to `options.auditSink`. */
    readonly audit?: AuditSink;
    readonly now?: () => string;
  };
  /**
   * Mounts the manufacturing module under `/manufacturing` (docs/catalog/07):
   * BOMs, work orders (4-stage), configurable products and custom manufacturing.
   * The caller supplies the four document repositories, the numbering engine,
   * the costing/stock-ledger service (raw OUT on issue, finished-goods IN on
   * receipt) and the GL posting deps (the work-order completion journal entry).
   * Omit it and the app behaves exactly as before (no `/manufacturing` routes).
   */
  readonly manufacturing?: {
    readonly boms: BomRepository;
    readonly workOrders: WorkOrderRepository;
    readonly configurableProducts: ConfigurableProductRepository;
    readonly configInstances: ConfigInstanceRepository;
    /** محطات العمل — the registry behind `/manufacturing/work-stations` (R9.1). */
    readonly workStations: WorkStationRepository;
    /** المشغّلون — the employee registry an operator id on a shop-floor action is resolved against. */
    readonly operators?: { findById(id: string): Promise<{ id: string; fullName: string } | null> };
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
   * Mounts طلبات عروض الأسعار (RFQs, docs/catalog/02) under `/rfqs` when
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
  };
  /**
   * Mounts the historical purchase-document import (docs/catalog/02 §"استيراد
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
   * Mounts the 9-tab print-template designer's persisted config (docs/catalog/09
   * §"قوالب الطباعة") under `/print-template-config` when present — GET
   * returns the tenant's saved config or the shared default, PUT validates
   * and saves. Omit for no such routes.
   */
  readonly printTemplateConfig?: {
    readonly repo: PrintTemplateConfigRepository;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /**
   * Mounts the Data Migration wizard's 9 master-data steps (docs/catalog/09
   * §"نقل البيانات", steps 1-9 — الأقسام through الأصول الثابتة) under
   * `/data-migration` when present. The 4 historical-document steps (10-13)
   * are NOT here — they reuse `/purchases/historical-import` and the sibling
   * `/sales/historical-import` mount directly. Omit for no such routes.
   */
  readonly dataMigration?: {
    readonly departments: DepartmentRepository;
    readonly employees: EmployeeRepository;
    readonly treasuryAccounts: TreasuryAccountRepository;
    readonly suppliers: SupplierRepository;
    readonly customers: CustomerRepository;
    readonly items: ItemRepository;
    readonly assetCategories: AssetCategoryRepository;
    readonly assets: AssetRepository;
    readonly branches: BranchRepository;
    /** Optional — enables the item opening-balance step (`/data-migration/opening-balances`). */
    readonly warehouses?: WarehouseRepository;
    readonly stockAdjustments?: DocumentService<StockAdjustmentDocLine>;
    readonly transact?: DataMigrationTransactor;
    readonly historicalCounts?: () => Promise<{
      salesInvoices: number;
      salesReturns: number;
      purchaseInvoices: number;
      purchaseReturns: number;
    }>;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /**
   * Mounts `/sales-returns` (docs/catalog/01 §"مرتجعات المبيعات") when
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
  /** Mounts `/purchase-returns` (docs/catalog/02 §"مرتجعات المشتريات") when present — mirrors `salesReturns`. */
  readonly purchaseReturns?: {
    readonly service: DocumentService<PurchaseReturnLine>;
    readonly resolveAuthContext?: AuthContextResolver;
    /** Lets the server derive the returnable quantity rather than trusting the client's. */
    readonly invoices?: PurchaseInvoiceLookupPort;
  };
  /**
   * Mounts `/landed-costs` (docs/catalog/02 §"التكاليف الإضافية") when
   * present. `documents` drives list/create/cancel; `service` (the same
   * document service wrapped by `LandedCostService`) drives confirm so the
   * cost-layer revaluation runs alongside the GL post.
   */
  readonly landedCosts?: {
    readonly documents: DocumentService<LandedCostLine>;
    readonly service: LandedCostService;
    readonly resolveAuthContext?: AuthContextResolver;
  };
  /** Mounts `/installments` (docs/catalog/05 §"خطط الأقساط" + §"متابعة التحصيل") when present. */
  readonly installments?: InstallmentsRoutesDeps & { readonly resolveAuthContext?: AuthContextResolver };
  /**
   * Mounts `/reports` (docs/catalog/08 — operational reports) when present.
   * Independent of `options.inventory`/`options.purchases`/etc. — it takes
   * its own repository references directly (not the higher-level services
   * those blocks wrap) since reports only ever READ, never post GL/stock
   * effects. Omit it and the app behaves exactly as before (no `/reports`
   * routes).
   */
  readonly reports?: ReportsRoutesDeps;
  /**
   * Resolves the caller's AuthContext for the settings/branches/warehouses/
   * customers/suppliers routes. Defaults to `headerAuthContextResolver` (see
   * permission-gate.ts), the same default `createAccountsRouter` uses — omit
   * it to get that header-driven spike behavior; a real deployment injects a
   * resolver derived from the JWT/session instead.
   */
  readonly resolveAuthContext?: AuthContextResolver;
  /**
   * Entitlements resolver the `/roles` route validates permission grants
   * against (docs/catalog/09 §الأدوار — only licensed-module permissions are
   * grantable), and that `GET /entitlements` reports. Defaults to
   * `DEFAULT_ACTIVE_MODULES` until a real per-tenant source is wired up.
   */
  readonly resolveEntitlements?: EntitlementsResolver;
  /** Secret hasher for `/users` password/PIN storage. Defaults to `createScryptHasher()`. */
  readonly hasher?: ReturnType<typeof createScryptHasher>;
  /**
   * Mounts `/workflow` (docs/catalog/09 §سير العمل — إعدادات الموافقات
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
}

/**
 * Derive the purchase chain's 3-gate strictness policy (docs/catalog/09
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
  const resolveEntitlements = options.resolveEntitlements ?? defaultEntitlementsResolver();
  const hasher = options.hasher ?? createScryptHasher();

  const app = new Hono();

  if (options.settingsStore) {
    app.route("/settings", createSettingsRoutes(options.settingsStore, options.resolveAuthContext));
  }
  if (options.branchStore) {
    app.route("/branches", createBranchesRoutes(options.branchStore, options.resolveAuthContext));
  }
  if (options.warehouseStore) {
    app.route("/warehouses", createWarehousesRoutes(options.warehouseStore, options.resolveAuthContext));
  }
  if (options.customerStore) {
    app.route(
      "/customers",
      createCustomersRouter(options.customerStore, options.resolveAuthContext, options.auditSink, options.priceListRepo),
    );
  }
  if (options.supplierStore) {
    app.route("/suppliers", createSuppliersRouter(options.supplierStore, options.resolveAuthContext));
  }

  if (options.accounts) {
    app.route("/accounts", createAccountsRouter(options.accounts.repo, options.accounts.resolveAuthContext));
  }
  if (options.taxRateRepo) {
    app.route("/tax-rates", createTaxRatesRoutes(options.taxRateRepo, options.resolveAuthContext));
    if (options.taxGroupRepo) {
      app.route("/tax-groups", createTaxGroupsRoutes(options.taxGroupRepo, options.taxRateRepo, options.resolveAuthContext));
    }
  }
  if (options.costCenterRepo) {
    app.route(
      "/cost-centers",
      createCostCentersRoutes(options.costCenterRepo, options.resolveAuthContext, options.hr?.departments),
    );
  }
  if (options.treasuryAccountRepo) {
    app.route("/treasury-accounts", createTreasuryAccountsRoutes(options.treasuryAccountRepo, options.resolveAuthContext));
  }
  if (options.fiscalPeriodRepo) {
    app.route("/fiscal-periods", createFiscalPeriodsRoutes(options.fiscalPeriodRepo, options.resolveAuthContext));
  }
  if (options.gl) {
    app.route("/gl", createGlRoutes(options.gl, options.resolveAuthContext));
  }
  if (options.vouchers) {
    app.route("/vouchers", createVouchersRoutes(options.vouchers, options.resolveAuthContext));
    app.route("/", createAllocationRoutes(options.vouchers, options.resolveAuthContext));
  }
  if (options.cheques) {
    app.route("/cheques", createChequesRoutes(options.cheques, options.resolveAuthContext));
  }
  if (options.bankReconciliation) {
    app.route("/bank-statements", createBankReconciliationRoutes(options.bankReconciliation, options.resolveAuthContext));
  }
  if (options.crm) {
    app.route("/crm", createCrmRoutes(options.crm, options.resolveAuthContext));
  }
  if (options.hr) {
    app.route("/hr", createHrRoutes(options.hr, options.resolveAuthContext));
  }
  if (options.projects) {
    app.route("/projects", createProjectsRoutes(options.projects, options.resolveAuthContext));
  }
  if (options.fixedAssets) {
    app.route("/assets", createFixedAssetsRoutes(options.fixedAssets, options.resolveAuthContext));
  }
  if (options.fieldSales) {
    app.route("/field/van-trips", createFieldSalesRoutes(options.fieldSales, options.resolveAuthContext));
    // Mounted from the SAME deps, so a composition that supplies a registry
    // gets both the list the trip form picks from and the cascade the trip
    // route enforces — never one without the other.
    if (options.fieldSales.vans) {
      app.route("/field/vans", createVansRoutes(options.fieldSales.vans, options.resolveAuthContext));
    }
  }
  if (options.salesInvoices) {
    const salesInvoices = options.salesInvoices;
    // Auto-wire credit control (docs/catalog/01/09 §"الرقابة الائتمانية") when
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
        },
        options.resolveAuthContext,
      ),
    );
  }
  if (options.salesHistoricalImport) {
    app.route(
      "/sales/historical-import",
      createSalesHistoricalImportRoutes(
        options.salesHistoricalImport,
        options.salesHistoricalImport.resolveAuthContext ?? options.resolveAuthContext,
      ),
    );
  }
  if (options.priceListRepo) {
    app.route("/price-lists", createPriceListsRoutes(options.priceListRepo, options.resolveAuthContext, options.customerStore));
  }
  if (options.promotionRepo) {
    app.route(
      "/promotions",
      createPromotionsRoutes(options.promotionRepo, options.resolveAuthContext, {
        salesInvoices: options.salesInvoices?.repo,
        salesReturns: options.salesReturns?.service,
      }),
    );
  }
  if (options.notificationRuleRepo) {
    app.route(
      "/notification-rules",
      createNotificationRulesRoutes(options.notificationRuleRepo, options.resolveAuthContext, options.emittedEventCodes),
    );
  }
  if (options.notificationRepo) {
    app.route("/notifications", createNotificationsRoutes(options.notificationRepo, options.resolveAuthContext));
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
          }
        : undefined);
    app.route("/sales-quotes", createSalesQuotesRoutes({ ...salesQuotes, invoice }, options.resolveAuthContext));
  }
  if (options.salesReturns) {
    app.route(
      "/sales-returns",
      createSalesReturnsRoutes(
        options.salesReturns.service,
        options.salesReturns.resolveAuthContext,
        options.salesReturns.invoices,
        options.salesReturns.refunds,
      ),
    );
  }
  if (options.purchaseReturns) {
    app.route(
      "/purchase-returns",
      createPurchaseReturnsRoutes(options.purchaseReturns.service, options.purchaseReturns.resolveAuthContext, options.purchaseReturns.invoices),
    );
  }
  if (options.landedCosts) {
    app.route(
      "/landed-costs",
      createLandedCostsRoutes(options.landedCosts.documents, options.landedCosts.service, options.landedCosts.resolveAuthContext),
    );
  }
  if (options.installments) {
    app.route("/installments", createInstallmentsRoutes(options.installments, options.installments.resolveAuthContext));
  }
  if (options.exchangeRateRepo) {
    app.route("/exchange-rates", createExchangeRatesRoutes(options.exchangeRateRepo, options.resolveAuthContext));
  }
  if (options.costCenterPl) {
    app.route("/cost-center-pl", createCostCenterPnLRoutes(options.costCenterPl, options.resolveAuthContext));
  }
  if (options.fxRevaluation) {
    app.route("/revaluation", createFxRevaluationRoutes(options.fxRevaluation, options.resolveAuthContext));
  }
  if (options.reconciliation) {
    app.route("/reconciliation", createReconciliationRoutes(options.reconciliation, options.resolveAuthContext));
  }
  if (options.eta) {
    app.route("/eta", createEtaRoutes(options.eta, options.resolveAuthContext));
  }
  // Generic document framework (docs/archive/execution-plan-2026-08-23.md W4): read-only type
  // registry + pure effects computation. No persistence, so always mounted.
  app.route("/documents", createDocumentsRoutes(options.resolveAuthContext));

  if (options.items) {
    app.route(
      "/items",
      createItemsRouter(options.items.repo, options.items.resolveAuthContext, options.items.snapshots, options.settingsStore, options.auditSink),
    );
  }
  if (options.accountRouting) {
    app.route(
      "/accounting/account-routing",
      createAccountRoutingRoutes(options.accountRouting.repo, options.accountRouting.resolveAuthContext),
    );
  }
  if (options.itemCatalog) {
    app.route("/item-units", createItemUnitsRoutes(options.itemCatalog.units, options.itemCatalog.resolveAuthContext));
    app.route(
      "/item-categories",
      createItemCategoriesRoutes(options.itemCatalog.categories, options.itemCatalog.resolveAuthContext),
    );
    if (options.itemCatalog.brands) {
      app.route("/item-brands", createItemBrandsRoutes(options.itemCatalog.brands, options.itemCatalog.resolveAuthContext));
    }
    if (options.itemCatalog.seasons) {
      app.route("/item-seasons", createItemSeasonsRoutes(options.itemCatalog.seasons, options.itemCatalog.resolveAuthContext));
    }
  }
  if (options.itemSpecifications) {
    app.route(
      "/item-specifications",
      createItemSpecificationsRoutes(options.itemSpecifications, options.itemSpecifications.resolveAuthContext ?? options.resolveAuthContext),
    );
  }
  if (options.barcodeConfigStore) {
    app.route("/barcode-config", createBarcodeConfigRoutes({ store: options.barcodeConfigStore }, options.resolveAuthContext));
  }
  if (options.sequences) {
    app.route("/sequences", createSequencesRoutes(options.sequences, options.sequences.resolveAuthContext));
  }
  if (options.audit) {
    app.route("/audit", createAuditRoutes(options.audit.store, options.audit.resolveAuthContext));
  }
  if (options.labelLayouts) {
    app.route("/label-layouts", createLabelLayoutsRouter(options.labelLayouts.repo, options.labelLayouts.resolveAuthContext));
  }
  if (options.inventory) {
    app.route(
      "/inventory",
      createInventoryRoutes(
        options.inventory.service,
        options.inventory.resolveAuthContext,
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
        options.historicalImport.resolveAuthContext ?? options.resolveAuthContext,
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
              // the foreign balance this entry created (D24).
              currency: l.currency ?? null,
              fxRate: l.fxRate ?? null,
            })),
          },
          purchases.gl,
        );
      },
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
          orders: purchases.orders,
          receipts: purchases.receipts,
          invoices: purchases.invoices,
          numbering: purchases.numbering,
          stock: purchases.stock,
          gl: glPort,
          glReverse: purchases.layers ? glReversePort : undefined,
          accounts: purchases.accounts,
          allocatable: purchases.allocatable,
          exchangeRates: fxRatesUnder(purchases.exchangeRates, options.settingsStore),
          baseCurrency: purchases.baseCurrency,
          policy,
          layers: purchases.layers,
          pay: purchases.pay,
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
          now: purchases.now,
        },
        purchases.resolveAuthContext ?? options.resolveAuthContext,
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
            id: `WO-JE:${posting.sourceDocId}`,
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
          boms: mfg.boms,
          workOrders: mfg.workOrders,
          configurableProducts: mfg.configurableProducts,
          configInstances: mfg.configInstances,
          workStations: mfg.workStations,
          operators: mfg.operators,
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
        mfg.resolveAuthContext ?? options.resolveAuthContext,
      ),
    );
  }

  if (options.rfq) {
    app.route(
      "/rfqs",
      createRfqRoutes(options.rfq, options.rfq.resolveAuthContext ?? options.resolveAuthContext),
    );
  }

  if (options.reports) {
    app.route("/reports", createReportsRoutes(options.reports, options.resolveAuthContext));
  }
  if (options.financialReports) {
    app.route("/financial-reports", createFinancialReportsRoutes(options.financialReports, options.resolveAuthContext));
  }
  if (options.stockAdjustments) {
    app.route(
      "/inventory/stock-adjustments",
      createStockAdjustmentsRoutes(options.stockAdjustments.service, options.stockAdjustments.resolveAuthContext),
    );
  }
  if (options.stockTransfers) {
    app.route(
      "/inventory/stock-transfers",
      createStockTransfersRoutes(options.stockTransfers.service, options.stockTransfers.resolveAuthContext),
    );
  }
  if (options.physicalCounts) {
    app.route(
      "/inventory/physical-counts",
      createPhysicalCountsRoutes(options.physicalCounts.service, options.physicalCounts.resolveAuthContext),
    );
  }
  if (options.inventoryWritedown) {
    app.route(
      "/inventory/writedown-runs",
      createInventoryWritedownRoutes(options.inventoryWritedown, options.resolveAuthContext),
    );
  }
  if (options.productTemplates) {
    app.route(
      "/inventory/product-templates",
      createProductTemplatesRoutes(options.productTemplates, options.resolveAuthContext),
    );
  }

  /**
   * The live entitlements the roles engine validates every grant against —
   * exposed so the role editor offers exactly the licensed modules/permissions
   * the server would accept, instead of its own client-side copy.
   */
  app.get("/entitlements", async (c) => {
    const entitlements = await resolveEntitlements(c);
    if (!entitlements) return c.json({ error: "ENTITLEMENTS_UNAVAILABLE" }, 500);
    return c.json(entitlements);
  });

  app.route("/roles", createRolesRoutes(uow, resolveEntitlements, options.resolveAuthContext));
  app.route("/users", createUsersRoutes(uow, hasher, options.resolveAuthContext));
  app.route("/profile", createProfileRoutes(uow, hasher, options.resolveAuthContext, options.auditSink));
  if (options.apiKeys) {
    app.route(
      "/api-keys",
      createApiKeysRoutes(options.apiKeys.repo, hasher, options.apiKeys.resolveAuthContext ?? options.resolveAuthContext, options.auditSink),
    );
  }
  if (options.webhooks) {
    app.route(
      "/webhooks",
      createWebhooksRoutes(
        {
          webhooks: options.webhooks.webhooks,
          deliveries: options.webhooks.deliveries,
          emittedEventCodes: options.emittedEventCodes,
        },
        options.webhooks.resolveAuthContext ?? options.resolveAuthContext,
        options.auditSink,
      ),
    );
  }

  app.post("/journal-entries", async (c) => {
    const parsed = createJournalEntrySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        { error: "VALIDATION_ERROR", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const entry = await postJournalEntrySpike(
        {
          id: parsed.data.id,
          date: parsed.data.date,
          memo: parsed.data.memo,
          lines: parsed.data.lines.map((l) => ({
            accountId: l.accountId,
            debit: Money.fromMajor(l.debit),
            credit: Money.fromMajor(l.credit),
          })),
        },
        uow,
      );
      return c.json(serialize(entry), 201);
    } catch (err) {
      if (err instanceof UnbalancedEntryError) {
        return c.json(
          {
            error: err.code,
            message: err.message,
            totalDebit: err.totalDebit.toString(),
            totalCredit: err.totalCredit.toString(),
          },
          422,
        );
      }
      if (err instanceof InvalidJournalEntryError) {
        return c.json({ error: err.code, message: err.message }, 400);
      }
      throw err;
    }
  });

  app.get("/journal-entries/:id", async (c) => {
    const entry = await uow.journal.findById(c.req.param("id"));
    if (!entry) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(entry));
  });

  if (options.printTemplateConfig) {
    app.route(
      "/print-template-config",
      createPrintTemplateConfigRoutes(options.printTemplateConfig, options.printTemplateConfig.resolveAuthContext ?? options.resolveAuthContext),
    );
  }
  if (options.dataMigration) {
    app.route(
      "/data-migration",
      createDataMigrationRoutes(options.dataMigration, options.dataMigration.resolveAuthContext ?? options.resolveAuthContext),
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
      }),
    );
  }

  if (options.workflow) {
    app.route(
      "/workflow",
      createWorkflowRoutes(
        { ...options.workflow, heldDocuments: options.workflow.heldDocuments ?? buildHeldDocumentResolver(options) },
        options.resolveAuthContext,
      ),
    );
  }

  if (options.attachments) {
    app.route(
      "/attachments",
      createAttachmentsRoutes(options.attachments, options.attachments.resolveAuthContext ?? options.resolveAuthContext),
    );
  }

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
