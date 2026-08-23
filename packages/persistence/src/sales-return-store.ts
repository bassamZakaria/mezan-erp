import Database from "better-sqlite3";
import type { SqliteConnectionInput } from "./sqlite-connection.js";
import { Money, Qty, type SalesReturnLine } from "@mezan/domain";
import {
  createSqliteDocumentStore,
  createStandaloneSqliteDocumentStore,
  ensureDocumentTable,
  type SqliteDocumentStoreHandle,
} from "./document-store.js";

const DOC_TYPE = "SALES_RETURN";

interface WireLine {
  itemId: string;
  warehouseId: string;
  customerId: string;
  sourceInvoiceId: string;
  sourceInvoiceNumber: string | null;
  reason: string;
  availableQty: string;
  qty: string;
  unitPrice: string;
  unitCost: string;
  taxAmount: string;
}

function serializeLine(line: SalesReturnLine): WireLine {
  return {
    itemId: line.itemId,
    warehouseId: line.warehouseId,
    customerId: line.customerId,
    sourceInvoiceId: line.sourceInvoiceId,
    sourceInvoiceNumber: line.sourceInvoiceNumber,
    reason: line.reason,
    availableQty: line.availableQty.toString(),
    qty: line.qty.toString(),
    unitPrice: line.unitPrice.toString(),
    unitCost: line.unitCost.toString(),
    taxAmount: line.taxAmount.toString(),
  };
}

function deserializeLine(wire: unknown): SalesReturnLine {
  const w = wire as WireLine;
  return {
    itemId: w.itemId,
    warehouseId: w.warehouseId,
    customerId: w.customerId,
    sourceInvoiceId: w.sourceInvoiceId,
    sourceInvoiceNumber: w.sourceInvoiceNumber,
    reason: w.reason as SalesReturnLine["reason"],
    availableQty: Qty.fromMajor(w.availableQty),
    qty: Qty.fromMajor(w.qty),
    unitPrice: Money.fromMajor(w.unitPrice),
    unitCost: Money.fromMajor(w.unitCost),
    taxAmount: Money.fromMajor(w.taxAmount),
  };
}

/** Binds the `SALES_RETURN` document type against a shared connection (also ensures the shared table exists). */
export function createSqliteSalesReturnStore(sqlite: Database.Database) {
  ensureDocumentTable(sqlite);
  return createSqliteDocumentStore<SalesReturnLine>(sqlite, DOC_TYPE, serializeLine, deserializeLine);
}

export function createStandaloneSqliteSalesReturnStore(path: SqliteConnectionInput = ":memory:"): SqliteDocumentStoreHandle<SalesReturnLine> {
  return createStandaloneSqliteDocumentStore<SalesReturnLine>(DOC_TYPE, serializeLine, deserializeLine, path);
}
