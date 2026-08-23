import {
  Money,
  Qty,
  type AdjustmentReason,
  type DocumentRepository,
  type StockAdjustmentDocLine,
  type StockMovementDirection,
  type StockTransferDocLine,
} from "@mezan/domain";
import { createSqliteFrameworkDocumentStore } from "./framework-document-store.js";
import { createSqlitePhysicalCountStore, type SqlitePhysicalCountStoreHandle } from "./physical-count-store.js";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";

/**
 * phase4/inventory-ops persistence composition root: one SQLite connection
 * backing the Stock Adjustment document table, the Stock Transfer document
 * table, and the Physical Count table (docs/catalog/03). Mirrors
 * `createSqliteStockLedgerStore`'s one-connection-per-related-tables shape.
 */

interface AdjustmentLineWire {
  itemId: string;
  warehouseId: string;
  reason: string;
  direction: string;
  qty: string;
  unitCost: string | null;
}

function adjustmentLineToWire(line: StockAdjustmentDocLine): AdjustmentLineWire {
  return {
    itemId: line.itemId,
    warehouseId: line.warehouseId,
    reason: line.reason,
    direction: line.direction,
    qty: line.qty.toString(),
    unitCost: line.unitCost ? line.unitCost.toString() : null,
  };
}

function adjustmentLineFromWire(wire: unknown): StockAdjustmentDocLine {
  const w = wire as AdjustmentLineWire;
  return {
    itemId: w.itemId,
    warehouseId: w.warehouseId,
    reason: w.reason as AdjustmentReason,
    direction: w.direction as StockMovementDirection,
    qty: Qty.fromMajor(w.qty),
    unitCost: w.unitCost !== null ? Money.fromMajor(w.unitCost) : undefined,
  };
}

interface TransferLineWire {
  itemId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  qty: string;
}

function transferLineToWire(line: StockTransferDocLine): TransferLineWire {
  return {
    itemId: line.itemId,
    fromWarehouseId: line.fromWarehouseId,
    toWarehouseId: line.toWarehouseId,
    qty: line.qty.toString(),
  };
}

function transferLineFromWire(wire: unknown): StockTransferDocLine {
  const w = wire as TransferLineWire;
  return {
    itemId: w.itemId,
    fromWarehouseId: w.fromWarehouseId,
    toWarehouseId: w.toWarehouseId,
    qty: Qty.fromMajor(w.qty),
  };
}

export interface SqliteInventoryOpsStoreHandle {
  readonly stockAdjustments: DocumentRepository<StockAdjustmentDocLine>;
  readonly stockTransfers: DocumentRepository<StockTransferDocLine>;
  readonly physicalCounts: SqlitePhysicalCountStoreHandle;
  close(): void;
}

/**
 * Open a SQLite-backed inventory-ops store. `path` is `":memory:"`/a file path
 * (opens and owns its own connection — every existing standalone/test call
 * site) or an already-open connection to REUSE (create-backend.ts's ONE
 * shared connection — see sqlite-connection.ts's `openSqliteConnection` doc
 * comment for why a second writer connection onto the same file is unsafe).
 */
export function createSqliteInventoryOpsStore(path: SqliteConnectionInput = ":memory:"): SqliteInventoryOpsStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);

  const stockAdjustments = createSqliteFrameworkDocumentStore<StockAdjustmentDocLine>(sqlite, {
    tableName: "stock_adjustment_document",
    docType: "STOCK_ADJUSTMENT",
    lineToWire: adjustmentLineToWire,
    lineFromWire: adjustmentLineFromWire,
  });

  const stockTransfers = createSqliteFrameworkDocumentStore<StockTransferDocLine>(sqlite, {
    tableName: "stock_transfer_document",
    docType: "STOCK_TRANSFER",
    lineToWire: transferLineToWire,
    lineFromWire: transferLineFromWire,
  });

  const physicalCounts = createSqlitePhysicalCountStore(sqlite);

  return {
    stockAdjustments,
    stockTransfers,
    physicalCounts,
    close: () => { if (owned) sqlite.close(); },
  };
}
