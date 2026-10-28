import type Database from "better-sqlite3";
import type { TaxGroup, TaxGroupMember, TaxGroupRepository, TaxRateStatus } from "@mezan/domain";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

// Members are a JSON column, and their order is load-bearing: a compounding
// member charges on everything before it.
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

const UPSERT = `
  INSERT INTO tax_group (id, code, name_ar, name_en, members, status)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    code = excluded.code,
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    members = excluded.members,
    status = excluded.status`;

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

function params(group: TaxGroup): SqlValue[] {
  return [group.id, group.code, group.nameAr, group.nameEn, JSON.stringify(group.members), group.status];
}

export async function ensureTaxGroupSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createTaxGroupStore(db: SqlDb): TaxGroupRepository {
  return {
    async findById(id) {
      const row = await db.get<Row>(`SELECT * FROM tax_group WHERE id = ?`, [id]);
      return row ? toGroup(row) : null;
    },
    async list() {
      return (await db.all<Row>(`SELECT * FROM tax_group ORDER BY code`)).map(toGroup);
    },
    async create(group) {
      await insertNew(db, group.id, UPSERT, params(group));
    },
    async update(group) {
      await db.run(UPSERT, params(group));
    },
  };
}

export function createSqliteTaxGroupStore(sqlite: Database.Database): TaxGroupRepository {
  sqlite.exec(CREATE_TABLE);
  return createTaxGroupStore(sqliteDb(sqlite));
}
