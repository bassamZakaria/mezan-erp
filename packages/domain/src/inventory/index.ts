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
} from "./stock-ledger-service.js";
