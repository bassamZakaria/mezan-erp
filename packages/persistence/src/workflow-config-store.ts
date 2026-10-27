import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type {
  GateableActionType,
  GateConfig,
  GateStep,
  WorkflowConfigRecord,
  WorkflowConfigRepository,
} from "@mezan/domain";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

/**
 * SQL-backed {@link WorkflowConfigRepository} (docs/archive/catalog/09 §إعدادات
 * الموافقات). One row per action type — `action_type` is UNIQUE so the DB
 * itself backstops the domain's "one config per action type" rule.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS workflow_config (
  id          TEXT PRIMARY KEY,
  action_type TEXT NOT NULL UNIQUE,
  steps_json  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
`;

interface Row {
  id: string;
  action_type: string;
  steps_json: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, action_type, steps_json, created_at, updated_at";

function toRecord(row: Row): WorkflowConfigRecord {
  return {
    id: row.id,
    actionType: row.action_type as GateableActionType,
    steps: JSON.parse(row.steps_json) as GateStep[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SqlWorkflowConfigStore implements WorkflowConfigRepository {
  constructor(private readonly db: SqlDb) {}

  async list(): Promise<readonly WorkflowConfigRecord[]> {
    return (await this.db.all<Row>(`SELECT ${COLUMNS} FROM workflow_config ORDER BY action_type`)).map(toRecord);
  }

  async findById(id: string): Promise<WorkflowConfigRecord | null> {
    const row = await this.db.get<Row>(`SELECT ${COLUMNS} FROM workflow_config WHERE id = ?`, [id]);
    return row ? toRecord(row) : null;
  }

  async findByActionType(actionType: GateableActionType): Promise<WorkflowConfigRecord | null> {
    const row = await this.db.get<Row>(`SELECT ${COLUMNS} FROM workflow_config WHERE action_type = ?`, [actionType]);
    return row ? toRecord(row) : null;
  }

  async save(record: WorkflowConfigRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO workflow_config (${COLUMNS})
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         action_type = excluded.action_type,
         steps_json = excluded.steps_json,
         updated_at = excluded.updated_at`,
      [record.id, record.actionType, JSON.stringify(record.steps), record.createdAt, record.updatedAt],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.run(`DELETE FROM workflow_config WHERE id = ?`, [id]);
  }

  async resolve(actionType: GateableActionType): Promise<GateConfig | null> {
    const row = await this.db.get<{ steps_json: string }>(`SELECT steps_json FROM workflow_config WHERE action_type = ?`, [actionType]);
    if (!row) return null;
    return { actionType, steps: JSON.parse(row.steps_json) as GateStep[] };
  }
}

export interface WorkflowConfigStoreHandle extends WorkflowConfigRepository {
  resolve(actionType: GateableActionType): Promise<GateConfig | null>;
}

export interface SqliteWorkflowConfigStoreHandle extends WorkflowConfigStoreHandle {
  close(): void;
}

export async function ensureWorkflowConfigSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createWorkflowConfigStore(db: SqlDb): WorkflowConfigStoreHandle {
  return new SqlWorkflowConfigStore(db);
}

/** Open a SQLite-backed WorkflowConfigRepository. ":memory:" for tests, a path (or a shared connection) for real. */
export function createSqliteWorkflowConfigStore(
  input: SqliteConnectionInput = ":memory:",
): SqliteWorkflowConfigStoreHandle {
  const { sqlite, owned } = openSqliteConnection(input);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createWorkflowConfigStore(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } }) as SqliteWorkflowConfigStoreHandle;
}
