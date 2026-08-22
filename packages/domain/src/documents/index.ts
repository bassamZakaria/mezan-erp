/**
 * Document framework (Tier 2 shared abstraction, docs/plan.md §3 + docs/
 * execution-plan.md W4).
 *
 * The generic draft → confirm/post → (cancel | reverse) lifecycle every
 * document module reuses: a state machine with guards, optional numbering /
 * GL-posting / stock-movement / workflow-gate hooks, audit + domain events, and
 * a computed "تأثيرات هذا المستند" effects descriptor feeding the @mezan/ui
 * effects panel. A concrete type plugs in by declaring its lines + which hooks
 * it uses (see `journal-document.ts`, the first proving consumer).
 */

export {
  type DocumentStatus,
  DOCUMENT_TRANSITIONS,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  canTransition,
  assertTransition,
  isActive,
  isTerminal,
} from "./status.js";

export {
  type DocumentEffectKind,
  type DocumentEffect,
  type DocumentEffects,
  buildEffects,
} from "./effects.js";

export type {
  DocumentNumberingHook,
  DocumentGlPostingLine,
  DocumentGlPosting,
  DocumentGlPostingResult,
  DocumentGlHook,
  DocumentStockLine,
  DocumentStockPlan,
  DocumentStockHook,
  DocumentWorkflowInput,
  DocumentWorkflowDecision,
  DocumentWorkflowGate,
  DocumentEventType,
  DocumentDomainEvent,
  DocumentEventPublisher,
} from "./hooks.js";

export type {
  FrameworkDocument,
  DocumentTypeDefinition,
  DocumentRepository,
  DocumentListFilter,
} from "./document.js";

export {
  DocumentService,
  type DocumentServiceDeps,
  type CreateDraftCommand,
  type ConfirmOptions,
  type ConfirmResult,
  type ReverseOptions,
} from "./service.js";

export {
  InvalidDocumentTransitionError,
  DocumentNotFoundError,
  DuplicateDocumentError,
  MissingHookError,
  InvalidDocumentError,
} from "./errors.js";

export {
  type JournalDocLine,
  type JournalDocument,
  journalDocumentType,
  createJournalGlHook,
  createDocumentWorkflowGate,
} from "./journal-document.js";
