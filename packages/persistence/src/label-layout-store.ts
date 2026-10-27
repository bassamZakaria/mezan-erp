import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { LabelLayout, LabelLayoutRepository, LabelPageSize } from "@mezan/domain";
import { insertNew } from "./insert-new.js";
import { placeholders, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

/** LabelLayoutRepository (docs/archive/catalog/03 §"طباعة الباركود والملصقات"). */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS label_layout (
  id                 TEXT PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,
  name_ar            TEXT NOT NULL,
  page_size          TEXT NOT NULL,
  columns_count      INTEGER NOT NULL,
  rows_count         INTEGER NOT NULL,
  label_width_mm     REAL NOT NULL,
  label_height_mm    REAL NOT NULL,
  column_gap_mm      REAL NOT NULL,
  row_gap_mm         REAL NOT NULL,
  margin_block_mm    REAL NOT NULL,
  margin_inline_mm   REAL NOT NULL,
  show_item_name     INTEGER NOT NULL,
  show_item_code     INTEGER NOT NULL,
  show_price         INTEGER NOT NULL,
  show_unit          INTEGER NOT NULL,
  show_barcode       INTEGER NOT NULL,
  show_barcode_text  INTEGER NOT NULL,
  barcode_height_mm  REAL NOT NULL,
  active             INTEGER NOT NULL
);
`;

type LabelLayoutRow = Record<string, unknown> & { id: string; code: string; name_ar: string; page_size: string };

const COLUMNS = [
  "id", "code", "name_ar", "page_size", "columns_count", "rows_count", "label_width_mm", "label_height_mm",
  "column_gap_mm", "row_gap_mm", "margin_block_mm", "margin_inline_mm", "show_item_name", "show_item_code",
  "show_price", "show_unit", "show_barcode", "show_barcode_text", "barcode_height_mm", "active",
] as const;

const UPSERT = `INSERT INTO label_layout (${COLUMNS.join(", ")}) VALUES (${placeholders(COLUMNS.length)})
ON CONFLICT(id) DO UPDATE SET ${COLUMNS.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ")}`;

const flag = (value: unknown): boolean => Number(value) === 1;

function toLayout(row: LabelLayoutRow): LabelLayout {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    pageSize: row.page_size as LabelPageSize,
    columns: Number(row.columns_count),
    rows: Number(row.rows_count),
    labelWidthMm: Number(row.label_width_mm),
    labelHeightMm: Number(row.label_height_mm),
    columnGapMm: Number(row.column_gap_mm),
    rowGapMm: Number(row.row_gap_mm),
    marginBlockMm: Number(row.margin_block_mm),
    marginInlineMm: Number(row.margin_inline_mm),
    showItemName: flag(row.show_item_name),
    showItemCode: flag(row.show_item_code),
    showPrice: flag(row.show_price),
    showUnit: flag(row.show_unit),
    showBarcode: flag(row.show_barcode),
    showBarcodeText: flag(row.show_barcode_text),
    barcodeHeightMm: Number(row.barcode_height_mm),
    active: flag(row.active),
  };
}

function layoutParams(layout: LabelLayout): SqlValue[] {
  return [
    layout.id, layout.code, layout.nameAr, layout.pageSize, layout.columns, layout.rows,
    layout.labelWidthMm, layout.labelHeightMm, layout.columnGapMm, layout.rowGapMm,
    layout.marginBlockMm, layout.marginInlineMm,
    layout.showItemName ? 1 : 0, layout.showItemCode ? 1 : 0, layout.showPrice ? 1 : 0,
    layout.showUnit ? 1 : 0, layout.showBarcode ? 1 : 0, layout.showBarcodeText ? 1 : 0,
    layout.barcodeHeightMm, layout.active ? 1 : 0,
  ];
}

class SqlLabelLayoutStore implements LabelLayoutRepository {
  constructor(private readonly db: SqlDb) {}

  async list(): Promise<LabelLayout[]> {
    return (await this.db.all<LabelLayoutRow>(`SELECT * FROM label_layout ORDER BY code ASC`)).map(toLayout);
  }

  async findById(id: string): Promise<LabelLayout | null> {
    const row = await this.db.get<LabelLayoutRow>(`SELECT * FROM label_layout WHERE id = ?`, [id]);
    return row ? toLayout(row) : null;
  }

  async findByCode(code: string): Promise<LabelLayout | null> {
    const row = await this.db.get<LabelLayoutRow>(`SELECT * FROM label_layout WHERE code = ?`, [code]);
    return row ? toLayout(row) : null;
  }

  async save(layout: LabelLayout): Promise<void> {
    await this.db.run(UPSERT, layoutParams(layout));
  }

  async insert(layout: LabelLayout): Promise<void> {
    await insertNew(this.db, layout.id, UPSERT, layoutParams(layout));
  }

  async delete(id: string): Promise<void> {
    await this.db.run(`DELETE FROM label_layout WHERE id = ?`, [id]);
  }
}

export interface SqliteLabelLayoutStoreHandle extends LabelLayoutRepository {
  close(): void;
}

export async function ensureLabelLayoutSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createLabelLayoutStore(db: SqlDb): LabelLayoutRepository {
  return new SqlLabelLayoutStore(db);
}

/** Open a SQLite-backed LabelLayoutRepository. ":memory:" for tests, a path for real. */
export function createSqliteLabelLayoutStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteLabelLayoutStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createLabelLayoutStore(sqliteDb(sqlite)), {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteLabelLayoutStoreHandle;
}
