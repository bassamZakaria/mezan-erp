/**
 * الجرد الفعلي (Physical Count) — docs/archive/catalog/03 §"الجرد الفعلي": a session
 * over one warehouse that loads system quantities, records counted quantities,
 * computes variance, and — on demand — generates the reconciling stock
 * adjustment (reason `PHYSICAL_COUNT`).
 *
 * Its lifecycle (قيد التنفيذ → مكتمل → تم إنشاء التسوية, + ملغي) does not fit
 * the document framework's draft/confirm state machine (there is no GL/stock
 * effect of the SESSION itself — only the generated adjustment moves stock and
 * posts GL), so this is a bespoke domain service, not a `DocumentTypeDefinition`.
 * "Generate adjustment" is the seam back into the framework: it builds
 * `StockAdjustmentDocLine`s from the counted variance and drives them through
 * the SAME `DocumentService<StockAdjustmentDocLine>` (create draft → confirm)
 * any other adjustment goes through — reusing the adjustment document type,
 * the stock-ledger engine and its GL posting wholesale.
 */

import { Money, Qty } from "../money/index.js";
import type { DocumentService } from "../documents/service.js";
import type { StockAdjustmentDocLine, StockAdjustmentDocument } from "./stock-adjustment-document.js";

export const PHYSICAL_COUNT_STATUSES = [
  "IN_PROGRESS",
  "COMPLETED",
  "ADJUSTMENT_GENERATED",
  "CANCELLED",
] as const;
export type PhysicalCountStatus = (typeof PHYSICAL_COUNT_STATUSES)[number];

export interface PhysicalCountLine {
  readonly itemId: string;
  /** On-hand quantity captured from the ledger when the count was started. */
  readonly systemQty: Qty;
  /**
   * Weighted-average unit cost captured alongside `systemQty` when the count
   * was started, so the variance is valued against the position the counter
   * was actually comparing to — later movements re-average the live WAC.
   */
  readonly unitCost: Money;
  /** Counted quantity — null until entered. */
  readonly countedQty: Qty | null;
}

export interface PhysicalCount {
  readonly id: string;
  readonly countNo: string | null;
  readonly warehouseId: string;
  readonly date: string;
  readonly memo: string;
  readonly status: PhysicalCountStatus;
  /**
   * جرد أعمى — the counter must not see system quantities while counting.
   * The snapshot is still taken and stored; it is the READ side that withholds
   * it until the session is closed (see `revealsSystemQty`).
   */
  readonly blind: boolean;
  readonly lines: readonly PhysicalCountLine[];
  readonly createdAt: string;
  readonly completedAt: string | null;
  /** Id of the stock-adjustment document this count generated, once posted. */
  readonly generatedAdjustmentId: string | null;
}

/** Signed variance for one line: counted − system. Null until counted. */
export function varianceOf(line: PhysicalCountLine): Qty | null {
  return line.countedQty ? line.countedQty.subtract(line.systemQty) : null;
}

/**
 * Whether the system snapshot (and therefore the variance) may be disclosed.
 * A blind count withholds it while counting is still open; closing the session
 * — completed, adjusted or cancelled — reveals it.
 */
export function revealsSystemQty(count: PhysicalCount): boolean {
  return !count.blind || count.status !== "IN_PROGRESS";
}

export interface PhysicalCountListFilter {
  readonly status?: PhysicalCountStatus;
  readonly warehouseId?: string;
}

export interface PhysicalCountRepository {
  save(count: PhysicalCount): Promise<void>;
  update(count: PhysicalCount): Promise<void>;
  findById(id: string): Promise<PhysicalCount | null>;
  list(filter?: PhysicalCountListFilter): Promise<readonly PhysicalCount[]>;
}

/** Bound to the PHYSICAL_COUNT numbering sequence (mirrors DocumentNumberingHook). */
export interface PhysicalCountNumberingHook {
  next(): Promise<{ readonly formatted: string }>;
}

/** Read-only slice of `StockLedgerService` the count session needs. */
export interface StockBalanceReader {
  getBalance(itemId: string, warehouseId: string): Promise<Qty>;
  getBalanceDetail(itemId: string, warehouseId: string): Promise<{ readonly averageCost: Money }>;
}

export class PhysicalCountNotFoundError extends Error {
  readonly code = "PHYSICAL_COUNT_NOT_FOUND";
  constructor(readonly id: string) {
    super(`Physical count "${id}" was not found.`);
    this.name = "PhysicalCountNotFoundError";
  }
}

export class DuplicatePhysicalCountError extends Error {
  readonly code = "DUPLICATE_PHYSICAL_COUNT";
  constructor(readonly id: string) {
    super(`Physical count "${id}" already exists.`);
    this.name = "DuplicatePhysicalCountError";
  }
}

export class InvalidPhysicalCountError extends Error {
  readonly code = "INVALID_PHYSICAL_COUNT";
  constructor(readonly id: string, message: string) {
    super(message);
    this.name = "InvalidPhysicalCountError";
  }
}

/** Raised when an action requires a status the count isn't currently in. */
export class InvalidPhysicalCountStatusError extends Error {
  readonly code = "INVALID_PHYSICAL_COUNT_STATUS";
  constructor(
    readonly id: string,
    readonly status: PhysicalCountStatus,
    readonly expected: readonly PhysicalCountStatus[],
  ) {
    super(
      `Physical count "${id}" is "${status}"; this action requires one of: ${expected.join(", ")}.`,
    );
    this.name = "InvalidPhysicalCountStatusError";
  }
}

export interface PhysicalCountServiceDeps {
  readonly repo: PhysicalCountRepository;
  readonly stockLedger: StockBalanceReader;
  readonly adjustments: DocumentService<StockAdjustmentDocLine>;
  readonly numbering?: PhysicalCountNumberingHook;
  readonly now?: () => string;
}

export interface StartPhysicalCountCommand {
  readonly id: string;
  readonly warehouseId: string;
  readonly date: string;
  readonly memo?: string;
  /** Items to load into the count — the catalog's "loads all available items". */
  readonly itemIds: readonly string[];
  /** جرد أعمى — hide system quantities from the counter until the count closes. */
  readonly blind?: boolean;
}

export interface RecordCountedQtyEntry {
  readonly itemId: string;
  readonly countedQty: Qty;
}

export interface GenerateAdjustmentCommand {
  readonly countId: string;
  /** Id for the generated stock-adjustment document. */
  readonly adjustmentId: string;
  readonly actor?: string;
}

export interface GenerateAdjustmentResult {
  readonly count: PhysicalCount;
  /** Null when every line's variance was zero — nothing needed posting. */
  readonly adjustment: StockAdjustmentDocument | null;
}

/** الجرد الفعلي service: start → record counts → complete → generate adjustment. */
export class PhysicalCountService {
  constructor(private readonly deps: PhysicalCountServiceDeps) {}

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }

  private async require(id: string): Promise<PhysicalCount> {
    const count = await this.deps.repo.findById(id);
    if (!count) throw new PhysicalCountNotFoundError(id);
    return count;
  }

  /** Open a new count session, snapshotting each item's current system qty. */
  async start(cmd: StartPhysicalCountCommand): Promise<PhysicalCount> {
    if (await this.deps.repo.findById(cmd.id)) {
      throw new DuplicatePhysicalCountError(cmd.id);
    }
    if (cmd.itemIds.length === 0) {
      throw new InvalidPhysicalCountError(cmd.id, "الجرد يتطلب صنفاً واحداً على الأقل.");
    }
    const lines: PhysicalCountLine[] = [];
    for (const itemId of cmd.itemIds) {
      const systemQty = await this.deps.stockLedger.getBalance(itemId, cmd.warehouseId);
      const { averageCost } = await this.deps.stockLedger.getBalanceDetail(itemId, cmd.warehouseId);
      lines.push({ itemId, systemQty, unitCost: averageCost, countedQty: null });
    }
    const countNo = this.deps.numbering ? (await this.deps.numbering.next()).formatted : null;
    const count: PhysicalCount = {
      id: cmd.id,
      countNo,
      warehouseId: cmd.warehouseId,
      date: cmd.date,
      memo: cmd.memo ?? "",
      status: "IN_PROGRESS",
      blind: cmd.blind ?? false,
      lines,
      createdAt: this.now(),
      completedAt: null,
      generatedAdjustmentId: null,
    };
    await this.deps.repo.save(count);
    return count;
  }

  /** Enter (or re-enter) counted quantities for a subset of lines. */
  async recordCounts(id: string, entries: readonly RecordCountedQtyEntry[]): Promise<PhysicalCount> {
    const count = await this.require(id);
    if (count.status !== "IN_PROGRESS") {
      throw new InvalidPhysicalCountStatusError(id, count.status, ["IN_PROGRESS"]);
    }
    const byItem = new Map(entries.map((e) => [e.itemId, e.countedQty] as const));
    const lines = count.lines.map((line) => {
      const countedQty = byItem.get(line.itemId);
      return countedQty ? { ...line, countedQty } : line;
    });
    const next: PhysicalCount = { ...count, lines };
    await this.deps.repo.update(next);
    return next;
  }

  /** Close counting once every line has a counted qty; moves to مكتمل. */
  async complete(id: string): Promise<PhysicalCount> {
    const count = await this.require(id);
    if (count.status !== "IN_PROGRESS") {
      throw new InvalidPhysicalCountStatusError(id, count.status, ["IN_PROGRESS"]);
    }
    if (count.lines.some((l) => l.countedQty === null)) {
      throw new InvalidPhysicalCountError(id, "لا يمكن إنهاء الجرد قبل إدخال الكميات المعدودة لكل الأصناف.");
    }
    const next: PhysicalCount = { ...count, status: "COMPLETED", completedAt: this.now() };
    await this.deps.repo.update(next);
    return next;
  }

  /** Cancel a session that hasn't generated its adjustment yet. */
  async cancel(id: string): Promise<PhysicalCount> {
    const count = await this.require(id);
    if (count.status === "ADJUSTMENT_GENERATED" || count.status === "CANCELLED") {
      throw new InvalidPhysicalCountStatusError(id, count.status, ["IN_PROGRESS", "COMPLETED"]);
    }
    const next: PhysicalCount = { ...count, status: "CANCELLED" };
    await this.deps.repo.update(next);
    return next;
  }

  /**
   * توليد تسوية — the count → variance → adjustment step. Builds one
   * `StockAdjustmentDocLine` per non-zero-variance line (reason
   * `PHYSICAL_COUNT`, IN lines priced at the item's current weighted-average
   * cost) and drives them through the SAME adjustment `DocumentService` any
   * other adjustment uses (draft → confirm), so the generated adjustment gets
   * its own number, its own GL posting (via the adjustment's stock hook) and
   * shows up in the adjustments list like any other.
   */
  async generateAdjustment(cmd: GenerateAdjustmentCommand): Promise<GenerateAdjustmentResult> {
    const count = await this.require(cmd.countId);
    if (count.status !== "COMPLETED") {
      throw new InvalidPhysicalCountStatusError(cmd.countId, count.status, ["COMPLETED"]);
    }

    const lines: StockAdjustmentDocLine[] = [];
    for (const line of count.lines) {
      const variance = varianceOf(line);
      if (!variance || variance.isZero()) continue;
      if (variance.isNegative()) {
        lines.push({
          itemId: line.itemId,
          warehouseId: count.warehouseId,
          reason: "PHYSICAL_COUNT",
          direction: "OUT",
          qty: variance.negate(),
        });
      } else {
        const detail = await this.deps.stockLedger.getBalanceDetail(line.itemId, count.warehouseId);
        lines.push({
          itemId: line.itemId,
          warehouseId: count.warehouseId,
          reason: "PHYSICAL_COUNT",
          direction: "IN",
          qty: variance,
          unitCost: detail.averageCost,
        });
      }
    }

    if (lines.length === 0) {
      const next: PhysicalCount = { ...count, status: "ADJUSTMENT_GENERATED", generatedAdjustmentId: null };
      await this.deps.repo.update(next);
      return { count: next, adjustment: null };
    }

    await this.deps.adjustments.createDraft({
      id: cmd.adjustmentId,
      date: count.date,
      memo: `تسوية جرد ${count.countNo ?? count.id}`,
      lines,
    });
    const { document } = await this.deps.adjustments.confirm(cmd.adjustmentId, { actor: cmd.actor });

    const next: PhysicalCount = {
      ...count,
      status: "ADJUSTMENT_GENERATED",
      generatedAdjustmentId: cmd.adjustmentId,
    };
    await this.deps.repo.update(next);
    return { count: next, adjustment: document };
  }

  async findById(id: string): Promise<PhysicalCount | null> {
    return this.deps.repo.findById(id);
  }

  async list(filter?: PhysicalCountListFilter): Promise<readonly PhysicalCount[]> {
    return this.deps.repo.list(filter);
  }
}
