export { Money, MONEY_SCALE_DECIMALS } from "./money/index.js";
export type {
  JournalEntry,
  JournalLine,
  JournalRepository,
  UnitOfWork,
} from "./journal.js";
export {
  postJournalEntry,
  UnbalancedEntryError,
  InvalidJournalEntryError,
} from "./post-journal-entry.js";
export type { PostJournalEntryCommand } from "./post-journal-entry.js";

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
