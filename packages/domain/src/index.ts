export { Money, MONEY_SCALE_DECIMALS } from "./money/index.js";
export { amountInWords, EGP_WORDS, SAR_WORDS } from "./money/index.js";
export type { ArabicCurrencyNoun, ArabicCurrencyWords, ArabicNounGender } from "./money/index.js";
export type {
  JournalEntry,
  JournalLine,
  JournalRepository,
  JournalEntrySource,
  JournalEntryStatus,
  UnitOfWork,
  JournalSourceModule,
} from "./journal.js";
export { journalSourceModule } from "./journal.js";
// The spike's minimal poster (backs the legacy `/journal-entries` route). The
// full GL posting engine below owns the primary `postJournalEntry` name.
export {
  postJournalEntry as postJournalEntrySpike,
  UnbalancedEntryError,
  InvalidJournalEntryError,
} from "./post-journal-entry.js";
export type { PostJournalEntryCommand } from "./post-journal-entry.js";

// --- gl/ — GL posting engine (phase2/gl-posting) ---
export * from "./gl/index.js";

// --- ledger-support + infra cluster (phase0/ledger-infra) ---

// money/ — Qty value object + rounding policy + allocation
export { Qty, QTY_SCALE_DECIMALS } from "./money/index.js";
export {
  allocate,
  allocateScaled,
  roundMoney,
  ROUNDING_BOUNDARIES,
} from "./money/index.js";
export type { RoundingMode, RoundingBoundary } from "./money/index.js";

// numbering/ — 31 sequence definitions + atomic NextNumber service
export {
  SEQUENCE_DEFINITIONS,
  getSequenceDefinition,
  formatSequenceNumber,
  applySequenceOverride,
  NextNumberService,
} from "./numbering/index.js";
export type {
  SequenceDefinition,
  SequenceCode,
  SequenceOverride,
  SequenceStore,
  SequenceConfigStore,
  NextNumberResult,
  NextNumberOptions,
} from "./numbering/index.js";

// audit/ — append-only audit trail (security + sensitive streams)
export {
  AuditRecordingError,
  AuditStreamName,
  ConnectionTurnLostError,
  ForeignWriteError,
  AUDIT_SEVERITIES,
  AUDIT_STREAMS,
  createAuditEvent,
  recordSecurityEvent,
  recordSensitiveEvent,
  auditBranchFromScope,
  branchScopedAuditSink,
  createMemorySecurityEventFallback,
  recordSecurityEventOrFallback,
  withoutSecrets,
  UNRECORDED_RECENT_LIMIT,
  AuditSeverityCode,
} from "./audit/index.js";
export type { SecurityEventFallback, UnrecordedSecurityEvent, UnrecordedSecurityEvents } from "./audit/index.js";
export type {
  AuditSeverity,
  AuditStream,
  AuditEvent,
  AuditEventInput,
  AuditSink,
  TurnObserver,
  AuditQueryFilter,
  AuditQueryResult,
  AuditQueryPort,
} from "./audit/index.js";

// events/ — unified 39-event taxonomy + typed in-process EventBus
export {
  EVENT_CATALOG_VERSION,
  EVENT_CATEGORIES,
  DOMAIN_EVENT_CATALOG,
  isEventCode,
  getEventDefinition,
  EventBus,
} from "./events/index.js";
export type {
  EventCategory,
  EventDefinition,
  EventCode,
  DomainEvent,
  EventHandler,
  EventBusOptions,
} from "./events/index.js";

// notifications/ — tenant-authored rules engine + per-user notification read model
export * from "./notifications/index.js";

// --- access-control cluster (phase0/access-control) ---
export * from "./dates.js";
export * from "./permissions/index.js";
export * from "./workflow/index.js";
export * from "./entitlements/index.js";
export * from "./licensing/index.js";

// --- LAN multi-till (phase0/lan-multitill) ---
export * from "./lan/index.js";

// --- accounts/ — Chart of Accounts (phase1/chart-of-accounts) ---
export * from "./accounts/index.js";

// --- settings foundation cluster (phase0/settings-foundation) ---
export * from "./settings/index.js";

// --- customers/ + suppliers/ — Phase 1 partner master data (phase1/partners) ---
export type { PartnerBase } from "./partners/partner-base.js";
export * from "./customers/index.js";
export * from "./suppliers/index.js";

// --- items/ — Items master data (phase1/items) ---
export * from "./items/index.js";

// --- barcode-config/ — tenant-wide barcode configuration + embedded-barcode parsing ---
export * from "./barcode-config/index.js";

// --- user-preferences/ — per-user shell personalisation (pins, recents, layout, columns) ---
export * from "./user-preferences/index.js";

// --- Phase 1: Users & Roles / Permissions ---
export * from "./roles/index.js";
export * from "./users/index.js";

// --- accounting/treasury master-data cluster (phase1/accounting-master) ---
export * from "./tax-rates/index.js";
export * from "./cost-centers/index.js";
export * from "./treasury-accounts/index.js";
export * from "./fiscal-periods/index.js";

// --- inventory/ — costing + stock-ledger engine (phase2/costing-stock-ledger) ---
export * from "./inventory/index.js";

// --- purchasing/ — purchase chain: PO → GRN → invoice (phase3/purchase-chain) ---
export * from "./purchasing/index.js";

// --- data-migration/ — go-live CSV import preview (customers, suppliers, items, opening balances) ---
export * from "./data-migration/index.js";

// --- reports/ — Report engine abstraction (phase8/report-engine) ---
export * from "./reports/index.js";

// --- sales-invoices/ — Sales Invoices (phase3/sales-invoices) ---
export * from "./sales-invoices/index.js";

// --- documents/ — generic document framework (phase2/document-framework W4) ---
export * from "./documents/index.js";

// --- vouchers/ — Treasury Vouchers (phase4/treasury-vouchers) ---
export * from "./vouchers/index.js";

// --- manufacturing/ — BOMs, work orders, configurable products (phase11/manufacturing) ---
export * from "./manufacturing/index.js";

// --- phase5/6: returns, landed costs, installments (docs/archive/catalog/01, 02, 05) ---
export * from "./sales-returns/index.js";
export * from "./purchase-returns/index.js";
export * from "./landed-costs/index.js";
export * from "./installments/index.js";

// --- credit-control/ — credit-limit warn/block enforcement (phase5/full-sales) ---
export * from "./credit-control/index.js";

// --- price-lists/ — قوائم الأسعار (phase5/full-sales) ---
export * from "./price-lists/index.js";

// --- sales-quotes/ — عروض الأسعار (phase5/full-sales) ---
export * from "./sales-quotes/index.js";

// --- promotions/ — العروض, discount/pricing rules engine (phase5/full-sales) ---
export * from "./promotions/index.js";

// --- accounting depth cluster (phase9/accounting-depth) ---
// exchange-rates/ — FX master data + base-currency conversion + strict rate policy
export * from "./exchange-rates/index.js";
// fx-revaluation/ — period-end FX revaluation with auto-reverse
export * from "./fx-revaluation/index.js";
// currency/ — the supported-currency registry + per-currency AR/AP balances
export * from "./currency/index.js";
// cost-center-pl/ — أرباح مراكز التكلفة (Cost Center P&L)
export * from "./cost-center-pl/index.js";
// reconciliation/ — مطابقة الأرصدة (sub-ledger vs GL control account)
export * from "./reconciliation/index.js";
// eta/ — الفاتورة الإلكترونية (ETA e-invoicing) config + submission queue
export * from "./eta/index.js";
// --- cheques/ — Cheque Register (phase7/treasury-completion) ---
export * from "./cheques/index.js";

// --- bank-reconciliation/ — Bank Statement Reconciliation (phase7/treasury-completion) ---
export * from "./bank-reconciliation/index.js";

// --- crm/ — CRM (phase11) ---
export * from "./crm/index.js";

// --- projects/ — Projects (phase11) ---
export * from "./projects/index.js";

// --- contracting/ — المقاولات (docs/artifacts/mezan-contracting-designs.html) ---
export * from "./contracting/index.js";

// --- fixed-assets/ — Fixed Assets (phase11) ---
export * from "./fixed-assets/index.js";

// --- field-sales/ — Field/Van Sales (phase11) ---
export * from "./field-sales/index.js";

// --- profile/ — self-service account profile (own name/email/phone/password/PIN) ---
export * from "./profile/index.js";



// --- hr-shared/ — stable cross-domain seam (hr/master-data); attendance/leave/payroll depend on this, not hr/ directly ---
export * from "./hr-shared/employee-ref.js";

// --- hr/ — HR master data: employees, departments, job titles, contracts, holidays, leave requests (hr/master-data) ---
export * from "./hr/index.js";

// --- settings/print-template-config.js — the 9-tab print-template designer's persisted shape (w8/print-migration) ---
export { DEFAULT_PRINT_TEMPLATE_CONFIG } from "./settings/print-template-config.js";
export type {
  PrintPageSize,
  LogoPosition,
  LogoSize,
  PrintIdentityConfig,
  PrintHeaderConfig,
  PrintContentConfig,
  PrintColumnsConfig,
  PrintTotalsConfig,
  PrintFooterConfig,
  PrintWatermarkConfig,
  PrintPosReceiptConfig,
  PrintTemplateOverride,
  PrintTemplateConfig,
  PrintTemplateConfigRepository,
} from "./settings/print-template-config.js";

/** Arabic-forgiving search, shared by the server filters and the screens. */
export { normalizeForSearch, matchesSearch } from "./search/arabic.js";

/** Filed VAT returns — the lock that stops a backdated document restating a submitted return. */
export * from "./tax/vat-filing.js";

/** النظام الضريبي المبسط (قانون 6 لسنة 2025) — the statutory table, the recorded election, and the comparison. */
export * from "./tax/simplified-regime-schedule.js";
export * from "./tax/simplified-regime.js";
export * from "./tax/simplified-regime-election.js";
export * from "./tax/simplified-regime-comparison.js";
export * from "./tax/decree-420-books.js";

/** المرفقات — files attached to a document or an entity (R1.4). */
export * from "./attachments/index.js";

/** Unit-of-measure conversion — an entered alternate unit into the base quantity the stock ledger moves. */
export * from "./units/index.js";

/** SaaS platform — tenants, plans, subscriptions and what they entitle. */
export * from "./platform/index.js";

export * from "./pos/index.js";
export * from "./enh/index.js";
