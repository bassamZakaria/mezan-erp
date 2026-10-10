import Database from "better-sqlite3";
import type { SqliteConnectionInput } from "./sqlite-connection.js";
import { Money, Qty, type LandedCostLine } from "@mezan/domain";
import {
  createSqliteDocumentStore,
  createStandaloneSqliteDocumentStore,
  ensureDocumentTable,
  type SqliteDocumentStoreHandle,
} from "./document-store.js";

const DOC_TYPE = "LANDED_COST";

interface WireCostItem {
  costType: string;
  description: string;
  amount: string;
}

interface WireLine {
  itemId: string;
  warehouseId: string;
  sourceInvoiceId: string;
  sourceInvoiceNumber: string | null;
  qty: string;
  unitCost: string;
  weight?: string;
  allocatedAmount: string;
  newUnitCost: string;
  distributionMethod: string;
  costItems: WireCostItem[];
  /** بُعد المشروع — every line of a confirmed landed-cost document carries the same document-wide value (D-01). */
  projectId?: string | null;
  costCategory?: LandedCostLine["costCategory"];
  branchId?: string | null;
}

function serializeLine(line: LandedCostLine): WireLine {
  return {
    itemId: line.itemId,
    warehouseId: line.warehouseId,
    sourceInvoiceId: line.sourceInvoiceId,
    sourceInvoiceNumber: line.sourceInvoiceNumber,
    qty: line.qty.toString(),
    unitCost: line.unitCost.toString(),
    weight: line.weight.toString(),
    allocatedAmount: line.allocatedAmount.toString(),
    newUnitCost: line.newUnitCost.toString(),
    distributionMethod: line.distributionMethod,
    costItems: line.costItems.map((c) => ({
      costType: c.costType,
      description: c.description,
      amount: c.amount.toString(),
    })),
    projectId: line.projectId ?? null,
    costCategory: line.costCategory ?? null,
    branchId: line.branchId ?? null,
  };
}

function deserializeLine(wire: unknown): LandedCostLine {
  const w = wire as WireLine;
  return {
    itemId: w.itemId,
    warehouseId: w.warehouseId,
    sourceInvoiceId: w.sourceInvoiceId,
    sourceInvoiceNumber: w.sourceInvoiceNumber,
    qty: Qty.fromMajor(w.qty),
    unitCost: Money.fromMajor(w.unitCost),
    // Rows written before the BY_WEIGHT basis existed carry no weight.
    weight: Qty.fromMajor(w.weight ?? "0"),
    allocatedAmount: Money.fromMajor(w.allocatedAmount),
    newUnitCost: Money.fromMajor(w.newUnitCost),
    distributionMethod: w.distributionMethod as LandedCostLine["distributionMethod"],
    costItems: w.costItems.map((c) => ({
      costType: c.costType as LandedCostLine["costItems"][number]["costType"],
      description: c.description,
      amount: Money.fromMajor(c.amount),
    })),
    projectId: w.projectId ?? null,
    costCategory: w.costCategory ?? null,
    branchId: w.branchId ?? null,
  };
}

export function createSqliteLandedCostStore(sqlite: Database.Database) {
  ensureDocumentTable(sqlite);
  return createSqliteDocumentStore<LandedCostLine>(sqlite, DOC_TYPE, serializeLine, deserializeLine);
}

export function createStandaloneSqliteLandedCostStore(path: SqliteConnectionInput = ":memory:"): SqliteDocumentStoreHandle<LandedCostLine> {
  return createStandaloneSqliteDocumentStore<LandedCostLine>(DOC_TYPE, serializeLine, deserializeLine, path);
}
