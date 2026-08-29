import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type {
  GateableActionType,
  GateConfig,
  GateStep,
  WorkflowConfigRecord,
  WorkflowConfigRepository,
} from "@mezan/domain";

/**
 * SQLite-backed {@link WorkflowConfigRepository} (docs/archive/catalog/09 §إعدادات
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

function toRecord(row: Row): WorkflowConfigRecord {
  return {
    id: row.id,
    actionType: row.action_type as GateableActionType,
    steps: JSON.parse(row.steps_json) as GateStep[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SqliteWorkflowConfigStore implements WorkflowConfigRepository {
  private readonly upsert: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByActionType: Database.Statement;
  private readonly deleteById: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO workflow_config (id, action_type, steps_json, created_at, updated_at)
      VALUES (@id, @action_type, @steps_json, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        action_type = excluded.action_type,
        steps_json = excluded.steps_json,
        updated_at = excluded.updated_at
    `);
    this.selectAll = sqlite.prepare(`SELECT * FROM workflow_config ORDER BY action_type`);
    this.selectById = sqlite.prepare(`SELECT * FROM workflow_config WHERE id = ?`);
    this.selectByActionType = sqlite.prepare(`SELECT * FROM workflow_config WHERE action_type = ?`);
    this.deleteById = sqlite.prepare(`DELETE FROM workflow_config WHERE id = ?`);
  }

  async list(): Promise<readonly WorkflowConfigRecord[]> {
    return (this.selectAll.all() as Row[]).map(toRecord);
  }

  async findById(id: string): Promise<WorkflowConfigRecord | null> {
    const row = this.selectById.get(id) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  async findByActionType(actionType: GateableActionType): Promise<WorkflowConfigRecord | null> {
    const row = this.selectByActionType.get(actionType) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  async save(record: WorkflowConfigRecord): Promise<void> {
    this.upsert.run({
      id: record.id,
      action_type: record.actionType,
      steps_json: JSON.stringify(record.steps),
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
  }

  async delete(id: string): Promise<void> {
    this.deleteById.run(id);
  }

  /**
   * Synchronous lookup for `createDocumentWorkflowGate`'s `resolveConfig`
   * (a document confirm can't await mid-transaction) — same query as
   * `findByActionType`, just not wrapped in a Promise.
   */
  resolveSync(actionType: GateableActionType): GateConfig | null {
    const row = this.selectByActionType.get(actionType) as Row | undefined;
    if (!row) return null;
    return { actionType, steps: JSON.parse(row.steps_json) as GateStep[] };
  }
}

export interface SqliteWorkflowConfigStoreHandle extends WorkflowConfigRepository {
  resolveSync(actionType: GateableActionType): GateConfig | null;
  close(): void;
}

/** Open a SQLite-backed WorkflowConfigRepository. ":memory:" for tests, a path (or a shared connection) for real. */
export function createSqliteWorkflowConfigStore(
  input: SqliteConnectionInput = ":memory:",
): SqliteWorkflowConfigStoreHandle {
  const { sqlite, owned } = openSqliteConnection(input);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteWorkflowConfigStore(sqlite);
  return Object.assign(store, { close: () => { if (owned) sqlite.close(); } }) as SqliteWorkflowConfigStoreHandle;
}
