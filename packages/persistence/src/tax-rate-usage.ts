import type Database from "better-sqlite3";
import type { TaxRateUsage } from "@mezan/domain";

const COLUMN_TABLES = ["journal_line", "sales_invoice_line", "sales_quote_line"] as const;
const JSON_LINE_COLUMNS = [
  { table: "purchase_invoice", column: "lines" },
  { table: "framework_document", column: "lines_json" },
] as const;

/**
 * Whether any stored line names a tax rate. The stores share one books file but
 * each creates its own tables, so a table that is not there yet is simply a
 * place the rate cannot be referenced from.
 */
export function createSqliteTaxRateUsage(sqlite: Database.Database): TaxRateUsage {
  const hasTable = (table: string): boolean =>
    sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !== undefined;
  return {
    async isReferenced(taxRateId: string): Promise<boolean> {
      for (const table of COLUMN_TABLES) {
        if (hasTable(table) && sqlite.prepare(`SELECT 1 FROM ${table} WHERE tax_rate_id = ? LIMIT 1`).get(taxRateId)) {
          return true;
        }
      }
      // EXTERNAL CONTRACT: these stores serialise their lines with
      // JSON.stringify, so a line naming the rate holds exactly this fragment.
      const fragment = `"taxRateId":${JSON.stringify(taxRateId)}`;
      for (const { table, column } of JSON_LINE_COLUMNS) {
        if (hasTable(table) && sqlite.prepare(`SELECT 1 FROM ${table} WHERE instr(${column}, ?) > 0 LIMIT 1`).get(fragment)) {
          return true;
        }
      }
      return false;
    },
  };
}
