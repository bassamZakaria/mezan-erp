import { useEffect, useMemo, useState } from "react";
import {
  Money,
  Qty,
  type FrameworkDocument,
  type StockAdjustmentDocLine,
  type StockTransferDocLine,
  type PhysicalCount,
  type StockBalanceRow,
  type AdjustmentReason,
  type StockMovementDirection,
} from "@mezan/domain";
import type { InventoryOpsStore } from "./inventory-ops-store";

export interface StoreResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

async function attempt<T>(fn: () => Promise<T>): Promise<StoreResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A line as the adjustment create form supplies it (major-unit numbers). */
export interface AdjustmentLineDraft {
  itemId: string;
  warehouseId: string;
  reason: AdjustmentReason;
  direction: StockMovementDirection;
  qty: number;
  unitCost?: number;
}

export interface PostAdjustmentCommand {
  date: string;
  memo: string;
  lines: AdjustmentLineDraft[];
}

/** A line as the transfer create form supplies it (major-unit numbers). */
export interface TransferLineDraft {
  itemId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  qty: number;
}

export interface PostTransferCommand {
  date: string;
  memo: string;
  lines: TransferLineDraft[];
}

export interface StartCountCommand {
  warehouseId: string;
  date: string;
  memo?: string;
  itemIds: string[];
}

export interface RecordCountsEntry {
  itemId: string;
  countedQty: number;
}

export interface GenerateAdjustmentFromCountResult {
  count: PhysicalCount;
  adjustment: FrameworkDocument<StockAdjustmentDocLine> | null;
}

function toAdjustmentDomainLines(lines: AdjustmentLineDraft[]): StockAdjustmentDocLine[] {
  return lines.map((l) => ({
    itemId: l.itemId,
    warehouseId: l.warehouseId,
    reason: l.reason,
    direction: l.direction,
    qty: Qty.fromMajor(String(l.qty || 0)),
    unitCost: l.unitCost !== undefined && l.unitCost !== null ? Money.fromMajor(String(l.unitCost)) : undefined,
  }));
}

function toTransferDomainLines(lines: TransferLineDraft[]): StockTransferDocLine[] {
  return lines.map((l) => ({
    itemId: l.itemId,
    fromWarehouseId: l.fromWarehouseId,
    toWarehouseId: l.toWarehouseId,
    qty: Qty.fromMajor(String(l.qty || 0)),
  }));
}

/**
 * React binding over an EXISTING `InventoryOpsStore` instance (see
 * `shared-inventory-ops-store.ts` — one singleton shared by all 4 inventory-ops
 * screens, the same way `useUsersRolesStore` shares one store across the
 * Users/Roles screens). Exposes the current stock adjustments / transfers /
 * physical counts / stock-balance rollup as plain arrays (re-derived on every
 * mutation) plus actions that call straight into the REAL
 * `DocumentService`/`PhysicalCountService`/`StockLedgerService` — so the
 * screens run actual WAC costing, the negative-stock guard, GL posting and
 * document lifecycle, mirroring how `useJournalsStore` drives the Journal
 * Entries screen.
 */
export function useInventoryOpsStore(store: InventoryOpsStore) {
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const stockAdjustments = useMemo(() => store.snapshotAdjustments(), [version]);
  const stockTransfers = useMemo(() => store.snapshotTransfers(), [version]);
  const physicalCounts = useMemo(() => store.snapshotCounts(), [version]);

  const [stockBalance, setStockBalance] = useState<readonly StockBalanceRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    void store.getStockBalance().then((rows) => {
      if (!cancelled) setStockBalance(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  async function postAdjustment(cmd: PostAdjustmentCommand): Promise<StoreResult<FrameworkDocument<StockAdjustmentDocLine>>> {
    const result = await attempt(async () => {
      const id = crypto.randomUUID();
      await store.adjustments.createDraft({ id, date: cmd.date, memo: cmd.memo, lines: toAdjustmentDomainLines(cmd.lines) });
      const confirmed = await store.adjustments.confirm(id, { actor: "demo", actorRoles: ["*"] });
      return confirmed.document;
    });
    if (result.ok) bump();
    return result;
  }

  async function postTransfer(cmd: PostTransferCommand): Promise<StoreResult<FrameworkDocument<StockTransferDocLine>>> {
    const result = await attempt(async () => {
      const id = crypto.randomUUID();
      await store.transfers.createDraft({ id, date: cmd.date, memo: cmd.memo, lines: toTransferDomainLines(cmd.lines) });
      const confirmed = await store.transfers.confirm(id, { actor: "demo", actorRoles: ["*"] });
      return confirmed.document;
    });
    if (result.ok) bump();
    return result;
  }

  async function startCount(cmd: StartCountCommand): Promise<StoreResult<PhysicalCount>> {
    const result = await attempt(() => store.counts.start({ id: crypto.randomUUID(), ...cmd }));
    if (result.ok) bump();
    return result;
  }

  async function recordCounts(id: string, entries: RecordCountsEntry[]): Promise<StoreResult<PhysicalCount>> {
    const result = await attempt(() =>
      store.counts.recordCounts(
        id,
        entries.map((e) => ({ itemId: e.itemId, countedQty: Qty.fromMajor(String(e.countedQty || 0)) })),
      ),
    );
    if (result.ok) bump();
    return result;
  }

  async function completeCount(id: string): Promise<StoreResult<PhysicalCount>> {
    const result = await attempt(() => store.counts.complete(id));
    if (result.ok) bump();
    return result;
  }

  async function cancelCount(id: string): Promise<StoreResult<PhysicalCount>> {
    const result = await attempt(() => store.counts.cancel(id));
    if (result.ok) bump();
    return result;
  }

  async function generateAdjustmentFromCount(id: string): Promise<StoreResult<GenerateAdjustmentFromCountResult>> {
    const result = await attempt(() => store.counts.generateAdjustment({ countId: id, adjustmentId: crypto.randomUUID() }));
    if (result.ok) bump();
    return result;
  }

  return {
    stockAdjustments,
    stockTransfers,
    physicalCounts,
    stockBalance,
    stockLedger: store.stockLedger,
    findJournalEntry: (id: string) => store.findJournalEntry(id),
    postAdjustment,
    postTransfer,
    startCount,
    recordCounts,
    completeCount,
    cancelCount,
    generateAdjustmentFromCount,
  };
}
