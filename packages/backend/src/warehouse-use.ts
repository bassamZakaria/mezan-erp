import type Database from "better-sqlite3";
import type { WarehouseUse } from "@mezan/api";
import { LINE_WAREHOUSE_KEY, SETTLED_STATUSES, WAREHOUSE_FAMILIES, hasStatus, linesColumnOf, warehouseColumnsOf, type WarehouseFamily } from "./warehouse-families.js";

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

function openDocumentsSql(sqlite: Database.Database, family: WarehouseFamily): string {
  const columns = warehouseColumnsOf(sqlite, family.table);
  const lines = linesColumnOf(sqlite, family.table);
  const named = [
    ...columns.map((column) => `d.${column} = @id`),
    ...(lines ? [`EXISTS (SELECT 1 FROM json_each(d.${lines}) line, json_each(line.value) field WHERE field.value = @id AND field.type = 'text' AND warehouse_key(field.key) = 1)`] : []),
  ];
  const open = family.openWhere ?? (hasStatus(sqlite, family.table) ? `d.status NOT IN (${quoted(SETTLED_STATUSES)})` : "1 = 1");
  const ofType = family.docType ? ` AND d.doc_type = '${family.docType}'` : "";
  return `(SELECT count(*) FROM ${family.table} d WHERE ${open}${ofType} AND (${named.join(" OR ")}))`;
}

/**
 * What still ties a warehouse to its branch: stock on its shelves, and
 * documents that have not yet posted. Moving the warehouse to another branch
 * under either would leave a branch's document drawing on another branch's
 * stock. The documents are every family of `WAREHOUSE_FAMILIES` — the list the
 * branch boundary reads — so the two cannot disagree about what names a
 * warehouse.
 */
export function createWarehouseUse(sqlite: Database.Database): (warehouseId: string) => WarehouseUse {
  sqlite.function("warehouse_key", { deterministic: true }, (key: unknown) => (typeof key === "string" && LINE_WAREHOUSE_KEY.test(key) ? 1 : 0));
  // Prepared on first use: the tables are created by stores mounted after this is wired.
  let statements: { stock: Database.Statement; openDocuments: Database.Statement } | undefined;
  const prepared = () =>
    (statements ??= {
      stock: sqlite.prepare("SELECT 1 FROM wac_snapshot WHERE warehouse_id = ? AND on_hand <> 0 LIMIT 1"),
      openDocuments: sqlite.prepare(
        `SELECT ${WAREHOUSE_FAMILIES.filter((family) => !family.standing)
          .map((family) => openDocumentsSql(sqlite, family))
          .join(" + ")} AS n`,
      ),
    });
  return (warehouseId) => ({
    holdsStock: prepared().stock.get(warehouseId) !== undefined,
    openDocuments: (prepared().openDocuments.get({ id: warehouseId }) as { n: number }).n,
  });
}
