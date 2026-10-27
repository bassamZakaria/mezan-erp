import type Database from "better-sqlite3";
import type { TaxRateUsage } from "@mezan/domain";
import { SqlDialect, type SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const COLUMN_TABLES = ["journal_line", "sales_invoice_line", "sales_quote_line"] as const;
const JSON_LINE_COLUMNS = [
  { table: "purchase_invoice", column: "lines" },
  { table: "framework_document", column: "lines_json" },
] as const;

export function createTaxRateUsage(db: SqlDb): TaxRateUsage {
  const postgres = db.dialect === SqlDialect.Postgres;
  const tableExistsSql = postgres
    ? `SELECT 1 AS present FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?`
    : `SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?`;
  const hasTable = async (table: string): Promise<boolean> => (await db.get(tableExistsSql, [table])) !== undefined;
  const contains = (column: string) => (postgres ? `strpos(${column}, ?) > 0` : `instr(${column}, ?) > 0`);
  return {
    async isReferenced(taxRateId: string): Promise<boolean> {
      for (const table of COLUMN_TABLES) {
        if ((await hasTable(table)) && (await db.get(`SELECT 1 AS present FROM ${table} WHERE tax_rate_id = ? LIMIT 1`, [taxRateId]))) {
          return true;
        }
      }
      // EXTERNAL CONTRACT: these stores serialise their lines with
      // JSON.stringify, so a line naming the rate holds exactly this fragment.
      const fragment = `"taxRateId":${JSON.stringify(taxRateId)}`;
      for (const { table, column } of JSON_LINE_COLUMNS) {
        if ((await hasTable(table)) && (await db.get(`SELECT 1 AS present FROM ${table} WHERE ${contains(column)} LIMIT 1`, [fragment]))) {
          return true;
        }
      }
      return false;
    },
    async exemptCustomerCount(taxRateId: string): Promise<number> {
      if (!(await hasTable("customer"))) return 0;
      const row = await db.get<{ n: bigint }>(`SELECT COUNT(*) AS n FROM customer WHERE tax_exemption_rate_id = ? AND tax_exempt = 1`, [taxRateId]);
      return Number(row?.n ?? 0);
    },
  };
}

export function createSqliteTaxRateUsage(sqlite: Database.Database): TaxRateUsage {
  return createTaxRateUsage(sqliteDb(sqlite));
}
