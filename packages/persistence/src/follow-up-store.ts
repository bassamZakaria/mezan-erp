import Database from "better-sqlite3";
import type { CollectionFollowUp, CollectionFollowUpListFilter, CollectionFollowUpRepository } from "@mezan/domain";

/** SQLite-backed {@link CollectionFollowUpRepository} — متابعة التحصيل (docs/catalog/05). Its own small table (not a `FrameworkDocument` — see follow-up.ts's doc-comment). */

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

export function createSqliteFollowUpStore(sqlite: Database.Database): CollectionFollowUpRepository {
  sqlite.exec(CREATE_TABLE);
  const upsert = sqlite.prepare(`
    INSERT INTO collection_follow_up
      (id, customer_id, installment_plan_id, type, follow_up_date, assigned_to, notes, status, outcome, created_at)
    VALUES
      (@id, @customer_id, @installment_plan_id, @type, @follow_up_date, @assigned_to, @notes, @status, @outcome, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      installment_plan_id = excluded.installment_plan_id,
      notes = excluded.notes,
      status = excluded.status,
      outcome = excluded.outcome
  `);
  const selectById = sqlite.prepare(`SELECT * FROM collection_follow_up WHERE id = ?`);
  const selectAll = sqlite.prepare(`SELECT * FROM collection_follow_up ORDER BY follow_up_date DESC, created_at DESC`);

  function toRow(f: CollectionFollowUp) {
    return {
      id: f.id,
      customer_id: f.customerId,
      installment_plan_id: f.installmentPlanId,
      type: f.type,
      follow_up_date: f.followUpDate,
      assigned_to: f.assignedTo,
      notes: f.notes,
      status: f.status,
      outcome: f.outcome,
      created_at: f.createdAt,
    };
  }

  return {
    async save(f) {
      upsert.run(toRow(f));
    },
    async update(f) {
      upsert.run(toRow(f));
    },
    async findById(id) {
      const row = selectById.get(id) as Row | undefined;
      return row ? fromRow(row) : null;
    },
    async list(filter: CollectionFollowUpListFilter = {}) {
      const rows = selectAll.all() as Row[];
      return rows
        .filter((r) => (filter.status ? r.status === filter.status : true))
        .filter((r) => (filter.customerId ? r.customer_id === filter.customerId : true))
        .map(fromRow);
    },
  };
}

export function createStandaloneSqliteFollowUpStore(path = ":memory:"): SqliteFollowUpStoreHandle {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  const repo = createSqliteFollowUpStore(sqlite);
  return Object.assign(repo, { close: () => sqlite.close() });
}
