import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { LabelLayout, LabelLayoutRepository, LabelPageSize } from "@mezan/domain";

/** SQLite-backed LabelLayoutRepository (docs/archive/catalog/03 §"طباعة الباركود والملصقات"). */

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

interface LabelLayoutRow {
  id: string;
  code: string;
  name_ar: string;
  page_size: string;
  columns_count: number;
  rows_count: number;
  label_width_mm: number;
  label_height_mm: number;
  column_gap_mm: number;
  row_gap_mm: number;
  margin_block_mm: number;
  margin_inline_mm: number;
  show_item_name: number;
  show_item_code: number;
  show_price: number;
  show_unit: number;
  show_barcode: number;
  show_barcode_text: number;
  barcode_height_mm: number;
  active: number;
}

function toLayout(row: LabelLayoutRow): LabelLayout {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    pageSize: row.page_size as LabelPageSize,
    columns: row.columns_count,
    rows: row.rows_count,
    labelWidthMm: row.label_width_mm,
    labelHeightMm: row.label_height_mm,
    columnGapMm: row.column_gap_mm,
    rowGapMm: row.row_gap_mm,
    marginBlockMm: row.margin_block_mm,
    marginInlineMm: row.margin_inline_mm,
    showItemName: row.show_item_name === 1,
    showItemCode: row.show_item_code === 1,
    showPrice: row.show_price === 1,
    showUnit: row.show_unit === 1,
    showBarcode: row.show_barcode === 1,
    showBarcodeText: row.show_barcode_text === 1,
    barcodeHeightMm: row.barcode_height_mm,
    active: row.active === 1,
  };
}

class SqliteLabelLayoutStore implements LabelLayoutRepository {
  private readonly upsert: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly deleteById: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO label_layout (
         id, code, name_ar, page_size, columns_count, rows_count, label_width_mm, label_height_mm,
         column_gap_mm, row_gap_mm, margin_block_mm, margin_inline_mm, show_item_name, show_item_code,
         show_price, show_unit, show_barcode, show_barcode_text, barcode_height_mm, active
       ) VALUES (
         @id, @code, @nameAr, @pageSize, @columns, @rows, @labelWidthMm, @labelHeightMm,
         @columnGapMm, @rowGapMm, @marginBlockMm, @marginInlineMm, @showItemName, @showItemCode,
         @showPrice, @showUnit, @showBarcode, @showBarcodeText, @barcodeHeightMm, @active
       )
       ON CONFLICT(id) DO UPDATE SET
         code = @code, name_ar = @nameAr, page_size = @pageSize, columns_count = @columns,
         rows_count = @rows, label_width_mm = @labelWidthMm, label_height_mm = @labelHeightMm,
         column_gap_mm = @columnGapMm, row_gap_mm = @rowGapMm, margin_block_mm = @marginBlockMm,
         margin_inline_mm = @marginInlineMm, show_item_name = @showItemName, show_item_code = @showItemCode,
         show_price = @showPrice, show_unit = @showUnit, show_barcode = @showBarcode,
         show_barcode_text = @showBarcodeText, barcode_height_mm = @barcodeHeightMm, active = @active`,
    );
    this.selectAll = sqlite.prepare(`SELECT * FROM label_layout ORDER BY code ASC`);
    this.selectById = sqlite.prepare(`SELECT * FROM label_layout WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM label_layout WHERE code = ?`);
    this.deleteById = sqlite.prepare(`DELETE FROM label_layout WHERE id = ?`);
  }

  async list(): Promise<LabelLayout[]> {
    return (this.selectAll.all() as LabelLayoutRow[]).map(toLayout);
  }

  async findById(id: string): Promise<LabelLayout | null> {
    const row = this.selectById.get(id) as LabelLayoutRow | undefined;
    return row ? toLayout(row) : null;
  }

  async findByCode(code: string): Promise<LabelLayout | null> {
    const row = this.selectByCode.get(code) as LabelLayoutRow | undefined;
    return row ? toLayout(row) : null;
  }

  async save(layout: LabelLayout): Promise<void> {
    this.upsert.run({
      id: layout.id,
      code: layout.code,
      nameAr: layout.nameAr,
      pageSize: layout.pageSize,
      columns: layout.columns,
      rows: layout.rows,
      labelWidthMm: layout.labelWidthMm,
      labelHeightMm: layout.labelHeightMm,
      columnGapMm: layout.columnGapMm,
      rowGapMm: layout.rowGapMm,
      marginBlockMm: layout.marginBlockMm,
      marginInlineMm: layout.marginInlineMm,
      showItemName: layout.showItemName ? 1 : 0,
      showItemCode: layout.showItemCode ? 1 : 0,
      showPrice: layout.showPrice ? 1 : 0,
      showUnit: layout.showUnit ? 1 : 0,
      showBarcode: layout.showBarcode ? 1 : 0,
      showBarcodeText: layout.showBarcodeText ? 1 : 0,
      barcodeHeightMm: layout.barcodeHeightMm,
      active: layout.active ? 1 : 0,
    });
  }

  async delete(id: string): Promise<void> {
    this.deleteById.run(id);
  }
}

export interface SqliteLabelLayoutStoreHandle extends LabelLayoutRepository {
  close(): void;
}

/** Open a SQLite-backed LabelLayoutRepository. ":memory:" for tests, a path for real. */
export function createSqliteLabelLayoutStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteLabelLayoutStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteLabelLayoutStore(sqlite);
  return Object.assign(store, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteLabelLayoutStoreHandle;
}
