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
  /** The rate the source invoice line charged. Dropped here, the per-rate VAT split the posting computes cannot survive a reload (D76). */
  taxRatePercent?: number | null;
  taxRateId?: string | null;
  /** بُعد المشروع, inherited from the source invoice. Dropped here, a reload posts an unattributed reversal on the next confirm. */
  projectId?: string | null;
  /** The source invoice's currency and confirm rate (D203). Dropped here, a reload would post the return's foreign digits as base. */
  currency?: string | null;
  fxRate?: string | null;
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
    taxRatePercent: line.taxRatePercent ?? null,
    taxRateId: line.taxRateId ?? null,
    projectId: line.projectId ?? null,
    ...(line.fxRate ? { currency: line.currency ?? null, fxRate: line.fxRate } : {}),
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
    taxRatePercent: w.taxRatePercent ?? null,
    taxRateId: w.taxRateId ?? null,
    projectId: w.projectId ?? null,
    ...(w.fxRate ? { currency: w.currency ?? null, fxRate: w.fxRate } : {}),
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
