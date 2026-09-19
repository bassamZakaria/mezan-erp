import type Database from "better-sqlite3";
import {
  Money,
  PosSessionAlreadyOpenError,
  type PosSessionRecord,
  type PosSessionRepository,
  type PosSessionStatus,
} from "@mezan/domain";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";

// The two partial unique indexes ARE the "one open session per terminal and per
// cashier" rule (plan §3.3); `open` relies on them rather than on a read-then-write.
const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS pos_session (
  id                 TEXT PRIMARY KEY,
  doc_no             TEXT UNIQUE,
  terminal_id        TEXT NOT NULL,
  branch_id          TEXT NOT NULL,
  cashier_user_id    TEXT NOT NULL,
  shift_template_id  TEXT,
  status             TEXT NOT NULL,
  opened_at          TEXT NOT NULL,
  opening_float      INTEGER NOT NULL,
  closed_at          TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_session_open_terminal ON pos_session(terminal_id) WHERE status <> 'closed';
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_session_open_cashier ON pos_session(cashier_user_id) WHERE status <> 'closed';
CREATE INDEX IF NOT EXISTS idx_pos_session_opened ON pos_session(opened_at);
`;

interface SessionRow {
  id: string;
  doc_no: string | null;
  terminal_id: string;
  branch_id: string;
  cashier_user_id: string;
  shift_template_id: string | null;
  status: string;
  opened_at: string;
  opening_float: number;
  closed_at: string | null;
}

function toSession(row: SessionRow): PosSessionRecord {
  return {
    id: row.id,
    docNo: row.doc_no,
    terminalId: row.terminal_id,
    branchId: row.branch_id,
    cashierUserId: row.cashier_user_id,
    shiftTemplateId: row.shift_template_id,
    status: row.status as PosSessionStatus,
    openedAt: row.opened_at,
    openingFloat: Money.fromScaled(row.opening_float),
    closedAt: row.closed_at,
  };
}

class SqlitePosSessionStore implements PosSessionRepository {
  private readonly insert: Database.Statement;
  private readonly selectOpenForTerminal: Database.Statement;

  constructor(readonly sqlite: Database.Database) {
    this.insert = sqlite.prepare(
      `INSERT INTO pos_session (id, doc_no, terminal_id, branch_id, cashier_user_id, shift_template_id, status, opened_at, opening_float, closed_at)
       VALUES (@id, @docNo, @terminalId, @branchId, @cashierUserId, @shiftTemplateId, @status, @openedAt, @openingFloat, @closedAt)`,
    );
    this.selectOpenForTerminal = sqlite.prepare(`SELECT * FROM pos_session WHERE terminal_id = ? AND status <> 'closed'`);
  }

  async open(session: PosSessionRecord): Promise<void> {
    try {
      this.insert.run({
        id: session.id,
        docNo: session.docNo,
        terminalId: session.terminalId,
        branchId: session.branchId,
        cashierUserId: session.cashierUserId,
        shiftTemplateId: session.shiftTemplateId,
        status: "open",
        openedAt: session.openedAt,
        openingFloat: session.openingFloat.toScaledNumber(),
        closedAt: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("idx_pos_session_open_terminal") || message.includes("pos_session.terminal_id")) {
        throw new PosSessionAlreadyOpenError("terminal");
      }
      if (message.includes("idx_pos_session_open_cashier") || message.includes("pos_session.cashier_user_id")) {
        throw new PosSessionAlreadyOpenError("cashier");
      }
      throw err;
    }
  }

  async findOpenForTerminal(terminalId: string): Promise<PosSessionRecord | null> {
    const row = this.selectOpenForTerminal.get(terminalId) as SessionRow | undefined;
    return row ? toSession(row) : null;
  }
}

export interface SqlitePosSessionStoreHandle extends PosSessionRepository {
  close(): void;
}

export function createSqlitePosSessionStore(path: SqliteConnectionInput = ":memory:"): SqlitePosSessionStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  const store = new SqlitePosSessionStore(sqlite);
  return Object.assign(store, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqlitePosSessionStoreHandle;
}
