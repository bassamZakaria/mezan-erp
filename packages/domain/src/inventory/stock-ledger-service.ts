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
 * atomically (docs/archive/plan.md §2.2). Without it they run directly (tests / simple
 * callers).
 */

import { Money, Qty, allocate } from "../money/index.js";
import { orderLayersForConsumption, type CostLayer } from "./cost-layer.js";
import {
  ExpiredStockError,
  NegativeStockError,
  InvalidStockMovementError,
  SameWarehouseTransferError,
  UncostedDeficitIssueError,
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

/**
 * How much of one landed-cost line the position could actually absorb.
 *
 * `absorbed` raised the cost basis of stock still on hand; `unabsorbed`
 * belongs to units already issued and is a PERIOD cost the caller must post
 * (D84, D135). The two always sum to the line amount.
 */
export interface LandedCostAbsorption {
  readonly absorbed: Money;
  readonly unabsorbed: Money;
}

export interface StockLedgerPolicy {
  /** docs/archive/catalog/09 §"سياسة المخزون" → `allowNegativeStock`: any OUT may drive a position below zero. */
  readonly allowNegativeStock: boolean;
  /**
   * §"سياسة المخزون" → `allowBackorder`: a SALE may be confirmed short, and the
   * shortfall stands as a negative position until stock arrives. Narrower than
   * `allowNegativeStock` on purpose — it never licenses an adjustment or a transfer.
   */
  readonly allowBackorder?: boolean;
}

/**
 * The policy is resolved per movement, not captured at construction: it comes
 * from tenant settings that an administrator can change between two confirms.
 */
export type StockLedgerPolicySource = StockLedgerPolicy | (() => Promise<StockLedgerPolicy> | StockLedgerPolicy);

const BACKORDERABLE_SOURCES: readonly StockSourceDocType[] = ["SALES_INVOICE", "POS_SALE"];

/** Where a deficit issue's unit cost came from — carried on `StockIssuedShort`. */
export type DeficitCostBasis = "last_receipt_here" | "last_receipt_elsewhere" | "item_cost_price";

/** The unit cost of the most recent IN movement in a ledger slice, or null when there was never one. */
function lastReceiptCost(movements: readonly StockMovement[]): Money | null {
  for (let i = movements.length - 1; i >= 0; i -= 1) {
    const m = movements[i] as StockMovement;
    if (m.direction === "IN" && m.unitCost.scaled > 0n) return m.unitCost;
  }
  return null;
}

export interface StockLedgerServiceDeps {
  readonly ledger: StockLedgerRepository;
  readonly layers: CostLayerRepository;
  readonly snapshots: WacSnapshotRepository;
  readonly policy: StockLedgerPolicySource;
  readonly events?: InventoryEventPublisher;
  readonly gl?: InventoryGlPostingPort;
  /** Wraps a compound operation in one atomic transaction. Defaults to direct execution. */
  readonly transaction?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Clock for `occurredAt` defaults. Defaults to `Date.now`-based ISO. */
  readonly clock?: () => string;
  /**
   * Last-resort unit cost for an issue out of a position that holds nothing and
   * was never received anywhere — the item master's تكلفة الشراء. Without it
   * such an issue is refused rather than written at zero (D101).
   */
  readonly fallbackUnitCost?: (itemId: string) => Promise<Money | null> | Money | null;
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

/**
 * A quantity drawn out of one cost layer, with the batch it belonged to.
 *
 * A transfer's IN leg recreates these at the destination. Without it the
 * destination position holds anonymous stock: FEFO has nothing to order by and
 * the expiring-soon report cannot see goods that were merely moved between
 * branches — which is exactly the move a shop makes to clear near-expiry stock.
 */
export interface ConsumedSlice {
  readonly qty: Qty;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
}

export interface PostTransferCommand {
  readonly transferId: string;
  readonly transferNumber?: string | null;
  readonly fromWarehouseId: string;
  readonly toWarehouseId: string;
  readonly lines: readonly TransferLine[];
  readonly occurredAt?: string;
  /**
   * The kind of document that moved the goods. Defaults to `"TRANSFER"` — a
   * stock-transfer document moving its own stock. A work order overrides it:
   * issuing raw material to the shop floor is a transfer in mechanics but a
   * `WORK_ORDER` movement in the ledger, and filing it as a transfer would hide
   * it from the order's own movements feed.
   */
  readonly sourceDocType?: Extract<StockSourceDocType, "TRANSFER" | "WORK_ORDER">;
  /**
   * The document the movement belongs to, when it is NOT the transfer itself
   * (same split as {@link PostReceiptCommand.sourceDocId}). A work order's
   * material issue is keyed `WO-ISSUE:<orderId>` to keep its movement ids clear
   * of the return's, while every movement still files under the order.
   */
  readonly sourceDocId?: string;
}

/** What one leg of a transfer moved, in money — the OUT leg's moving average. */
export interface TransferLineCost {
  readonly itemId: string;
  readonly qty: Qty;
  /** Moving-average unit cost at the SOURCE, which the IN leg reuses verbatim. */
  readonly unitCost: Money;
  /** qty x unitCost — a positive magnitude. */
  readonly cost: Money;
}

/**
 * A transfer is valuation-neutral to the SYSTEM, but not to either warehouse:
 * the caller needs the value that left the source to know what the destination
 * is now holding. A work order accumulates exactly this as its material WIP.
 */
export interface PostTransferResult {
  readonly totalCost: Money;
  readonly lines: readonly TransferLineCost[];
}

export interface ReceiptLine {
  readonly itemId: string;
  readonly qty: Qty;
  /** Receipt-time unit cost booked into the layer and the moving average. */
  readonly unitCost: Money;
  /** Supplier/production lot. Optional — most goods here are not batch-tracked. */
  readonly batchNo?: string | null;
  /** ISO-8601 date the received goods expire; drives FEFO consumption. */
  readonly expiryDate?: string | null;
}

/**
 * A stock IN posting originating from a purchase document (a goods receipt or a
 * manually-entered purchase invoice). Value-affecting on the STOCK ledger only
 * (on-hand, layers, weighted-average) — it deliberately posts NO GL entry: the
 * purchase chain recognises the payable + inventory journal at invoice
 * confirmation, so the stock ledger and the GL are driven separately
 * (docs/archive/catalog/02 §"Document chain").
 */
export interface PostReceiptCommand {
  readonly receiptId: string;
  readonly receiptNumber?: string | null;
  readonly warehouseId: string;
  /** The document that received the goods (a purchase receipt/invoice, or a work-order finished-goods receipt). */
  readonly sourceDocType: Extract<StockSourceDocType, "PURCHASE_RECEIPT" | "PURCHASE_INVOICE" | "WORK_ORDER">;
  /**
   * The document the goods came from, when it is NOT the receipt itself.
   *
   * A purchase receipt is its own source document, so this defaults to
   * `receiptId`. A work order is not: its finished-goods receipt is keyed
   * `WO-RECEIVE:<orderId>` to keep the movement ids clear of the issue's, and
   * without this the receipt filed under a different source document from the
   * issue that fed it — one work order appearing in the ledger as two.
   */
  readonly sourceDocId?: string;
  readonly lines: readonly ReceiptLine[];
  readonly occurredAt?: string;
}

/** One (itemId, warehouseId) position to inspect/reverse for {@link ReverseReceiptCommand}. */
export interface ReverseReceiptPosition {
  readonly itemId: string;
  readonly warehouseId: string;
}

/**
 * Reverse a prior `postReceipt` (docs/archive/catalog/02 — cancelling a purchase
 * receipt/invoice whose "sold-item" guard passed). Unlike `postIssue`, this
 * does NOT draw layers down in consumption order: it removes precisely the cost layer(s) this
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
  /**
   * Sources this ONE line from a warehouse other than the document's — the
   * "sell from another warehouse" rule. The movement, and therefore every
   * balance and report, records the warehouse the goods actually left.
   */
  readonly warehouseId?: string;
}

/**
 * Issue stock OUT against a source document (docs/archive/catalog/01 — a confirmed sales
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
  /** The warehouse the goods actually left — the document's, unless the line named another. */
  readonly warehouseId: string;
  readonly unitCost: Money;
  /** qty × unitCost — the cost of goods issued for this line (a positive magnitude). */
  readonly cost: Money;
}

export interface PostIssueResult {
  readonly totalCost: Money;
  readonly lines: readonly IssueLineCost[];
}

/**
 * What a document's stock plan actually moved, in money.
 *
 * A document cannot post an honest journal entry without this. A purchase
 * return, for instance, credits the supplier at the invoice price but removes
 * stock at the position's live moving average; crediting inventory by the
 * invoice price instead left the sub-ledger and the 1200 control account
 * permanently apart (D47). Signed: positive when the document added value.
 */
export interface DocumentStockPlanResult {
  readonly valueMoved: Money;
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
  private async resolvePolicy(): Promise<StockLedgerPolicy> {
    const source = this.deps.policy;
    return typeof source === "function" ? await source() : source;
  }

  /**
   * The cost to write a deficit issue at, in order of how close it is to what
   * the goods really cost: the last receipt into THIS position, then the last
   * receipt of the same item anywhere, then the item master's cost price.
   * Returns null when the item has never been bought and no fallback is wired
   * — the caller refuses rather than inventing a zero (D101).
   */
  private async resolveDeficitUnitCost(
    itemId: string,
    warehouseId: string,
  ): Promise<{ unitCost: Money; basis: DeficitCostBasis } | null> {
    const here = lastReceiptCost(await this.deps.ledger.listByPosition(itemId, warehouseId));
    if (here) return { unitCost: here, basis: "last_receipt_here" };
    const anywhere = lastReceiptCost(await this.deps.ledger.listByItem(itemId));
    if (anywhere) return { unitCost: anywhere, basis: "last_receipt_elsewhere" };
    const configured = await this.deps.fallbackUnitCost?.(itemId);
    if (configured && configured.scaled > 0n) {
      return { unitCost: configured, basis: "item_cost_price" };
    }
    return null;
  }

  private async negativeAllowedFor(sourceDocType: StockSourceDocType): Promise<boolean> {
    const policy = await this.resolvePolicy();
    if (policy.allowNegativeStock) return true;
    return policy.allowBackorder === true && BACKORDERABLE_SOURCES.includes(sourceDocType);
  }

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
    batchNo?: string | null;
    expiryDate?: string | null;
    /**
     * IN only. Splits the incoming quantity into one cost layer per slice,
     * carrying each slice's batch and expiry, instead of a single anonymous
     * layer. Every layer takes THIS movement's unit cost, not the source
     * layer's, so the leg stays valuation-neutral.
     */
    layerSlices?: readonly ConsumedSlice[];
  }): Promise<{ signedValue: Money; unitCost: Money; consumed: readonly ConsumedSlice[] }> {
    if (input.qty.isNegative() || input.qty.isZero()) {
      throw new InvalidStockMovementError(["الكمية يجب أن تكون رقماً موجباً"]);
    }
    const snap = await this.loadSnapshot(input.itemId, input.warehouseId);

    let unitCost: Money;
    let newOnHand: Qty;
    let newTotalValue: Money;
    let signed: Money;
    let deficit: { shortQty: Qty; costBasis: DeficitCostBasis } | null = null;

    if (input.direction === "IN") {
      if (!input.unitCost) {
        throw new InvalidStockMovementError(["حركة الإدخال تتطلب تكلفة الوحدة"]);
      }
      unitCost = input.unitCost;
      const value = extend(input.qty, unitCost);
      newOnHand = snap.onHand.add(input.qty);
      newTotalValue = snap.totalValue.add(value);
      signed = value;
    } else {
      const projected = snap.onHand.subtract(input.qty);
      if (projected.isNegative() && !(await this.negativeAllowedFor(input.sourceDocType))) {
        throw new NegativeStockError(input.itemId, input.warehouseId, snap.onHand, input.qty);
      }
      unitCost = unitCostOf(snap.totalValue, snap.onHand); // moving average
      // A POSITION WITH NOTHING BEHIND IT HAS NO AVERAGE (D101).
      //
      // `unitCostOf` returns zero for a zero quantity, so an issue out of a
      // position that holds nothing used to be written at 0.00 — understating
      // COGS by the whole deficit, silently, and leaving the layers with no
      // basis to true up when the goods finally arrive. A zero is never the
      // right cost for goods that left the building; the last cost the item was
      // actually bought at is.
      if (unitCost.scaled === 0n && snap.onHand.scaled <= 0n && projected.isNegative()) {
        const fallback = await this.resolveDeficitUnitCost(input.itemId, input.warehouseId);
        if (!fallback) {
          // A transfer is valuation-neutral — both legs take the same cost and
          // total inventory value is unchanged whatever it is — so a basis that
          // cannot be found is not a reason to block the move. Every other
          // source takes value OUT of inventory, and that must not be free.
          if (input.sourceDocType !== "TRANSFER") {
            throw new UncostedDeficitIssueError(input.itemId, input.warehouseId, input.qty);
          }
        } else {
          unitCost = fallback.unitCost;
          deficit = { shortQty: input.qty, costBasis: fallback.basis };
        }
      }
      // A DRAIN TO ZERO TAKES THE WHOLE REMAINING VALUE (D-S44).
      //
      // An issue is normally valued at `qty × round(value ÷ qty)`, and the unit
      // cost is rounded to 1e-6 — so an issue that empties the position leaves
      // up to half a micro-unit of currency PER UNIT of quantity stranded on a
      // position holding nothing. Draining 13.11 units in one movement stranded
      // ~6 micro-currency; a property test caught it, intermittently, and the
      // bound was widened rather than the behaviour fixed.
      //
      // Value with no quantity behind it is not a rounding curiosity: the
      // average is zero by definition once the quantity is, so the residue is
      // invisible on every screen and accumulates per item, per warehouse,
      // forever. The remedy is the standard one — the last issue out of a
      // position is worth whatever is left in it.
      //
      // This is safe to do here, and ONLY here, because the GL posts
      // `signedValue` from this same variable (see `postIssue`): the sub-ledger
      // and the control account move together by construction, so there is no
      // window in which they disagree. `wac.ts`'s replay applies the identical
      // rule, or `cacheDrift` would report this fix as corruption.
      const cogs = projected.isZero() ? snap.totalValue : extend(input.qty, unitCost);
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
      batchNo: input.direction === "IN" ? (input.batchNo ?? null) : null,
      expiryDate: input.direction === "IN" ? (input.expiryDate ?? null) : null,
    };

    await this.deps.ledger.append(movement);

    let consumed: readonly ConsumedSlice[] = [];
    if (input.direction === "IN") {
      const slices =
        input.layerSlices && input.layerSlices.length > 0
          ? input.layerSlices
          : [{ qty: input.qty, batchNo: movement.batchNo, expiryDate: movement.expiryDate }];
      let index = 0;
      for (const slice of slices) {
        const layer: CostLayer = {
          id: slices.length === 1 ? input.movementId : `${input.movementId}:layer:${index}`,
          itemId: input.itemId,
          warehouseId: input.warehouseId,
          unitCost,
          originalQty: slice.qty,
          remainingQty: slice.qty,
          sourceDocType: input.sourceDocType,
          sourceDocId: input.sourceDocId,
          sourceDocNumber: input.sourceDocNumber,
          createdAt: input.occurredAt,
          batchNo: slice.batchNo,
          expiryDate: slice.expiryDate,
        };
        await this.deps.layers.add(layer);
        index += 1;
      }
    } else {
      consumed = await this.consumeLayers(input.itemId, input.warehouseId, input.qty);
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
    if (deficit) {
      this.deps.events?.publish({
        type: "StockIssuedShort",
        movementId: movement.id,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        shortQty: deficit.shortQty,
        unitCost,
        costBasis: deficit.costBasis,
      });
    }

    return { signedValue: signed, unitCost, consumed };
  }

  /**
   * Draw `qty` down across a position's layers, persisting the changes.
   *
   * ORDER: `orderLayersForConsumption` (cost-layer.ts) — FEFO where an expiry
   * is known, receipt order otherwise. The SAME comparator drives the ledger
   * replay in wac.ts; if the two ever diverge, `rebuildPosition` would rewrite
   * the surviving layers into a different set than the live engine produced.
   */
  /**
   * Refuse an issue that would draw on expired stock.
   *
   * Checked against the FEFO head only: layers are consumed expiry-first, so if
   * the first layer is still good nothing behind it can be expired. A layer with
   * no expiry (most goods here) is never expired.
   */
  private async refuseExpiredStock(itemId: string, warehouseId: string, occurredAt: string): Promise<void> {
    const layers = orderLayersForConsumption(await this.deps.layers.listByPosition(itemId, warehouseId));
    const head = layers.find((layer) => !layer.remainingQty.isZero());
    if (!head?.expiryDate) return;
    if (head.expiryDate >= occurredAt.slice(0, 10)) return;
    throw new ExpiredStockError(itemId, warehouseId, head.batchNo ?? null, head.expiryDate);
  }

  private async consumeLayers(itemId: string, warehouseId: string, qty: Qty): Promise<ConsumedSlice[]> {
    const layers = orderLayersForConsumption(await this.deps.layers.listByPosition(itemId, warehouseId));
    const consumed: ConsumedSlice[] = [];
    let remaining = qty;
    for (const layer of layers) {
      if (!remaining.isNegative() && !remaining.isZero()) {
        if (layer.remainingQty.compare(remaining) <= 0) {
          consumed.push({ qty: layer.remainingQty, batchNo: layer.batchNo ?? null, expiryDate: layer.expiryDate ?? null });
          remaining = remaining.subtract(layer.remainingQty);
          await this.deps.layers.remove(layer.id);
        } else {
          consumed.push({ qty: remaining, batchNo: layer.batchNo ?? null, expiryDate: layer.expiryDate ?? null });
          await this.deps.layers.updateRemaining(layer.id, layer.remainingQty.subtract(remaining));
          remaining = Qty.zero();
        }
      }
    }
    // Leftover `remaining` (issue beyond costed layers) only when negative stock
    // is permitted; the drift report surfaces the resulting mismatch.
    return consumed;
  }

  /** Post a stock adjustment (docs/archive/catalog/03 §"تسويات المخزون"). Value-impacting. */
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
      throw new InvalidStockMovementError(["إذن الصرف يحتاج سطراً واحداً على الأقل"]);
    }
    for (let i = 0; i < command.lines.length; i++) {
      const line = command.lines[i] as IssueLine;
      if (line.qty.isNegative() || line.qty.isZero()) {
        throw new InvalidStockMovementError([`السطر ${i}: الكمية يجب أن تكون رقماً موجباً`]);
      }
    }
    const occurredAt = command.occurredAt ?? this.now();

    return this.runInTransaction(async () => {
      const lineCosts: IssueLineCost[] = [];
      let totalCost = Money.zero();

      for (let i = 0; i < command.lines.length; i++) {
        const line = command.lines[i] as IssueLine;
        const warehouseId = line.warehouseId ?? command.warehouseId;
        await this.refuseExpiredStock(line.itemId, warehouseId, occurredAt);
        const { signedValue, unitCost } = await this.applyMovement({
          movementId: `${command.issueId}:${i}`,
          itemId: line.itemId,
          warehouseId,
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
        lineCosts.push({ itemId: line.itemId, qty: line.qty, warehouseId, unitCost, cost });
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

  /** Opening balance — a specialised INITIAL_STOCK adjustment (docs/archive/catalog/03). */
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
   * Post a stock transfer (docs/archive/catalog/03 §"تحويلات المخزون") — VALUATION
   * NEUTRAL: each line issues from the source at the source's moving average
   * and receives into the destination at that SAME unit cost, so total system
   * inventory value is unchanged. Never posts to the GL.
   */
  async postTransfer(command: PostTransferCommand): Promise<PostTransferResult> {
    if (command.fromWarehouseId === command.toWarehouseId) {
      throw new SameWarehouseTransferError(command.fromWarehouseId);
    }
    if (command.lines.length === 0) {
      throw new InvalidStockMovementError(["التحويل يحتاج سطراً واحداً على الأقل"]);
    }
    const occurredAt = command.occurredAt ?? this.now();
    const sourceDocType = command.sourceDocType ?? "TRANSFER";
    const sourceDocId = command.sourceDocId ?? command.transferId;

    return this.runInTransaction(async () => {
      const movementIds: string[] = [];
      const lineCosts: TransferLineCost[] = [];
      let totalCost = Money.zero();

      for (let i = 0; i < command.lines.length; i++) {
        const line = command.lines[i] as TransferLine;
        const outId = `${command.transferId}:out:${i}`;
        const inId = `${command.transferId}:in:${i}`;

        const { unitCost, consumed, signedValue } = await this.applyMovement({
          movementId: outId,
          itemId: line.itemId,
          warehouseId: command.fromWarehouseId,
          direction: "OUT",
          qty: line.qty,
          sourceDocType,
          sourceDocId,
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
          // …and the same batches. Moving goods must not anonymise them: the
          // destination is where FEFO and the expiring-soon report look next.
          layerSlices: consumed,
          sourceDocType,
          sourceDocId,
          sourceDocNumber: command.transferNumber ?? null,
          reason: null,
          occurredAt,
        });

        movementIds.push(outId, inId);
        // OUT signedValue is negative; the value that left the source is its magnitude.
        const cost = signedValue.negate();
        totalCost = totalCost.add(cost);
        lineCosts.push({ itemId: line.itemId, qty: line.qty, unitCost, cost });
      }

      this.deps.events?.publish({
        type: "StockTransferPosted",
        transferId: command.transferId,
        fromWarehouseId: command.fromWarehouseId,
        toWarehouseId: command.toWarehouseId,
        movementIds,
      });

      return { totalCost, lines: lineCosts };
    });
  }

  /**
   * Post a purchase stock IN (docs/archive/catalog/02 — a goods receipt confirming, or a
   * manual purchase invoice confirming without a prior receipt). Each line adds
   * an immutable cost layer at its receipt cost and updates the moving average.
   * Stock-only: NO GL posting (the invoice books inventory + payable + tax).
   */
  async postReceipt(command: PostReceiptCommand): Promise<void> {
    if (command.lines.length === 0) {
      throw new InvalidStockMovementError(["إذن الاستلام يحتاج سطراً واحداً على الأقل"]);
    }
    for (let i = 0; i < command.lines.length; i++) {
      const line = command.lines[i] as ReceiptLine;
      if (line.qty.isNegative() || line.qty.isZero()) {
        throw new InvalidStockMovementError([`السطر ${i}: الكمية يجب أن تكون رقماً موجباً`]);
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
          sourceDocId: command.sourceDocId ?? command.receiptId,
          sourceDocNumber: command.receiptNumber ?? null,
          reason: null,
          occurredAt,
          batchNo: line.batchNo ?? null,
          expiryDate: line.expiryDate ?? null,
        });
      }
    });
  }

  /**
   * Reverse a prior `postReceipt` by `sourceDocId` (docs/archive/catalog/02 — cancelling
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
              `طبقة التكلفة "${layer.id}" للصنف "${pos.itemId}" سُحب منها بالفعل، فلا يمكن عكس "${command.sourceDocId}"`,
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
   * docs/archive/plan.md §3.2).
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
  }): Promise<DocumentStockPlanResult> {
    if (plan.lines.length === 0) return { valueMoved: Money.zero() };
    const occurredAt = plan.occurredAt ?? this.now();

    let valueMoved = Money.zero();
    await this.runInTransaction(async () => {
      for (let i = 0; i < plan.lines.length; i++) {
        const line = plan.lines[i] as (typeof plan.lines)[number];
        const { signedValue } = await this.applyMovement({
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
        valueMoved = valueMoved.add(signedValue);
      }
    });
    return { valueMoved };
  }

  /**
   * Landed-cost revaluation (docs/archive/catalog/02 §"التكاليف الإضافية"): raises the
   * cost basis of an EXISTING position by `valueDelta` with NO quantity change —
   * freight/customs/insurance allocated onto goods already received.
   *
   * It appends a VALUE-ONLY movement and then rebuilds the position from the
   * ledger, so the snapshot and the layers are derived rather than patched.
   * Before this it mutated both directly and appended nothing, which broke the
   * module's founding invariant — the ledger is the single source of truth —
   * and left `replay()` unable to reproduce any position a landed cost had
   * touched, so the drift report read `cacheDrift` nonzero on a healthy tenant
   * while its own docstring said that means the cache is corrupted (D36).
   *
   * The movement is stamped no earlier than the last movement already recorded
   * for the position. This is the ONE deliberate exception to "stamp
   * `occurredAt` with the document date" (D4): a landed cost raises the basis of
   * stock as it stands when the cost becomes known, and dating it earlier would
   * retroactively re-cost issues whose COGS the GL has already posted, putting
   * the sub-ledger permanently out of step with GL 1200.
   *
   * Which layers absorb it is scoped by `revaluesSourceDocId` — the receipt
   * document whose layers the cost belongs to — and the replay allocates it
   * across their remaining quantities by largest remainder.
   *
   * Only the share those goods STILL represent is capitalised. Whatever
   * belongs to units already issued comes back as `unabsorbed`, and the
   * CALLER must post it to cost of sales (or a purchase price variance
   * account) — the landed-cost document debits inventory for the whole amount,
   * so an unabsorbed remainder left unposted is exactly the gap between GL
   * 1200 and the stock valuation report (D84, D135).
   */
  async applyLandedCostRevaluation(line: {
    readonly itemId: string;
    readonly warehouseId: string;
    /** The purchase invoice (or other receipt document) whose layers absorb the cost. */
    readonly sourceDocId: string;
    /** Positive amount to add to this position's cost basis. */
    readonly valueDelta: Money;
    /** The landed-cost document itself, for the movement's source reference. */
    readonly landedCostDocId?: string;
    readonly landedCostDocNumber?: string | null;
    /** Document date of the landed cost; never dated before the position's last movement. */
    readonly occurredAt?: string;
  }): Promise<LandedCostAbsorption> {
    if (line.valueDelta.scaled <= 0n) {
      throw new InvalidStockMovementError([
        `قيمة التكلفة الإضافية للصنف "${line.itemId}" يجب أن تكون موجبة`,
      ]);
    }
    return this.runInTransaction(async () => {
      const movements = await this.deps.ledger.listByPosition(line.itemId, line.warehouseId);
      const before =
        movements.length === 0
          ? emptyPosition(line.itemId, line.warehouseId)
          : replay(line.itemId, line.warehouseId, movements);
      const last = movements[movements.length - 1]?.occurredAt;
      const wanted = line.occurredAt ?? new Date().toISOString();
      const occurredAt = last && last > wanted ? last : wanted;

      await this.deps.ledger.append({
        id: `${line.landedCostDocId ?? line.sourceDocId}:LC:${line.itemId}:${line.warehouseId}`,
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        direction: "IN",
        qty: Qty.zero(),
        unitCost: Money.zero(),
        sourceDocType: "LANDED_COST",
        sourceDocId: line.landedCostDocId ?? line.sourceDocId,
        sourceDocNumber: line.landedCostDocNumber ?? null,
        reason: null,
        occurredAt,
        valueDelta: line.valueDelta,
        revaluesSourceDocId: line.sourceDocId,
      });

      const after = await this.rebuildWithin(line.itemId, line.warehouseId);
      const unabsorbed = Money.fromScaled(
        after.unabsorbedRevaluation.scaled - before.unabsorbedRevaluation.scaled,
      );
      return {
        absorbed: Money.fromScaled(line.valueDelta.scaled - unabsorbed.scaled),
        unabsorbed,
      };
    });
  }

  /** `rebuild`'s body, for callers already inside a transaction. */
  private async rebuildWithin(itemId: string, warehouseId: string): Promise<WacPosition> {
    const movements = await this.deps.ledger.listByPosition(itemId, warehouseId);
    const position =
      movements.length === 0 ? emptyPosition(itemId, warehouseId) : replay(itemId, warehouseId, movements);

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

  /**
   * Every movement a single source document produced, across whatever positions
   * it touched. Derived from the ledger rather than from a list stored on the
   * document, which could not stay right through a reversal.
   */
  async getMovementsOfDocument(sourceDocId: string): Promise<readonly StockMovement[]> {
    return this.movementsOfSourceDoc(sourceDocId);
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

  /**
   * Every warehouse this item sits in, with its on-hand, value and average
   * cost — what the item card's «المخزون حسب المستودع» tab needs. The valuation
   * rollup collapses warehouses, so it cannot answer "where is this stock?".
   */
  async getItemPositions(itemId: string): Promise<readonly WacSnapshot[]> {
    const positions = await this.deps.snapshots.list();
    return positions.filter((p) => p.itemId === itemId);
  }

  /** Open cost layers for one item across every warehouse, oldest first. */
  async getItemCostLayers(itemId: string): Promise<readonly CostLayer[]> {
    const positions = await this.getItemPositions(itemId);
    const layers: CostLayer[] = [];
    for (const position of positions) {
      layers.push(...(await this.deps.layers.listByPosition(itemId, position.warehouseId)));
    }
    return layers
      .filter((layer) => layer.remainingQty.scaled > 0n)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
      unabsorbedRevaluation: Money.zero(),
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
    return this.runInTransaction(async () => this.rebuildWithin(itemId, warehouseId));
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
