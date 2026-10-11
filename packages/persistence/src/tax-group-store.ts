import Database from "better-sqlite3";
import type { TaxGroup, TaxGroupMember, TaxGroupRepository, TaxRateStatus } from "@mezan/domain";
import { insertingNew, prepareInsertOnly } from "./insert-new.js";

/**
 * SQLite-backed tax groups (R6.4). Members are a JSON column rather than a
 * child table: they are an ordered, group-owned list with no independent query
 * needs, the same call `item_store` makes for alternate units and barcodes.
 * Order is load-bearing — a compounding member charges on everything before it.
 */
const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS tax_group (
  id      TEXT PRIMARY KEY,
  code    TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  members TEXT NOT NULL,
  status  TEXT NOT NULL
);
`;

interface Row {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  members: string;
  status: string;
}

function toGroup(row: Row): TaxGroup {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    members: JSON.parse(row.members) as TaxGroupMember[],
    status: row.status as TaxRateStatus,
  };
}

export function createSqliteTaxGroupStore(sqlite: Database.Database): TaxGroupRepository {
  sqlite.exec(CREATE_TABLE);
  const upsert = sqlite.prepare(`
    INSERT INTO tax_group (id, code, name_ar, name_en, members, status)
    VALUES (@id, @code, @name_ar, @name_en, @members, @status)
    ON CONFLICT(id) DO UPDATE SET
      code = excluded.code,
      name_ar = excluded.name_ar,
      name_en = excluded.name_en,
      members = excluded.members,
      status = excluded.status
  `);
  const selectById = sqlite.prepare(`SELECT * FROM tax_group WHERE id = ?`);
  const selectAll = sqlite.prepare(`SELECT * FROM tax_group ORDER BY code`);

  const insertOnly = prepareInsertOnly(sqlite, upsert.source);

  function write(group: TaxGroup, statement: Database.Statement = upsert): void {
    statement.run({
      id: group.id,
      code: group.code,
      name_ar: group.nameAr,
      name_en: group.nameEn,
      members: JSON.stringify(group.members),
      status: group.status,
    });
  }

  return {
    async findById(id) {
      const row = selectById.get(id) as Row | undefined;
      return row ? toGroup(row) : null;
    },
    async list() {
      return (selectAll.all() as Row[]).map(toGroup);
    },
    async create(group) {
      insertingNew(group.id, () => write(group, insertOnly));
    },
    async update(group) {
      write(group);
    },
  };
}
