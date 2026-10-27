import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import type { ClockCredential, ClockCredentialRepository } from "@mezan/domain";

const CREATE_CLOCK_CREDENTIAL = `
CREATE TABLE IF NOT EXISTS hr_clock_credential (
  id               TEXT PRIMARY KEY,
  employee_id      TEXT NOT NULL UNIQUE,
  user_id          TEXT NOT NULL,
  credential_id    TEXT NOT NULL UNIQUE,
  public_key_spki  TEXT NOT NULL,
  algorithm        INTEGER NOT NULL,
  rp_id            TEXT NOT NULL,
  sign_count       INTEGER NOT NULL,
  created_at       TEXT NOT NULL,
  last_used_at     TEXT
);
`;

interface ClockCredentialRow {
  id: string;
  employee_id: string;
  user_id: string;
  credential_id: string;
  public_key_spki: string;
  algorithm: bigint;
  rp_id: string;
  sign_count: bigint;
  created_at: string;
  last_used_at: string | null;
}

function toCredential(row: ClockCredentialRow): ClockCredential {
  return {
    id: row.id,
    employeeId: row.employee_id,
    userId: row.user_id,
    credentialId: row.credential_id,
    publicKeySpki: row.public_key_spki,
    algorithm: Number(row.algorithm),
    rpId: row.rp_id,
    signCount: Number(row.sign_count),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

class SqlClockCredentialRepository implements ClockCredentialRepository {
  constructor(private readonly db: SqlDb) {}

  async findByEmployeeId(employeeId: string): Promise<ClockCredential | null> {
    const row = await this.db.get<ClockCredentialRow>(`SELECT * FROM hr_clock_credential WHERE employee_id = ?`, [employeeId]);
    return row ? toCredential(row) : null;
  }

  async create(credential: ClockCredential): Promise<void> {
    await this.db.run(
      `INSERT INTO hr_clock_credential (id, employee_id, user_id, credential_id, public_key_spki, algorithm, rp_id, sign_count, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        credential.id,
        credential.employeeId,
        credential.userId,
        credential.credentialId,
        credential.publicKeySpki,
        credential.algorithm,
        credential.rpId,
        credential.signCount,
        credential.createdAt,
        credential.lastUsedAt,
      ],
    );
  }

  async recordUse(id: string, signCount: number, usedAt: string): Promise<void> {
    await this.db.run(`UPDATE hr_clock_credential SET sign_count = ?, last_used_at = ? WHERE id = ?`, [signCount, usedAt, id]);
  }

  async deleteByEmployeeId(employeeId: string): Promise<number> {
    return (await this.db.run(`DELETE FROM hr_clock_credential WHERE employee_id = ?`, [employeeId])).changes;
  }
}

export async function ensureClockCredentialSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_CLOCK_CREDENTIAL);
}

export function createClockCredentialRepository(db: SqlDb): ClockCredentialRepository {
  return new SqlClockCredentialRepository(db);
}

export type SqliteClockCredentialRepositoryHandle = ClockCredentialRepository & { close(): void };

function tableExists(sqlite: Database.Database, name: string): boolean {
  return sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined;
}

/**
 * إجازاتي moved from `hr.leave.view` to `hr.self.leave`. A books file created
 * before the move gets the new code on every role that could reach the screen,
 * once: this table's first creation is the marker, so an admin who later
 * removes the grant is not overridden on the next boot.
 */
function grantSelfLeaveToExistingRoles(sqlite: Database.Database): void {
  if (!tableExists(sqlite, "role")) return;
  const rows = sqlite.prepare(`SELECT id, permissions FROM role`).all() as { id: string; permissions: string }[];
  const update = sqlite.prepare(`UPDATE role SET permissions = ? WHERE id = ?`);
  for (const row of rows) {
    let permissions: string[];
    try {
      permissions = JSON.parse(row.permissions) as string[];
    } catch {
      continue;
    }
    if (!Array.isArray(permissions) || permissions.includes("hr.self.leave")) continue;
    if (permissions.includes("hr.leave.view") || permissions.includes("hr.leave.create")) {
      update.run(JSON.stringify([...permissions, "hr.self.leave"]), row.id);
    }
  }
}

export function createSqliteClockCredentialRepository(path: SqliteConnectionInput = ":memory:"): SqliteClockCredentialRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  const firstRun = !tableExists(sqlite, "hr_clock_credential");
  sqlite.exec(CREATE_CLOCK_CREDENTIAL);
  if (firstRun) grantSelfLeaveToExistingRoles(sqlite);
  const repo = createClockCredentialRepository(sqliteDb(sqlite));
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteClockCredentialRepositoryHandle;
}
