import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { CollectionFollowUp, CollectionFollowUpListFilter, CollectionFollowUpRepository } from "@mezan/domain";
import { insertNew } from "./insert-new.js";
import { placeholders, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

/** {@link CollectionFollowUpRepository} — متابعة التحصيل (docs/archive/catalog/05). Its own small table (not a `FrameworkDocument` — see follow-up.ts's doc-comment). */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS collection_follow_up (
  id                   TEXT PRIMARY KEY,
  customer_id          TEXT NOT NULL,
  installment_plan_id  TEXT,
  type                 TEXT NOT NULL,
  follow_up_date       TEXT NOT NULL,
  assigned_to          TEXT,
  notes                TEXT,
  status               TEXT NOT NULL,
  outcome              TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_follow_up_customer ON collection_follow_up(customer_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_status ON collection_follow_up(status);
`;

interface Row {
  id: string;
  customer_id: string;
  installment_plan_id: string | null;
  type: string;
  follow_up_date: string;
  assigned_to: string | null;
  notes: string | null;
  status: string;
  outcome: string | null;
  created_at: string;
}

function fromRow(row: Row): CollectionFollowUp {
  return {
    id: row.id,
    customerId: row.customer_id,
    installmentPlanId: row.installment_plan_id,
    type: row.type as CollectionFollowUp["type"],
    followUpDate: row.follow_up_date,
    assignedTo: row.assigned_to,
    notes: row.notes,
    status: row.status as CollectionFollowUp["status"],
    outcome: row.outcome,
    createdAt: row.created_at,
  };
}

export interface SqliteFollowUpStoreHandle extends CollectionFollowUpRepository {
  close(): void;
}

const COLUMNS = ["id", "customer_id", "installment_plan_id", "type", "follow_up_date", "assigned_to", "notes", "status", "outcome", "created_at"] as const;

const UPSERT = `
    INSERT INTO collection_follow_up (${COLUMNS.join(", ")})
    VALUES (${placeholders(COLUMNS.length)})
    ON CONFLICT(id) DO UPDATE SET
      installment_plan_id = excluded.installment_plan_id,
      notes = excluded.notes,
      status = excluded.status,
      outcome = excluded.outcome`;

function toParams(f: CollectionFollowUp): SqlValue[] {
  return [f.id, f.customerId, f.installmentPlanId, f.type, f.followUpDate, f.assignedTo, f.notes, f.status, f.outcome, f.createdAt];
}

export async function ensureFollowUpSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createFollowUpStore(db: SqlDb): CollectionFollowUpRepository {
  return {
    async save(f) {
      await db.run(UPSERT, toParams(f));
    },
    async insert(f) {
      await insertNew(db, f.id, UPSERT, toParams(f));
    },
    async update(f) {
      await db.run(UPSERT, toParams(f));
    },
    async findById(id) {
      const row = await db.get<Row>(`SELECT * FROM collection_follow_up WHERE id = ?`, [id]);
      return row ? fromRow(row) : null;
    },
    async list(filter: CollectionFollowUpListFilter = {}) {
      const rows = await db.all<Row>(`SELECT * FROM collection_follow_up ORDER BY follow_up_date DESC, created_at DESC`);
      return rows
        .filter((r) => (filter.status ? r.status === filter.status : true))
        .filter((r) => (filter.customerId ? r.customer_id === filter.customerId : true))
        .map(fromRow);
    },
  };
}

export function createSqliteFollowUpStore(sqlite: Database.Database): CollectionFollowUpRepository {
  sqlite.exec(CREATE_TABLE);
  return createFollowUpStore(sqliteDb(sqlite));
}

export function createStandaloneSqliteFollowUpStore(path: SqliteConnectionInput = ":memory:"): SqliteFollowUpStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  const repo = createSqliteFollowUpStore(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } });
}
