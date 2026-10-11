import type Database from "better-sqlite3";
import type { WarehouseUse } from "@mezan/api";

const OPEN_STATUSES = ["draft", "pending"];
const OPEN_PURCHASE_ORDER_STATUSES = ["draft", "sent", "partially_received"];
const OPEN_WORK_ORDER_STATUSES = ["planned", "in_progress"];
const OPEN_VAN_TRIP_STATUSES = ["ongoing"];
const OPEN_COUNT_STATUSES = ["IN_PROGRESS"];
const LINE_WAREHOUSE_KEYS = ["warehouseId", "fromWarehouseId", "toWarehouseId", "sourceWarehouseId", "destinationWarehouseId"];

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * What still ties a warehouse to its branch: stock on its shelves, and
 * documents that have not yet posted. Moving the warehouse to another branch
 * under either would leave a branch's document drawing on another branch's
 * stock.
 */
export function createWarehouseUse(sqlite: Database.Database): (warehouseId: string) => WarehouseUse {
  const lineNamesWarehouse = `EXISTS (SELECT 1 FROM json_each(d.lines_json) line WHERE ${LINE_WAREHOUSE_KEYS.map((key) => `json_extract(line.value, '$.${key}') = @id`).join(" OR ")})`;
  // Prepared on first use: the tables are created by stores mounted after this is wired.
  let statements: { stock: Database.Statement; openDocuments: Database.Statement } | undefined;
  const prepared = () =>
    (statements ??= {
      stock: sqlite.prepare("SELECT 1 FROM wac_snapshot WHERE warehouse_id = ? AND on_hand <> 0 LIMIT 1"),
      openDocuments: sqlite.prepare(`
        SELECT
          (SELECT count(*) FROM sales_invoice WHERE warehouse_id = @id AND status IN (${quoted(OPEN_STATUSES)}))
        + (SELECT count(*) FROM purchase_invoice WHERE warehouse_id = @id AND status IN (${quoted(OPEN_STATUSES)}))
        + (SELECT count(*) FROM purchase_order WHERE warehouse_id = @id AND status IN (${quoted(OPEN_PURCHASE_ORDER_STATUSES)}))
        + (SELECT count(*) FROM goods_receipt WHERE warehouse_id = @id AND status IN (${quoted(OPEN_STATUSES)}))
        + (SELECT count(*) FROM purchase_rfq WHERE warehouse_id = @id AND status IN (${quoted(OPEN_PURCHASE_ORDER_STATUSES)}))
        + (SELECT count(*) FROM framework_document d WHERE d.status IN (${quoted(OPEN_STATUSES)}) AND ${lineNamesWarehouse})
        + (SELECT count(*) FROM stock_adjustment_document d WHERE d.status IN (${quoted(OPEN_STATUSES)}) AND ${lineNamesWarehouse})
        + (SELECT count(*) FROM stock_transfer_document d WHERE d.status IN (${quoted(OPEN_STATUSES)}) AND ${lineNamesWarehouse})
        + (SELECT count(*) FROM work_order WHERE status IN (${quoted(OPEN_WORK_ORDER_STATUSES)}) AND @id IN (source_warehouse_id, wip_warehouse_id, destination_warehouse_id))
        + (SELECT count(*) FROM van_trip WHERE status IN (${quoted(OPEN_VAN_TRIP_STATUSES)}) AND @id IN (van_warehouse_id, source_warehouse_id))
        + (SELECT count(*) FROM physical_count WHERE warehouse_id = @id AND status IN (${quoted(OPEN_COUNT_STATUSES)}))
        AS n
      `),
    });
  return (warehouseId) => ({
    holdsStock: prepared().stock.get(warehouseId) !== undefined,
    openDocuments: (prepared().openDocuments.get({ id: warehouseId }) as { n: number }).n,
  });
}
