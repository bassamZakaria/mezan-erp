/**
 * Document framework (Tier 2 shared abstraction, docs/archive/plan.md §3 + docs/
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
  DocumentApprovalView,
  DocumentEventType,
  DocumentDomainEvent,
  DocumentEventPublisher,
} from "./hooks.js";

export type {
  FrameworkDocument,
  DocumentTypeDefinition,
  DocumentRepository,
  DocumentListFilter,
  DocumentWritePrecondition,
} from "./document.js";
export { DocumentField } from "./document.js";

export {
  DocumentService,
  type DocumentServiceDeps,
  type CreateDraftCommand,
  type ConfirmOptions,
  type CancelOptions,
  type ConfirmResult,
  type ReverseOptions,
} from "./service.js";

export {
  InvalidDocumentTransitionError,
  DocumentNotFoundError,
  DuplicateDocumentError,
  MissingHookError,
  StockPlanDateRequiredError,
  ReversalNotReversibleError,
  InvalidDocumentError,
  DocumentChangedError,
  DocumentReversalRefusedError,
  DocumentResubmitRefusedError,
  UnbookedStockVarianceError,
  assertDocumentWritten,
} from "./errors.js";

export {
  type JournalDocLine,
  type JournalDocument,
  journalDocumentType,
  createJournalGlHook,
  createDocumentWorkflowGate,
} from "./journal-document.js";

export { createInventoryStockHook } from "./inventory-stock-hook.js";

export {
  matchSourceLines,
  overdrawnSourceLines,
  returnedQtyBySourceLine,
  type SourceLineKey,
  type MatchedSourceLine,
  type ReturnableSourceLine,
  type SourceLineRequest,
  type SourceLineMatch,
  type OverdrawnSourceLine,
} from "./match-source-lines.js";

export {
  assertReturnTotalsWithinAvailable,
  createReturnConfirmGuard,
  isStandingReturn,
  type ReturnConfirmGuard,
  type ReturnDocumentLine,
  type ReturnSourceInvoice,
} from "./return-availability.js";

export { ledgerPresenceAsOf, reversalChainPresenceAsOf, type LedgerPresenceInput } from "./as-of.js";

export { approvalLabel, displayAmount as displayApprovalAmount, type ApprovalSubject } from "./approval-label.js";
