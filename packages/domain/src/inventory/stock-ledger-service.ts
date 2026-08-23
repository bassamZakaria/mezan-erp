/**
 * StockLedgerService — the write path for the costing + stock-ledger engine.
 *
 * It composes the pure WAC primitives (wac.ts / wac-math.ts) with the ports
 * (ports.ts): every quantity change appends an immutable movement, maintains
 * the cached weighted-average snapshot and the immutable cost layers, enforces
 * the negative-stock policy, emits a decoupled domain event, and — for
 * value-impacting adjustments — hands a balanced posting to the GL port
 * (without importing accounting). Transfers are valuation-neutral and never
 * post to the GL.
 *
 * Compound operations (adjustment, transfer) run inside `deps.transaction` when
 * provided, so the movement, the layer, the snapshot and the GL posting commit
 * atomically (docs/plan.md §2.2). Without it they run directly (tests / simple
 * callers).
 */

import { Money, Qty, allocate } from "../money/index.js";
import type { CostLayer } from "./cost-layer.js";
import {
  NegativeStockError,
  InvalidStockMovementError,
  SameWarehouseTransferError,
} from "./errors.js";
import {
  StockMovement,
  StockMovementDirection,
  StockSourceDocType,
} from "./movement.js";
import {
  foldPostedAdjustments,
  foldPostedTransfers,
  filterPostedAdjustments,
  filterPostedTransfers,
  type PostedAdjustment,
  type PostedAdjustmentFilter,
  type PostedTransfer,
  type PostedTransferFilter,
} from "./posted-stock-documents.js";
import { getAdjustmentReasonDefinition, type AdjustmentReason } from "./reasons.js";
import { extend, unitCostOf } from "./wac-math.js";
import { replay, checkDrift, emptyPosition, type WacPosition, type DriftReport } from "./wac.js";
import type {
  StockLedgerRepository,
  CostLayerRepository,
  WacSnapshotRepository,
  WacSnapshot,
  InventoryEventPublisher,
  InventoryGlPostingPort,
  InventoryGlPosting,
} from "./ports.js";

export interface StockLedgerPolicy {
  /** docs/catalog/09 §"سياسة المخزون" → `allowNegativeStock`. */
  readonly allowNegativeStock: boolean;
}

export interface StockLedgerServiceDeps {
  readonly ledger: StockLedgerRepository;
  readonly layers: CostLayerRepository;
  readonly snapshots: WacSnapshotRepository;
  readonly policy: StockLedgerPolicy;
  readonly events?: InventoryEventPublisher;
  readonly gl?: InventoryGlPostingPort;
  /** Wraps a compound operation in one atomic transaction. Defaults to direct execution. */
  readonly transaction?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Clock for `occurredAt` defaults. Defaults to `Date.now`-based ISO. */
  readonly clock?: () => string;
}

export interface AdjustmentLine {
  readonly itemId: string;
  readonly direction: StockMovementDirection;
  readonly qty: Qty;
  /** Required for an IN line (receipt-time cost); ignored for an OUT line. */
  readonly unitCost?: Money;
}

export interface PostAdjustmentCommand {
  readonly adjustmentId: string;
  readonly adjustmentNumber?: string | null;
  readonly warehouseId: string;
  readonly reason: AdjustmentReason;
  readonly lines: readonly AdjustmentLine[];
  readonly occurredAt?: string;
  /**
   * GL account mapping for the balancing journal entry (Dr inventory / Cr
   * counterpart when value rises, reversed when it falls). Omit to skip GL
   * posting entirely (e.g. no GL adapter wired).
   */
  readonly gl?: { readonly inventoryAccountId: string; readonly counterpartAccountId: string };
}

export interface TransferLine {
  readonly itemId: string;
  readonly qty: Qty;
}

export interface PostTransferCommand {
  readonly transferId: string;
  readonly transferNumber?: string | null;
  readonly fromWarehouseId: string;
  readonly toWarehouseId: string;
  readonly lines: readonly TransferLine[];
  readonly occurredAt?: string;
}

export interface ReceiptLine {
  readonly itemId: string;
  readonly qty: Qty;
  /** Receipt-time unit cost booked into the layer and the moving average. */
  readonly unitCost: Money;
}

/**
 * A stock IN posting originating from a purchase document (a goods receipt or a
 * manually-entered purchase invoice). Value-affecting on the STOCK ledger only
 * (on-hand, layers, weighted-average) — it deliberately posts NO GL entry: the
 * purchase chain recognises the payable + inventory journal at invoice
 * confirmation, so the stock ledger and the GL are driven separately
 * (docs/catalog/02 §"Document chain").
 */
export interface PostReceiptCommand {
  readonly receiptId: string;
  readonly receiptNumber?: string | null;
  readonly warehouseId: string;
  /** The document that received the goods (a purchase receipt/invoice, or a work-order finished-goods receipt). */
  readonly sourceDocType: Extract<StockSourceDocType, "PURCHASE_RECEIPT" | "PURCHASE_INVOICE" | "WORK_ORDER">;
  readonly lines: readonly ReceiptLine[];
  readonly occurredAt?: string;
}

/** One (itemId, warehouseId) position to inspect/reverse for {@link ReverseReceiptCommand}. */
export interface ReverseReceiptPosition {
  readonly itemId: string;
  readonly warehouseId: string;
}

/**
 * Reverse a prior `postReceipt` (docs/catalog/02 — cancelling a purchase
 * receipt/invoice whose "sold-item" guard passed). Unlike `postIssue`, this
 * does NOT draw down layers FIFO: it removes precisely the cost layer(s) this
 * `sourceDocId` created, at THEIR OWN immutable cost, and refuses if any of
 * them has already been drawn down (defense in depth — the caller's guard is
 * expected to have checked this already).
 */
export interface ReverseReceiptCommand {
  readonly reversalId: string;
  readonly sourceDocType: StockSourceDocType;
  /** The `sourceDocId` of the original `postReceipt` call being undone. */
  readonly sourceDocId: string;
  readonly positions: readonly ReverseReceiptPosition[];
  readonly occurredAt?: string;
}

/** One line of a document-driven stock issue (a sale, a POS sale…). */
export interface IssueLine {
  readonly itemId: string;
  readonly qty: Qty;
}

/**
 * Issue stock OUT against a source document (docs/catalog/01 — a confirmed sales
 * invoice deducts stock). Each line leaves at the position's moving-average cost,
 * so the caller learns the cost of goods issued (for a Dr COGS / Cr Inventory
 * posting) without re-deriving WAC. Optionally the engine posts that balancing
 * entry itself via the GL port (as `postAdjustment` does); omit `gl` when the
 * caller composes a single combined journal entry (revenue + COGS) instead.
 */
export interface PostIssueCommand {
  readonly issueId: string;
  readonly sourceDocType: StockSourceDocType;
  readonly sourceDocId: string;
  readonly sourceDocNumber?: string | null;
  readonly warehouseId: string;
  readonly lines: readonly IssueLine[];
  readonly occurredAt?: string;
  /** Post Dr COGS / Cr Inventory for the total issued cost. Omit to let the caller post. */
  readonly gl?: { readonly cogsAccountId: string; readonly inventoryAccountId: string };
}

/** The moving-average cost at which one issue line left stock. */
export interface IssueLineCost {
  readonly itemId: string;
  readonly qty: Qty;
  readonly unitCost: Money;
  /** qty × unitCost — the cost of goods issued for this line (a positive magnitude). */
  readonly cost: Money;
}

export interface PostIssueResult {
  readonly totalCost: Money;
  readonly lines: readonly IssueLineCost[];
}

export class StockLedgerService {
  constructor(private readonly deps: StockLedgerServiceDeps) {}

  private now(): string {
    return (this.deps.clock ?? (() => new Date().toISOString()))();
  }

  private runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.deps.transaction ? this.deps.transaction(fn) : fn();
  }

  private async loadSnapshot(itemId: string, warehouseId: string): Promise<WacSnapshot> {
    const existing = await this.deps.snapshots.get(itemId, warehouseId);
    return (
      existing ?? {
        itemId,
        warehouseId,
        onHand: Qty.zero(),
        totalValue: Money.zero(),
        averageCost: Money.zero(),
      }
    );
  }

  /**
   * Core primitive: apply ONE movement to the ledger, layers and snapshot, and
   * emit `StockMoved`. Returns the signed value effect and the unit cost used
   * (the moving average, for an OUT). Not transactional on its own — callers
   * wrap a sequence in `runInTransaction`.
   */
  private async applyMovement(input: {
    movementId: string;
    itemId: string;
    warehouseId: string;
    direction: StockMovementDirection;
    qty: Qty;
    /** For IN: the receipt cost. For OUT: ignored (moving average used). */
    unitCost?: Money;
    sourceDocType: StockSourceDocType;
    sourceDocId: string;
    sourceDocNumber: string | null;
    reason: AdjustmentReason | null;
    occurredAt: string;
  }): Promise<{ signedValue: Money; unitCost: Money }> {
    if (input.qty.isNegative() || input.qty.isZero()) {
      throw new InvalidStockMovementError(["qty must be a positive magnitude"]);
    }
    const snap = await this.loadSnapshot(input.itemId, input.warehouseId);

    let unitCost: Money;
    let newOnHand: Qty;
    let newTotalValue: Money;
    let signed: Money;

    if (input.direction === "IN") {
      if (!input.unitCost) {
        throw new InvalidStockMovementError(["an IN movement requires a unitCost"]);
      }
      unitCost = input.unitCost;
      const value = extend(input.qty, unitCost);
      newOnHand = snap.onHand.add(input.qty);
      newTotalValue = snap.totalValue.add(value);
      signed = value;
    } else {
      const projected = snap.onHand.subtract(input.qty);
      if (projected.isNegative() && !this.deps.policy.allowNegativeStock) {
        throw new NegativeStockError(input.itemId, input.warehouseId, snap.onHand, input.qty);
      }
      unitCost = unitCostOf(snap.totalValue, snap.onHand); // moving average
      const cogs = extend(input.qty, unitCost);
      newOnHand = projected;
      newTotalValue = snap.totalValue.add(cogs.negate());
      signed = cogs.negate();
    }

    const movement: StockMovement = {
      id: input.movementId,
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      direction: input.direction,
      qty: input.qty,
      unitCost,
      sourceDocType: input.sourceDocType,
      sourceDocId: input.sourceDocId,
      sourceDocNumber: input.sourceDocNumber,
      reason: input.reason,
      occurredAt: input.occurredAt,
    };

    await this.deps.ledger.append(movement);

    if (input.direction === "IN") {
      const layer: CostLayer = {
        id: input.movementId,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        unitCost,
        originalQty: input.qty,
        remainingQty: input.qty,
        sourceDocType: input.sourceDocType,
        sourceDocId: input.sourceDocId,
        sourceDocNumber: input.sourceDocNumber,
        createdAt: input.occurredAt,
      };
      await this.deps.layers.add(layer);
    } else {
      await this.consumeLayers(input.itemId, input.warehouseId, input.qty);
    }

    const averageCost = unitCostOf(newTotalValue, newOnHand);
    await this.deps.snapshots.save({
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      onHand: newOnHand,
      totalValue: newTotalValue,
      averageCost,
    });

    this.deps.events?.publish({
      type: "StockMoved",
      movement,
      onHandAfter: newOnHand,
      averageCostAfter: averageCost,
    });

    return { signedValue: signed, unitCost };
  }

  /** Draw `qty` down across a position's layers FIFO, persisting the changes. */
  private async consumeLayers(itemId: string, warehouseId: string, qty: Qty): Promise<void> {
    const layers = await this.deps.layers.listByPosition(itemId, warehouseId);
    let remaining = qty;
    for (const layer of layers) {
      if (!remaining.isNegative() && !remaining.isZero()) {
        if (layer.remainingQty.compare(remaining) <= 0) {
          remaining = remaining.subtract(layer.remainingQty);
          await this.deps.layers.remove(layer.id);
        } else {
          await this.deps.layers.updateRemaining(layer.id, layer.remainingQty.subtract(remaining));
          remaining = Qty.zero();
        }
      }
    }
    // Leftover `remaining` (issue beyond costed layers) only when negative stock
    // is permitted; the drift report surfaces the resulting mismatch.
  }

  /** Post a stock adjustment (docs/catalog/03 §"تسويات المخزون"). Value-impacting. */
  async postAdjustment(command: PostAdjustmentCommand): Promise<void> {
    this.validateAdjustment(command);
    const occurredAt = command.occurredAt ?? this.now();

    await this.runInTransaction(async () => {
      const movementIds: string[] = [];
      let valueDelta = Money.zero();

      for (let i = 0; i < command.lines.length; i++) {
        const line = command.lines[i] as AdjustmentLine;
        const movementId = `${command.adjustmentId}:${i}`;
        movementIds.push(movementId);
        const { signedValue } = await this.applyMovement({
          movementId,
          itemId: line.itemId,
          warehouseId: command.warehouseId,
          direction: line.direction,
          qty: line.qty,
          unitCost: line.unitCost,
          sourceDocType: "ADJUSTMENT",
          sourceDocId: command.adjustmentId,
          sourceDocNumber: command.adjustmentNumber ?? null,
          reason: command.reason,
          occurredAt,
        });
        valueDelta = valueDelta.add(signedValue);
      }

      if (command.gl && this.deps.gl && valueDelta.scaled !== 0n) {
        await this.deps.gl.post(
          buildAdjustmentPosting(command, valueDelta, occurredAt),
        );
      }

      this.deps.events?.publish({
        type: "StockAdjustmentPosted",
        adjustmentId: command.adjustmentId,
        warehouseId: command.warehouseId,
        reason: command.reason,
        valueDelta,
        movementIds,
      });
    });
  }

  /**
   * Issue stock OUT against a source document (a confirmed sales invoice / POS
   * sale). Each line leaves at the moving-average cost; the returned per-line +
   * total cost is the cost of goods sold. When `gl` is supplied the balancing
   * Dr COGS / Cr Inventory entry is posted here; otherwise the caller composes it.
   */
  async postIssue(command: PostIssueCommand): Promise<PostIssueResult> {
    if (command.lines.length === 0) {
      throw new InvalidStockMovementError(["an issue needs at least one line"]);
    }
    for (let i = 0; i < command.lines.length; i++) {
      const line = command.lines[i] as IssueLine;
      if (line.qty.isNegative() || line.qty.isZero()) {
        throw new InvalidStockMovementError([`line ${i}: qty must be a positive magnitude`]);
      }
    }
    const occurredAt = command.occurredAt ?? this.now();

    return this.runInTransaction(async () => {
      const lineCosts: IssueLineCost[] = [];
      let totalCost = Money.zero();

      for (let i = 0; i < command.lines.length; i++) {
        const line = command.lines[i] as IssueLine;
        const { signedValue, unitCost } = await this.applyMovement({
          movementId: `${command.issueId}:${i}`,
          itemId: line.itemId,
          warehouseId: command.warehouseId,
          direction: "OUT",
          qty: line.qty,
          sourceDocType: command.sourceDocType,
          sourceDocId: command.sourceDocId,
          sourceDocNumber: command.sourceDocNumber ?? null,
          reason: null,
          occurredAt,
        });
        // OUT signedValue is negative COGS; the reported cost is its magnitude.
        const cost = signedValue.negate();
        totalCost = totalCost.add(cost);
        lineCosts.push({ itemId: line.itemId, qty: line.qty, unitCost, cost });
      }

      if (command.gl && this.deps.gl && totalCost.scaled !== 0n) {
        await this.deps.gl.post({
          sourceDocType: command.sourceDocType,
          sourceDocId: command.sourceDocId,
          sourceDocNumber: command.sourceDocNumber ?? null,
          date: occurredAt,
          memo: `Stock issue ${command.sourceDocNumber ?? command.sourceDocId}`,
          lines: [
            { accountId: command.gl.cogsAccountId, debit: totalCost, credit: Money.zero() },
            { accountId: command.gl.inventoryAccountId, debit: Money.zero(), credit: totalCost },
          ],
        });
      }

      return { totalCost, lines: lineCosts };
    });
  }

  /** Opening balance — a specialised INITIAL_STOCK adjustment (docs/catalog/03). */
  async recordOpeningBalance(command: Omit<PostAdjustmentCommand, "reason" | "lines"> & {
    readonly lines: readonly { itemId: string; qty: Qty; unitCost: Money }[];
  }): Promise<void> {
    await this.postAdjustment({
      ...command,
      reason: "INITIAL_STOCK",
      lines: command.lines.map((l) => ({
        itemId: l.itemId,
        direction: "IN" as const,
        qty: l.qty,
        unitCost: l.unitCost,
      })),
    });
  }

  /**
   * Post a stock transfer (docs/catalog/03 §"تحويلات المخزون") — VALUATION
   * NEUTRAL: each line issues from the source at the source's moving average
   * and receives into the destination at that SAME unit cost, so total system
   * inventory value is unchanged. Never posts to the GL.
   */
  async postTransfer(command: PostTransferCommand): Promise<void> {
    if (command.fromWarehouseId === command.toWarehouseId) {
      throw new SameWarehouseTransferError(command.fromWarehouseId);
    }
    if (command.lines.length === 0) {
      throw new InvalidStockMovementError(["a transfer needs at least one line"]);
    }
    const occurredAt = command.occurredAt ?? this.now();

    await this.runInTransaction(async () => {
      const movementIds: string[] = [];
      for (let i = 0; i < command.lines.length; i++) {
        const line = command.lines[i] as TransferLine;
        const outId = `${command.transferId}:out:${i}`;
        const inId = `${command.transferId}:in:${i}`;

        const { unitCost } = await this.applyMovement({
          movementId: outId,
          itemId: line.itemId,
          warehouseId: command.fromWarehouseId,
          direction: "OUT",
          qty: line.qty,
          sourceDocType: "TRANSFER",
          sourceDocId: command.transferId,
          sourceDocNumber: command.transferNumber ?? null,
          reason: null,
          occurredAt,
        });

        await this.applyMovement({
          movementId: inId,
          itemId: line.itemId,
          warehouseId: command.toWarehouseId,
          direction: "IN",
          qty: line.qty,
          unitCost, // same unit cost as the OUT leg → system value unchanged
          sourceDocType: "TRANSFER",
          sourceDocId: command.transferId,
          sourceDocNumber: command.transferNumber ?? null,
          reason: null,
          occurredAt,
        });

        movementIds.push(outId, inId);
      }

      this.deps.events?.publish({
        type: "StockTransferPosted",
        transferId: command.transferId,
        fromWarehouseId: command.fromWarehouseId,
        toWarehouseId: command.toWarehouseId,
        movementIds,
      });
    });
  }

  /**
   * Post a purchase stock IN (docs/catalog/02 — a goods receipt confirming, or a
   * manual purchase invoice confirming without a prior receipt). Each line adds
   * an immutable cost layer at its receipt cost and updates the moving average.
   * Stock-only: NO GL posting (the invoice books inventory + payable + tax).
   */
  async postReceipt(command: PostReceiptCommand): Promise<void> {
    if (command.lines.length === 0) {
      throw new InvalidStockMovementError(["a receipt needs at least one line"]);
    }
    for (let i = 0; i < command.lines.length; i++) {
      const line = command.lines[i] as ReceiptLine;
      if (line.qty.isNegative() || line.qty.isZero()) {
        throw new InvalidStockMovementError([`line ${i}: qty must be a positive magnitude`]);
      }
    }
    const occurredAt = command.occurredAt ?? this.now();

    await this.runInTransaction(async () => {
      for (let i = 0; i < command.lines.length; i++) {
        const line = command.lines[i] as ReceiptLine;
        await this.applyMovement({
          movementId: `${command.receiptId}:${i}`,
          itemId: line.itemId,
          warehouseId: command.warehouseId,
          direction: "IN",
          qty: line.qty,
          unitCost: line.unitCost,
          sourceDocType: command.sourceDocType,
          sourceDocId: command.receiptId,
          sourceDocNumber: command.receiptNumber ?? null,
          reason: null,
          occurredAt,
        });
      }
    });
  }

  /**
   * Reverse a prior `postReceipt` by `sourceDocId` (docs/catalog/02 — cancelling
   * a purchase receipt/invoice). For each supplied position, finds the cost
   * layer(s) this `sourceDocId` created and — only if untouched since
   * (`remainingQty === originalQty`) — removes them, subtracts their value from
   * the cached snapshot and appends a mirror-image OUT movement referencing the
   * reversal. Throws if any matching layer has already been drawn down.
   */
  async reverseReceipt(command: ReverseReceiptCommand): Promise<void> {
    const occurredAt = command.occurredAt ?? this.now();

    await this.runInTransaction(async () => {
      for (const pos of command.positions) {
        const layers = await this.deps.layers.listByPosition(pos.itemId, pos.warehouseId);
        const mine = layers.filter((l) => l.sourceDocId === command.sourceDocId);
        for (const layer of mine) {
          if (layer.remainingQty.compare(layer.originalQty) !== 0) {
            throw new InvalidStockMovementError([
              `cost layer "${layer.id}" for item "${pos.itemId}" has already been drawn down; cannot reverse "${command.sourceDocId}"`,
            ]);
          }
        }

        let idx = 0;
        for (const layer of mine) {
          const snap = await this.loadSnapshot(pos.itemId, pos.warehouseId);
          const value = extend(layer.originalQty, layer.unitCost);
          const newOnHand = snap.onHand.subtract(layer.originalQty);
          const newTotalValue = snap.totalValue.add(value.negate());

          const movement: StockMovement = {
            id: `${command.reversalId}:${pos.itemId}:${idx++}`,
            itemId: pos.itemId,
            warehouseId: pos.warehouseId,
            direction: "OUT",
            qty: layer.originalQty,
            unitCost: layer.unitCost,
            sourceDocType: command.sourceDocType,
            sourceDocId: command.reversalId,
            sourceDocNumber: null,
            reason: null,
            occurredAt,
          };
          await this.deps.ledger.append(movement);
          await this.deps.layers.remove(layer.id);
          await this.deps.snapshots.save({
            itemId: pos.itemId,
            warehouseId: pos.warehouseId,
            onHand: newOnHand,
            totalValue: newTotalValue,
            averageCost: unitCostOf(newTotalValue, newOnHand),
          });

          this.deps.events?.publish({
            type: "StockMoved",
            movement,
            onHandAfter: newOnHand,
            averageCostAfter: unitCostOf(newTotalValue, newOnHand),
          });
        }
      }
    });
  }

  /**
   * Generic quantity-movement applier for the document framework's stock hook
   * (`../documents/inventory-stock-hook.ts`). Any document type that declares a
   * `buildStockPlan` — sales/purchase returns, transfers-as-documents, POS sales,
   * work orders — reuses this ONE method instead of a bespoke poster per type;
   * it never posts to the GL itself (a document's own `buildGlPosting` owns that,
   * posted separately by the document framework's GL hook), it only moves qty/
   * cost-layers/snapshot. Structurally identical to `DocumentStockPlan` (kept as
   * a local shape so this engine stays decoupled from the documents module —
   * docs/plan.md §3.2).
   */
  async applyDocumentStockPlan(plan: {
    readonly sourceDocType: StockSourceDocType;
    readonly sourceDocId: string;
    readonly sourceDocNumber: string | null;
    readonly warehouseId: string;
    readonly lines: readonly {
      readonly itemId: string;
      readonly direction: StockMovementDirection;
      readonly qty: Qty;
      readonly unitCost?: Money;
    }[];
    readonly occurredAt?: string;
  }): Promise<void> {
    if (plan.lines.length === 0) return;
    const occurredAt = plan.occurredAt ?? this.now();

    await this.runInTransaction(async () => {
      for (let i = 0; i < plan.lines.length; i++) {
        const line = plan.lines[i] as (typeof plan.lines)[number];
        await this.applyMovement({
          movementId: `${plan.sourceDocId}:${i}`,
          itemId: line.itemId,
          warehouseId: plan.warehouseId,
          direction: line.direction,
          qty: line.qty,
          unitCost: line.unitCost,
          sourceDocType: plan.sourceDocType,
          sourceDocId: plan.sourceDocId,
          sourceDocNumber: plan.sourceDocNumber,
          reason: null,
          occurredAt,
        });
      }
    });
  }

  /**
   * Landed-cost revaluation (docs/catalog/02 §"التكاليف الإضافية"): raises the
   * cost basis of an EXISTING position by `valueDelta` with NO quantity change —
   * freight/customs/insurance allocated onto goods already received. Unlike a
   * normal movement this posts no ledger line (there is no qty to move); it
   * bumps the cached snapshot's `totalValue`/`averageCost` directly, and —
   * scoped to `sourceDocId` (the target purchase invoice) — proportionally
   * raises the unit cost of the SPECIFIC cost layers that invoice's receipt
   * created, by removing + re-adding each layer at its new unit cost (allowed:
   * SQLite's `cost_layer_immutable_cost` trigger only blocks an UPDATE of
   * unit_cost, not a delete+insert). This is the one sanctioned exception to a
   * layer's "immutable receipt-time cost" invariant (cost-layer.ts) — landed
   * cost is, by definition, a retroactive correction to that receipt's true
   * cost. Layers already fully consumed (fully drawn down before the landed
   * cost posts) are skipped for the per-layer step; the snapshot-level value
   * bump still applies so system-wide inventory valuation stays exact.
   */
  async applyLandedCostRevaluation(line: {
    readonly itemId: string;
    readonly warehouseId: string;
    /** The purchase invoice (or other receipt document) whose layers absorb the cost. */
    readonly sourceDocId: string;
    /** Positive amount to add to this position's cost basis. */
    readonly valueDelta: Money;
  }): Promise<void> {
    if (line.valueDelta.scaled <= 0n) {
      throw new InvalidStockMovementError([
        `landed cost valueDelta for item "${line.itemId}" must be positive`,
      ]);
    }
    await this.runInTransaction(async () => {
      const snap = await this.loadSnapshot(line.itemId, line.warehouseId);
      const newTotalValue = snap.totalValue.add(line.valueDelta);
      const newAverageCost = unitCostOf(newTotalValue, snap.onHand);
      await this.deps.snapshots.save({
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        onHand: snap.onHand,
        totalValue: newTotalValue,
        averageCost: newAverageCost,
      });

      const layers = (await this.deps.layers.listByPosition(line.itemId, line.warehouseId)).filter(
        (l) => l.sourceDocId === line.sourceDocId,
      );
      if (layers.length === 0) return;
      const totalOriginalQty = layers.reduce((sum, l) => sum.add(l.originalQty), Qty.zero());
      if (totalOriginalQty.isZero()) return;

      const weights = layers.map((l) => l.originalQty.scaled);
      const shares = allocate(line.valueDelta, weights);
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i] as CostLayer;
        const share = shares[i] as Money;
        if (layer.originalQty.isZero() || share.scaled === 0n) continue;
        const perUnitIncrease = unitCostOf(share, layer.originalQty);
        await this.deps.layers.remove(layer.id);
        await this.deps.layers.add({ ...layer, unitCost: layer.unitCost.add(perUnitIncrease) });
      }
    });
  }

  private validateAdjustment(command: PostAdjustmentCommand): void {
    const reasons: string[] = [];
    if (command.lines.length === 0) reasons.push("an adjustment needs at least one line");
    const def = getAdjustmentReasonDefinition(command.reason);
    for (let i = 0; i < command.lines.length; i++) {
      const line = command.lines[i] as AdjustmentLine;
      if (def.direction !== "EITHER" && line.direction !== def.direction) {
        reasons.push(
          `line ${i}: reason "${command.reason}" requires direction ${def.direction}, got ${line.direction}`,
        );
      }
      if (line.direction === "IN" && !line.unitCost) {
        reasons.push(`line ${i}: an IN line requires a unitCost`);
      }
    }
    if (reasons.length > 0) throw new InvalidStockMovementError(reasons);
  }

  // --- Read side -----------------------------------------------------------

  /** On-hand balance for a position (cached snapshot; 0 if none). */
  async getBalance(itemId: string, warehouseId: string): Promise<Qty> {
    const snap = await this.deps.snapshots.get(itemId, warehouseId);
    return snap?.onHand ?? Qty.zero();
  }

  /** Cached balance detail (on-hand, weighted-average cost, total value) for a position. */
  async getBalanceDetail(itemId: string, warehouseId: string): Promise<WacSnapshot> {
    return this.loadSnapshot(itemId, warehouseId);
  }

  /** Movements for a position in ledger order. */
  async getMovements(itemId: string, warehouseId: string): Promise<readonly StockMovement[]> {
    return this.deps.ledger.listByPosition(itemId, warehouseId);
  }

  /** Every movement in the ledger, gathered position by position. */
  private async allMovements(): Promise<readonly StockMovement[]> {
    const positions = await this.deps.ledger.listPositions();
    const movements: StockMovement[] = [];
    for (const position of positions) {
      movements.push(...(await this.deps.ledger.listByPosition(position.itemId, position.warehouseId)));
    }
    return movements;
  }

  private async movementsOfSourceDocType(
    sourceDocType: StockSourceDocType,
  ): Promise<readonly StockMovement[]> {
    if (this.deps.ledger.listBySourceDocType) {
      return this.deps.ledger.listBySourceDocType(sourceDocType);
    }
    return (await this.allMovements()).filter((m) => m.sourceDocType === sourceDocType);
  }

  private async movementsOfSourceDoc(sourceDocId: string): Promise<readonly StockMovement[]> {
    if (this.deps.ledger.listBySourceDoc) {
      return this.deps.ledger.listBySourceDoc(sourceDocId);
    }
    return (await this.allMovements()).filter((m) => m.sourceDocId === sourceDocId);
  }

  /** Posted stock adjustments, newest first, folded out of the movement ledger. */
  async listPostedAdjustments(
    filter: PostedAdjustmentFilter = {},
  ): Promise<readonly PostedAdjustment[]> {
    const movements = await this.movementsOfSourceDocType("ADJUSTMENT");
    return filterPostedAdjustments(foldPostedAdjustments(movements), filter);
  }

  /** One posted stock adjustment by its source-document id; null when it never posted. */
  async getPostedAdjustment(adjustmentId: string): Promise<PostedAdjustment | null> {
    const movements = await this.movementsOfSourceDoc(adjustmentId);
    return foldPostedAdjustments(movements)[0] ?? null;
  }

  /** Posted stock transfers, newest first, folded out of the movement ledger. */
  async listPostedTransfers(filter: PostedTransferFilter = {}): Promise<readonly PostedTransfer[]> {
    const movements = await this.movementsOfSourceDocType("TRANSFER");
    return filterPostedTransfers(foldPostedTransfers(movements), filter);
  }

  /** One posted stock transfer by its source-document id; null when it never posted. */
  async getPostedTransfer(transferId: string): Promise<PostedTransfer | null> {
    const movements = await this.movementsOfSourceDoc(transferId);
    return foldPostedTransfers(movements)[0] ?? null;
  }

  /** Authoritative position by replaying the ledger (not the cache). */
  async getPosition(itemId: string, warehouseId: string): Promise<WacPosition> {
    const movements = await this.deps.ledger.listByPosition(itemId, warehouseId);
    if (movements.length === 0) return emptyPosition(itemId, warehouseId);
    return replay(itemId, warehouseId, movements);
  }

  /** Cached snapshot valuation across every position that has one. */
  async getValuation(): Promise<{
    readonly positions: readonly WacSnapshot[];
    readonly totalValue: Money;
  }> {
    const positions = await this.deps.snapshots.list();
    return { positions, totalValue: Money.sum(positions.map((p) => p.totalValue)) };
  }

  /** Drift report for one position (cached snapshot vs replayed ledger vs layers). */
  async checkDriftFor(
    itemId: string,
    warehouseId: string,
    tolerance: Money = Money.zero(),
  ): Promise<DriftReport> {
    const snap = await this.loadSnapshot(itemId, warehouseId);
    const cached: WacPosition = {
      itemId,
      warehouseId,
      onHand: snap.onHand,
      totalValue: snap.totalValue,
      averageCost: snap.averageCost,
      layers: await this.deps.layers.listByPosition(itemId, warehouseId),
    };
    const movements = await this.deps.ledger.listByPosition(itemId, warehouseId);
    return checkDrift(cached, movements, tolerance);
  }

  /**
   * Rebuild the cached snapshot AND the cost layers for a position from the
   * ledger (the source of truth), overwriting any drifted cache. Returns the
   * recomputed position.
   */
  async rebuild(itemId: string, warehouseId: string): Promise<WacPosition> {
    return this.runInTransaction(async () => {
      const movements = await this.deps.ledger.listByPosition(itemId, warehouseId);
      const position =
        movements.length === 0
          ? emptyPosition(itemId, warehouseId)
          : replay(itemId, warehouseId, movements);

      const existingLayers = await this.deps.layers.listByPosition(itemId, warehouseId);
      for (const layer of existingLayers) await this.deps.layers.remove(layer.id);
      for (const layer of position.layers) await this.deps.layers.add(layer);

      await this.deps.snapshots.save({
        itemId,
        warehouseId,
        onHand: position.onHand,
        totalValue: position.totalValue,
        averageCost: position.averageCost,
      });
      return position;
    });
  }
}

/** Build the balanced Dr/Cr posting for a value-impacting adjustment. */
function buildAdjustmentPosting(
  command: PostAdjustmentCommand,
  valueDelta: Money,
  date: string,
): InventoryGlPosting {
  const gl = command.gl as { inventoryAccountId: string; counterpartAccountId: string };
  const magnitude = valueDelta.scaled < 0n ? valueDelta.negate() : valueDelta;
  const increased = valueDelta.scaled > 0n;
  // Value up → Dr Inventory / Cr counterpart. Value down → reverse.
  const lines = increased
    ? [
        { accountId: gl.inventoryAccountId, debit: magnitude, credit: Money.zero() },
        { accountId: gl.counterpartAccountId, debit: Money.zero(), credit: magnitude },
      ]
    : [
        { accountId: gl.counterpartAccountId, debit: magnitude, credit: Money.zero() },
        { accountId: gl.inventoryAccountId, debit: Money.zero(), credit: magnitude },
      ];
  return {
    sourceDocType: "ADJUSTMENT",
    sourceDocId: command.adjustmentId,
    sourceDocNumber: command.adjustmentNumber ?? null,
    date,
    memo: `Stock adjustment ${command.adjustmentNumber ?? command.adjustmentId} (${command.reason})`,
    lines,
  };
}
