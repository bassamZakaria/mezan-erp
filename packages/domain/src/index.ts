export { Money, MONEY_SCALE_DECIMALS } from "./money/index.js";
export type {
  JournalEntry,
  JournalLine,
  JournalRepository,
  JournalEntrySource,
  JournalEntryStatus,
  UnitOfWork,
} from "./journal.js";
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

// numbering/ — 25 sequence definitions + atomic NextNumber service
export {
  SEQUENCE_DEFINITIONS,
  getSequenceDefinition,
  formatSequenceNumber,
  NextNumberService,
} from "./numbering/index.js";
export type {
  SequenceDefinition,
  SequenceCode,
  SequenceStore,
  NextNumberResult,
  NextNumberOptions,
} from "./numbering/index.js";

// audit/ — append-only audit trail (security + sensitive streams)
export {
  AUDIT_SEVERITIES,
  AUDIT_STREAMS,
  createAuditEvent,
  recordSecurityEvent,
  recordSensitiveEvent,
} from "./audit/index.js";
export type {
  AuditSeverity,
  AuditStream,
  AuditEvent,
  AuditEventInput,
  AuditSink,
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

// --- access-control cluster (phase0/access-control) ---
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

// --- Phase 1: Users & Roles / Permissions ---
export * from "./roles/index.js";
export * from "./users/index.js";

// --- accounting/treasury master-data cluster (phase1/accounting-master) ---
export * from "./tax-rates/index.js";
export * from "./cost-centers/index.js";
export * from "./treasury-accounts/index.js";
export * from "./fiscal-periods/index.js";
