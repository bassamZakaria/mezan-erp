import Database from "better-sqlite3";
import type { SqliteConnectionInput } from "./sqlite-connection.js";
import { Money, Qty, type PurchaseReturnLine } from "@mezan/domain";
import {
  createSqliteDocumentStore,
  createStandaloneSqliteDocumentStore,
  ensureDocumentTable,
  type SqliteDocumentStoreHandle,
} from "./document-store.js";

const DOC_TYPE = "PURCHASE_RETURN";

interface WireLine {
  itemId: string;
  warehouseId: string;
  supplierId: string;
  sourceInvoiceId: string;
  sourceInvoiceNumber: string | null;
  reason: string;
  availableQty: string;
  qty: string;
  unitCost: string;
  taxAmount: string;
}

function serializeLine(line: PurchaseReturnLine): WireLine {
  return {
    itemId: line.itemId,
    warehouseId: line.warehouseId,
    supplierId: line.supplierId,
    sourceInvoiceId: line.sourceInvoiceId,
    sourceInvoiceNumber: line.sourceInvoiceNumber,
    reason: line.reason,
    availableQty: line.availableQty.toString(),
    qty: line.qty.toString(),
    unitCost: line.unitCost.toString(),
    taxAmount: line.taxAmount.toString(),
  };
}

function deserializeLine(wire: unknown): PurchaseReturnLine {
  const w = wire as WireLine;
  return {
    itemId: w.itemId,
    warehouseId: w.warehouseId,
    supplierId: w.supplierId,
    sourceInvoiceId: w.sourceInvoiceId,
    sourceInvoiceNumber: w.sourceInvoiceNumber,
    reason: w.reason as PurchaseReturnLine["reason"],
    availableQty: Qty.fromMajor(w.availableQty),
    qty: Qty.fromMajor(w.qty),
    unitCost: Money.fromMajor(w.unitCost),
    taxAmount: Money.fromMajor(w.taxAmount),
  };
}

export function createSqlitePurchaseReturnStore(sqlite: Database.Database) {
  ensureDocumentTable(sqlite);
  return createSqliteDocumentStore<PurchaseReturnLine>(sqlite, DOC_TYPE, serializeLine, deserializeLine);
}

export function createStandaloneSqlitePurchaseReturnStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteDocumentStoreHandle<PurchaseReturnLine> {
  return createStandaloneSqliteDocumentStore<PurchaseReturnLine>(DOC_TYPE, serializeLine, deserializeLine, path);
}
