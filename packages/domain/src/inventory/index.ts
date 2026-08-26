/**
 * Inventory — the Tier-2 shared costing + stock-ledger engine (docs/plan.md
 * §2.3 / §3, docs/catalog/03). Weighted-average costing with immutable cost
 * layers, a movements ledger, valuation, drift/rebuild, 8 adjustment reasons
 * (incl. INITIAL_STOCK opening balances) and valuation-neutral transfers.
 */

export {
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_DEFINITIONS,
  isAdjustmentReason,
  getAdjustmentReasonDefinition,
  type AdjustmentReason,
  type AdjustmentDirection,
  type AdjustmentReasonDefinition,
} from "./reasons.js";

export {
  STOCK_SOURCE_DOC_TYPES,
  signedQty,
  occurredAtFromDocumentDate,
  signedValue,
  type StockMovement,
  type StockMovementDirection,
  type StockSourceDocType,
} from "./movement.js";

export {
  layerRemainingValue,
  drawDownLayer,
  type CostLayer,
} from "./cost-layer.js";

export { extend, unitCostOf } from "./wac-math.js";

export {
  emptyPosition,
  replay,
  runningBalance,
  checkDrift,
  type WacPosition,
  type DriftReport,
} from "./wac.js";

export {
  NegativeStockError,
  InvalidStockMovementError,
  SameWarehouseTransferError,
} from "./errors.js";

export {
  foldPostedAdjustments,
  foldPostedTransfers,
  filterPostedAdjustments,
  filterPostedTransfers,
  type PostedAdjustmentLine,
  type PostedAdjustment,
  type PostedTransferLine,
  type PostedTransfer,
  type PostedAdjustmentFilter,
  type PostedTransferFilter,
} from "./posted-stock-documents.js";

export type {
  StockLedgerRepository,
  CostLayerRepository,
  WacSnapshotRepository,
  WacSnapshot,
  InventoryDomainEvent,
  InventoryEventPublisher,
  InventoryGlPostingLine,
  InventoryGlPosting,
  InventoryGlPostingPort,
} from "./ports.js";

export {
  StockLedgerService,
  type StockLedgerServiceDeps,
  type StockLedgerPolicy,
  type AdjustmentLine,
  type PostAdjustmentCommand,
  type TransferLine,
  type PostTransferCommand,
  type ReceiptLine,
  type PostReceiptCommand,
  type IssueLine,
  type PostIssueCommand,
  type IssueLineCost,
  type PostIssueResult,
  type ReverseReceiptPosition,
  type ReverseReceiptCommand,
  type DocumentStockPlanResult,
} from "./stock-ledger-service.js";

// --- phase4/inventory-ops — document layer on top of the engine above -----

export {
  type StockAdjustmentDocLine,
  type StockAdjustmentDocument,
  adjustmentHeaderOf,
  stockAdjustmentDocumentType,
} from "./stock-adjustment-document.js";

export {
  type StockTransferDocLine,
  type StockTransferDocument,
  transferHeaderOf,
  stockTransferDocumentType,
} from "./stock-transfer-document.js";

export {
  type AdjustmentGlAccounts,
  createInventoryOpsStockHook,
  createInventoryGlPostingHook,
} from "./document-hooks.js";

export {
  type StockBalanceRow,
  type StockBalanceRollupOptions,
  rollupStockBalance,
} from "./stock-balance.js";

export {
  PHYSICAL_COUNT_STATUSES,
  type PhysicalCountStatus,
  type PhysicalCountLine,
  type PhysicalCount,
  varianceOf,
  revealsSystemQty,
  type PhysicalCountListFilter,
  type PhysicalCountRepository,
  type PhysicalCountNumberingHook,
  type StockBalanceReader,
  PhysicalCountNotFoundError,
  DuplicatePhysicalCountError,
  InvalidPhysicalCountError,
  InvalidPhysicalCountStatusError,
  type PhysicalCountServiceDeps,
  type StartPhysicalCountCommand,
  type RecordCountedQtyEntry,
  type GenerateAdjustmentCommand,
  type GenerateAdjustmentResult,
  PhysicalCountService,
} from "./physical-count.js";

export {
  type PhysicalCountLineVariance,
  type PhysicalCountVarianceSummary,
  lineVarianceOf,
  varianceLinesOf,
  summarizePhysicalCountVariance,
} from "./physical-count-variance.js";

export {
  LABEL_PAGE_SIZES,
  type LabelPageSize,
  type LabelLayout,
  type LabelLayoutRepository,
  type CreateLabelLayoutCommand,
  type UpdateLabelLayoutCommand,
  LabelLayoutNotFoundError,
  DuplicateLabelLayoutCodeError,
  InvalidLabelLayoutError,
  createLabelLayout,
  updateLabelLayout,
  deleteLabelLayout,
  labelsPerPage,
} from "./label-layout.js";
// --- inv/labels-templates-writedown — aging-based inventory write-down ----

export {
  DEFAULT_AGING_WRITEDOWN_POLICY,
  periodEndDate,
  agingDaysBetween,
  writedownRateForAgingDays,
  applyRateBps,
  type AgingBand,
} from "./aging.js";

export {
  type WritedownRunStatus,
  type WritedownRunLine,
  type WritedownRun,
  type WritedownRunRepository,
} from "./writedown-run.js";

export {
  WritedownRunNotFoundError,
  WritedownRunNotDraftError,
  DuplicateWritedownPeriodError,
  NoSlowMovingStockError,
} from "./errors.js";

export { createWritedownRun, type CreateWritedownRunCommand, type CreateWritedownRunDeps } from "./create-writedown-run.js";

export { postWritedownRun, type PostWritedownRunDeps } from "./post-writedown-run.js";

// --- inv/labels-templates-writedown — product templates (attribute CRUD + variant/SKU generator) ---

export {
  variantKey,
  createProductTemplateSpecificationUsage,
  type ProductTemplateAttribute,
  type ProductTemplateStatus,
  type ProductTemplate,
  type ProductTemplateRepository,
  type ProductTemplateVariant,
  type ProductTemplateVariantRepository,
} from "./product-template.js";

export {
  DuplicateProductTemplateCodeError,
  InvalidProductTemplateError,
  ProductTemplateNotFoundError,
  AttributeNotFoundError,
  DuplicateAttributeNameError,
  DuplicateAttributeValueError,
  AttributeInUseError,
  AttributeValueInUseError,
  NoAttributesDefinedError,
  EmptyVariantSelectionError,
  InvalidVariantSelectionError,
} from "./errors.js";

export { createProductTemplate, type CreateProductTemplateCommand } from "./create-product-template.js";

export {
  addTemplateAttribute,
  type AddTemplateAttributeCommand,
  addAttributeValue,
  type AddAttributeValueCommand,
  deleteTemplateAttribute,
  type DeleteTemplateAttributeCommand,
  deleteAttributeValue,
  type DeleteAttributeValueCommand,
} from "./template-attributes.js";

export {
  generateVariants,
  type VariantSelection,
  type GenerateVariantsCommand,
  type GenerateVariantsDeps,
  type GenerateVariantsResult,
} from "./generate-variants.js";

// --- inv/labels-templates-writedown — label printing (3 preset sizes + barcode-fit validation) ---

export {
  LABEL_TEMPLATES,
  isLabelTemplateCode,
  getLabelTemplate,
  type LabelTemplateCode,
  type LabelTemplate,
} from "./label-template.js";

export { checkBarcodeFit, BARCODE_FIT_ERROR_AR, type BarcodeFitResult } from "./barcode-fit.js";

export {
  buildLabelBatch,
  type LabelBatchLineInput,
  type LabelBatchLine,
  type LabelBatch,
} from "./label-batch.js";
