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
  /** The rate the source invoice line charged. Dropped here, the per-rate VAT split the posting computes cannot survive a reload (D76). */
  taxRatePercent?: number | null;
  taxRateId?: string | null;
  /** بُعد المشروع — every line of a confirmed return carries the same document-wide value (D-01). */
  projectId?: string | null;
  costCategory?: PurchaseReturnLine["costCategory"];
  /** The source invoice's currency and confirm rate (D203). Dropped here, a reload would post the return's foreign digits as base. */
  currency?: string | null;
  fxRate?: string | null;
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
    taxRatePercent: line.taxRatePercent ?? null,
    taxRateId: line.taxRateId ?? null,
    projectId: line.projectId ?? null,
    costCategory: line.costCategory ?? null,
    ...(line.fxRate ? { currency: line.currency ?? null, fxRate: line.fxRate } : {}),
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
    taxRatePercent: w.taxRatePercent ?? null,
    taxRateId: w.taxRateId ?? null,
    projectId: w.projectId ?? null,
    costCategory: w.costCategory ?? null,
    ...(w.fxRate ? { currency: w.currency ?? null, fxRate: w.fxRate } : {}),
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
