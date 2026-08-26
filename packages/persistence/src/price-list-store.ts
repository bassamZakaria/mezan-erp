import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
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
  is_base: number;
  active: number;
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

function priceListParams(priceList: PriceList) {
  return {
    id: priceList.id,
    code: priceList.code,
    name_ar: priceList.nameAr,
    name_en: priceList.nameEn,
    description: priceList.description,
    is_base: priceList.isBase ? 1 : 0,
    active: priceList.active ? 1 : 0,
    created_at: priceList.createdAt,
  };
}

class SqlitePriceListRepository implements PriceListRepository {
  private readonly insertPriceList: Database.Statement;
  private readonly updatePriceList: Database.Statement;
  private readonly deleteLines: Database.Statement;
  private readonly insertLine: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectLines: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.insertPriceList = sqlite.prepare(`
      INSERT INTO price_list (id, code, name_ar, name_en, description, is_base, active, created_at)
      VALUES (@id, @code, @name_ar, @name_en, @description, @is_base, @active, @created_at)
    `);
    this.updatePriceList = sqlite.prepare(`
      UPDATE price_list SET
        code = @code,
        name_ar = @name_ar,
        name_en = @name_en,
        description = @description,
        is_base = @is_base,
        active = @active,
        created_at = @created_at
      WHERE id = @id
    `);
    this.deleteLines = sqlite.prepare(`DELETE FROM price_list_line WHERE price_list_id = ?`);
    this.insertLine = sqlite.prepare(`
      INSERT INTO price_list_line (price_list_id, line_no, item_id, price, min_qty, unit_code)
      VALUES (@price_list_id, @line_no, @item_id, @price, @min_qty, @unit_code)
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM price_list WHERE id = ?`);
    // Cheapest tier last: `resolvePriceTier` picks by threshold, but a stable
    // ascending order is what the price-list grid renders.
    this.selectLines = sqlite
      .prepare(
        `SELECT item_id, price, min_qty, unit_code FROM price_list_line WHERE price_list_id = ? ORDER BY item_id, min_qty, line_no`,
      )
      .safeIntegers();
  }

  async save(priceList: PriceList): Promise<void> {
    this.insertPriceList.run(priceListParams(priceList));
    this.insertLines(priceList);
  }

  async update(priceList: PriceList): Promise<void> {
    this.updatePriceList.run(priceListParams(priceList));
    this.deleteLines.run(priceList.id);
    this.insertLines(priceList);
  }

  async findById(id: string): Promise<PriceList | null> {
    const row = this.selectById.get(id) as PriceListRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  async list(filter: { active?: boolean } = {}): Promise<readonly PriceList[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.active !== undefined) {
      clauses.push("active = ?");
      params.push(filter.active ? 1 : 0);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.sqlite.prepare(`SELECT * FROM price_list ${where} ORDER BY created_at`).all(...params) as PriceListRow[];
    return rows.map((row) => this.hydrate(row));
  }

  private insertLines(priceList: PriceList): void {
    priceList.lines.forEach((line, index) => {
      this.insertLine.run({
        price_list_id: priceList.id,
        line_no: index,
        item_id: line.itemId,
        price: line.price.toScaledNumber(),
        min_qty: line.minQty.toScaledNumber(),
        unit_code: line.unitCode,
      });
    });
  }

  private hydrate(row: PriceListRow): PriceList {
    const lineRows = this.selectLines.all(row.id) as PriceListLineRow[];
    return {
      id: row.id,
      code: row.code,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      description: row.description,
      isBase: row.is_base === 1,
      active: row.active === 1,
      lines: lineRows.map(toPriceListLine),
      createdAt: row.created_at,
    };
  }
}

export interface SqlitePriceListStoreHandle extends PriceListRepository {
  close(): void;
}

/** Open a SQLite-backed PriceListRepository. ":memory:" for tests, a path for real. */
export function createSqlitePriceListStore(path: SqliteConnectionInput = ":memory:"): SqlitePriceListStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  addMissingColumns(sqlite);
  const repo = new SqlitePriceListRepository(sqlite);
  return Object.assign(repo, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqlitePriceListStoreHandle;
}
