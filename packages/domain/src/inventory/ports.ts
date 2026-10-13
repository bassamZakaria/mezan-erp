import type { CostCategory } from "../contracting/cost-category.js";
/**
 * Ports for the stock-ledger / costing engine. The domain depends only on
 * these interfaces — never on SQL, HTTP, or the GL module (docs/archive/plan.md §3.2).
 * A SQLite adapter implements the repositories; the GL module subscribes to the
 * event publisher and/or implements the posting port, so inventory posts COGS
 * and inventory journal entries WITHOUT importing accounting.
 */

import { Money, Qty } from "../money/index.js";
import type { CostLayer } from "./cost-layer.js";
import type { StockMovement, StockSourceDocType } from "./movement.js";
import type { StandingStockRevaluation } from "../landed-costs/errors.js";

/** Append-only stock-ledger store: movements are never updated or deleted. */
export interface StockLedgerRepository {
  append(movement: StockMovement): Promise<void>;
  /** Movements for one position, in ledger order (occurredAt, then insertion). */
  listByPosition(itemId: string, warehouseId: string): Promise<readonly StockMovement[]>;
  latestStandingRevaluation?(itemId: string, warehouseId: string): Promise<StandingStockRevaluation | null>;
  listByItem(itemId: string): Promise<readonly StockMovement[]>;
  listByWarehouse(warehouseId: string): Promise<readonly StockMovement[]>;
  /** Every distinct (itemId, warehouseId) that has at least one movement. */
  listPositions(): Promise<readonly { itemId: string; warehouseId: string }[]>;
  /**
   * Every movement originating from one source-document type, in ledger order.
   * Optional: an implementation that omits it still serves the posted-document
   * read model (posted-stock-documents.ts) through a full-ledger scan, so this
   * is purely the indexed fast path.
   */
  listBySourceDocType?(sourceDocType: StockSourceDocType): Promise<readonly StockMovement[]>;
  /** Every movement originating from ONE source document. Optional, as above. */
  listBySourceDoc?(sourceDocId: string): Promise<readonly StockMovement[]>;
  /**
   * EVERY movement, in position order and then ledger order — the shared slice
   * the inventory reports each filter differently.
   *
   * ORDERING IS PART OF THE CONTRACT: `(itemId, warehouseId, occurredAt, seq)`,
   * so this is byte-for-byte what `listPositions()` followed by a
   * `listByPosition` per position produced — which is what it replaces, at one
   * query instead of one per position (Q-6). Optional on the port; a caller
   * must keep the per-position fallback for implementations without it.
   */
  listAll?(): Promise<readonly StockMovement[]>;
}

/** Immutable cost-layer store. Layers are created on receipt and drawn down on issue. */
export interface CostLayerRepository {
  add(layer: CostLayer): Promise<void>;
  /** Layers for a position in FIFO (receipt) order, including drawn-down remainders. */
  listByPosition(itemId: string, warehouseId: string): Promise<readonly CostLayer[]>;
  /** Persist a new remaining-qty snapshot for a layer (unit cost is immutable). */
  updateRemaining(layerId: string, remainingQty: Qty): Promise<void>;
  /** Remove a fully-consumed layer (remainingQty reached zero). */
  remove(layerId: string): Promise<void>;
  /**
   * EVERY layer, ordered `(itemId, warehouseId, seq)` — the same array a
   * `listByPosition` per position produced, in one query (Q-6). Optional on the
   * port; callers keep the per-position fallback.
   */
  listAll?(): Promise<readonly CostLayer[]>;
}

/** A cached weighted-average snapshot per position (fast reads without a replay). */
export interface WacSnapshot {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly onHand: Qty;
  readonly totalValue: Money;
  readonly averageCost: Money;
}

export interface WacSnapshotRepository {
  get(itemId: string, warehouseId: string): Promise<WacSnapshot | null>;
  save(snapshot: WacSnapshot): Promise<void>;
  list(): Promise<readonly WacSnapshot[]>;
}

// --- Domain events (decoupled from the notification catalog) --------------

export type InventoryDomainEvent =
  | {
      readonly type: "StockMoved";
      readonly movement: StockMovement;
      readonly onHandAfter: Qty;
      readonly averageCostAfter: Money;
    }
  | {
      /**
       * An issue that drove a position below zero against stock that was never
       * received. It is written at a fallback cost rather than at zero (D101);
       * this event is what stops that being silent.
       */
      readonly type: "StockIssuedShort";
      readonly movementId: string;
      readonly itemId: string;
      readonly warehouseId: string;
      readonly shortQty: Qty;
      readonly unitCost: Money;
      readonly costBasis: "last_receipt_here" | "last_receipt_elsewhere" | "item_cost_price";
    }
  | {
      readonly type: "StockAdjustmentPosted";
      readonly adjustmentId: string;
      readonly warehouseId: string;
      readonly reason: string;
      readonly valueDelta: Money;
      readonly movementIds: readonly string[];
    }
  | {
      readonly type: "StockTransferPosted";
      readonly transferId: string;
      readonly fromWarehouseId: string;
      readonly toWarehouseId: string;
      readonly movementIds: readonly string[];
    };

/** Sink for inventory domain events (workflow/notifications/realtime fan-out). */
export interface InventoryEventPublisher {
  publish(event: InventoryDomainEvent): void;
}

// --- GL posting hook (no import of the accounting module) ------------------

export interface InventoryGlPostingLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
  /** بُعد المشروع — the contracting project the line belongs to (D-01). Dropped here, it is gone for good. */
  readonly projectId?: string | null;
  /** فئة التكلفة — only meaningful with `projectId`. */
  readonly costCategory?: CostCategory | null;
}

/**
 * A balanced posting request the inventory engine hands to whoever posts to the
 * GL. The engine builds the Dr/Cr lines (inventory account vs a counterpart —
 * COGS, owner capital for opening balances, a loss account for shrinkage) from
 * the account ids on the command; the accounting module turns this into a real
 * journal entry. Σ debit always equals Σ credit.
 */
export interface InventoryGlPosting {
  readonly sourceDocType: string;
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  readonly date: string;
  readonly memo: string;
  readonly lines: readonly InventoryGlPostingLine[];
  readonly mintedBySystem?: boolean;
}

export interface InventoryGlPostingPort {
  post(posting: InventoryGlPosting): Promise<void>;
  reverse?(entryId: string, opts: { readonly reversalId: string; readonly date: string; readonly memo: string }): Promise<readonly InventoryGlPostingLine[] | null>;
}
