import type Database from "better-sqlite3";
import { BranchRecordKind } from "@mezan/api";

const K = BranchRecordKind;

export enum SettledStatus {
  Confirmed = "confirmed",
  Posted = "posted",
  Cancelled = "cancelled",
  Reversed = "reversed",
  PartiallyPaid = "partially_paid",
  Paid = "paid",
  FullyReceived = "fully_received",
  Closed = "closed",
  Completed = "completed",
  Settled = "settled",
  Received = "received",
  CountAdjusted = "ADJUSTMENT_GENERATED",
  CountCancelled = "CANCELLED",
}

/**
 * LEDGER INVARIANT: a document holds its warehouse until its status is one of
 * these. A status nobody has listed counts as open, so a lifecycle state added
 * later keeps a warehouse from being moved under it until someone decides it
 * is settled.
 */
export const SETTLED_STATUSES: readonly string[] = Object.values(SettledStatus);

export interface WarehouseFamily {
  readonly kind: BranchRecordKind;
  readonly table: string;
  readonly numberColumn?: string;
  readonly docType?: string;
  /** What keeps a row open when the table carries no status. */
  readonly openWhere?: string;
  /** A register of things that stand in a warehouse and follow it; never an unposted document. */
  readonly standing?: boolean;
}

/**
 * The ONE list of families whose rows name a warehouse. Which columns and
 * which line keys name it is read from the live schema and the stored lines
 * (`warehouseColumnsOf`, `LINE_WAREHOUSE_KEY`), never listed by hand, and
 * `warehouse-families.test.ts` fails when a table that names a warehouse is
 * missing from here.
 */
export const WAREHOUSE_FAMILIES: readonly WarehouseFamily[] = [
  { kind: K.SalesInvoice, table: "sales_invoice", numberColumn: "doc_no" },
  { kind: K.PurchaseOrder, table: "purchase_order", numberColumn: "number" },
  { kind: K.PurchaseInvoice, table: "purchase_invoice", numberColumn: "number" },
  { kind: K.GoodsReceipt, table: "goods_receipt", numberColumn: "number" },
  { kind: K.Rfq, table: "purchase_rfq", numberColumn: "number" },
  { kind: K.PhysicalCount, table: "physical_count", numberColumn: "count_no" },
  { kind: K.WorkOrder, table: "work_order", numberColumn: "number" },
  { kind: K.VanTrip, table: "van_trip" },
  { kind: K.WritedownRun, table: "writedown_run" },
  { kind: K.StockAdjustment, table: "stock_adjustment_document", numberColumn: "doc_no" },
  { kind: K.StockTransfer, table: "stock_transfer_document", numberColumn: "doc_no" },
  { kind: K.SalesReturn, table: "framework_document", numberColumn: "doc_no", docType: "SALES_RETURN" },
  { kind: K.PurchaseReturn, table: "framework_document", numberColumn: "doc_no", docType: "PURCHASE_RETURN" },
  { kind: K.LandedCost, table: "framework_document", numberColumn: "doc_no", docType: "LANDED_COST" },
  { kind: K.InstallmentPlan, table: "framework_document", numberColumn: "doc_no", docType: "INSTALLMENT_PLAN" },
  { kind: K.MaterialConsumption, table: "material_consumption", numberColumn: "doc_no" },
  { kind: K.SiteIssue, table: "site_issue", numberColumn: "doc_no" },
  { kind: K.SiteCustody, table: "site_custody", openWhere: "d.qty_out > d.qty_returned" },
  { kind: K.Asset, table: "asset", standing: true },
  { kind: K.Van, table: "van", standing: true },
  { kind: K.PosTerminal, table: "pos_terminal", standing: true },
];

/** Tables that name a warehouse and are the stock ledger itself, not a document standing on it. */
export const WAREHOUSE_LEDGER_TABLES: Readonly<Record<string, string>> = {
  stock_movement: "the movement ledger; a posted document is read through it",
  wac_snapshot: "the on-hand position, which `holdsStock` reads",
  cost_layer: "cost layers of stock already received",
};

const WAREHOUSE_COLUMN = /(^|_)warehouse_id$/;
const LINES_COLUMN = /^lines(_json)?$/;
export const LINE_WAREHOUSE_KEY = /^(warehouseId|[a-z][A-Za-z]*WarehouseId)$/;

function columnsOf(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((column) => column.name);
}

export function warehouseColumnsOf(sqlite: Database.Database, table: string): string[] {
  return columnsOf(sqlite, table).filter((column) => WAREHOUSE_COLUMN.test(column));
}

export function linesColumnOf(sqlite: Database.Database, table: string): string | null {
  return columnsOf(sqlite, table).find((column) => LINES_COLUMN.test(column)) ?? null;
}

export function hasStatus(sqlite: Database.Database, table: string): boolean {
  return columnsOf(sqlite, table).includes("status");
}

export function lineWarehousesOf(linesJson: unknown): string[] {
  if (typeof linesJson !== "string") return [];
  let lines: unknown;
  try {
    lines = JSON.parse(linesJson);
  } catch {
    return [];
  }
  if (!Array.isArray(lines)) return [];
  return lines.flatMap((line) =>
    line !== null && typeof line === "object"
      ? Object.entries(line as Record<string, unknown>)
          .filter(([key, value]) => LINE_WAREHOUSE_KEY.test(key) && typeof value === "string" && value !== "")
          .map(([, value]) => value as string)
      : [],
  );
}
