import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { refuseUnlessInserted } from "./insert-new.js";
import { childRowsByParentAsync } from "./list-query.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import { Money, Qty, type PriceList, type PriceListLine, type PriceListRepository } from "@mezan/domain";

/**
 * SQLite-backed {@link PriceListRepository} — header + child-lines pattern
 * (mirrors `createSqliteSalesInvoiceStore`). `price` is INTEGER at Money's
 * fixed 1e-6 scale, never REAL. `update()` replaces the header row and fully
 * re-inserts the lines, since a price-list edit can rewrite the whole line set.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS price_list (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name_ar    TEXT NOT NULL,
  name_en    TEXT,
  description TEXT,
  is_base    INTEGER NOT NULL,
  active     INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS price_list_line (
  price_list_id TEXT NOT NULL REFERENCES price_list(id),
  line_no       INTEGER NOT NULL,
  item_id       TEXT NOT NULL,
  price         INTEGER NOT NULL,
  min_qty       INTEGER NOT NULL DEFAULT 0,
  unit_code     TEXT,
  PRIMARY KEY (price_list_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_price_list_line_price_list ON price_list_line(price_list_id);
`;

/** Tier columns added after the first release — an existing database keeps its rows as the base tier. */
const ADDED_LINE_COLUMNS: readonly [string, string][] = [
  ["min_qty", "INTEGER NOT NULL DEFAULT 0"],
  ["unit_code", "TEXT"],
];

function addMissingColumns(sqlite: Database.Database): void {
  const existing = new Set(
    (sqlite.prepare(`PRAGMA table_info(price_list_line)`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, type] of ADDED_LINE_COLUMNS) {
    if (!existing.has(name)) sqlite.exec(`ALTER TABLE price_list_line ADD COLUMN ${name} ${type}`);
  }
}

interface PriceListRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  is_base: bigint;
  active: bigint;
  created_at: string;
}

interface PriceListLineRow {
  item_id: string;
  price: bigint;
  min_qty: bigint | null;
  unit_code: string | null;
}

function toPriceListLine(row: PriceListLineRow): PriceListLine {
  return {
    itemId: row.item_id,
    unitCode: row.unit_code,
    minQty: Qty.fromScaled(row.min_qty ?? 0n),
    price: Money.fromScaled(row.price),
  };
}

function priceListParams(priceList: PriceList): SqlValue[] {
  return [
    priceList.code,
    priceList.nameAr,
    priceList.nameEn,
    priceList.description,
    priceList.isBase ? 1 : 0,
    priceList.active ? 1 : 0,
    priceList.createdAt,
    priceList.id,
  ];
}

class SqlPriceListRepository implements PriceListRepository {
  constructor(private readonly db: SqlDb) {}

  async save(priceList: PriceList): Promise<void> {
    const inserted = await this.db.run(
      `INSERT INTO price_list (code, name_ar, name_en, description, is_base, active, created_at, id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      priceListParams(priceList),
    );
    refuseUnlessInserted(priceList.id, inserted.changes);
    await this.insertLines(priceList);
  }

  async update(priceList: PriceList): Promise<void> {
    await this.db.run(
      `UPDATE price_list SET code = ?, name_ar = ?, name_en = ?, description = ?, is_base = ?, active = ?, created_at = ?
        WHERE id = ?`,
      priceListParams(priceList),
    );
    await this.db.run(`DELETE FROM price_list_line WHERE price_list_id = ?`, [priceList.id]);
    await this.insertLines(priceList);
  }

  async findById(id: string): Promise<PriceList | null> {
    const row = await this.db.get<PriceListRow>(`SELECT * FROM price_list WHERE id = ?`, [id]);
    return row ? this.hydrate(row) : null;
  }

  async list(filter: { active?: boolean } = {}): Promise<readonly PriceList[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filter.active !== undefined) {
      clauses.push("active = ?");
      params.push(filter.active ? 1 : 0);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.all<PriceListRow>(`SELECT * FROM price_list ${where} ORDER BY created_at`, params);
    const linesByList = await childRowsByParentAsync<PriceListLineRow & { price_list_id: string }>(this.db, {
      table: "price_list_line",
      parentColumn: "price_list_id",
      parentIds: rows.map((row) => row.id),
      orderBy: "price_list_id, item_id, min_qty, line_no",
      columns: "price_list_id, item_id, price, min_qty, unit_code",
    });
    return Promise.all(rows.map((row) => this.hydrate(row, linesByList.get(row.id) ?? [])));
  }

  private async insertLines(priceList: PriceList): Promise<void> {
    for (const [index, line] of priceList.lines.entries()) {
      await this.db.run(
        `INSERT INTO price_list_line (price_list_id, line_no, item_id, price, min_qty, unit_code) VALUES (?, ?, ?, ?, ?, ?)`,
        [priceList.id, index, line.itemId, line.price.scaled, line.minQty.scaled, line.unitCode],
      );
    }
  }

  private async hydrate(row: PriceListRow, preloadedLines?: readonly PriceListLineRow[]): Promise<PriceList> {
    // Cheapest tier last: `resolvePriceTier` picks by threshold, but a stable
    // ascending order is what the price-list grid renders.
    const lineRows =
      preloadedLines ??
      (await this.db.all<PriceListLineRow>(
        `SELECT item_id, price, min_qty, unit_code FROM price_list_line WHERE price_list_id = ? ORDER BY item_id, min_qty, line_no`,
        [row.id],
      ));
    return {
      id: row.id,
      code: row.code,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      description: row.description,
      isBase: Number(row.is_base) === 1,
      active: Number(row.active) === 1,
      lines: lineRows.map(toPriceListLine),
      createdAt: row.created_at,
    };
  }
}

export interface SqlitePriceListStoreHandle extends PriceListRepository {
  close(): void;
}

export async function ensurePriceListSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
}

export function createPriceListStore(db: SqlDb): PriceListRepository {
  return new SqlPriceListRepository(db);
}

/** Open a SQLite-backed PriceListRepository. ":memory:" for tests, a path for real. */
export function createSqlitePriceListStore(path: SqliteConnectionInput = ":memory:"): SqlitePriceListStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  addMissingColumns(sqlite);
  return Object.assign(createPriceListStore(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  });
}
