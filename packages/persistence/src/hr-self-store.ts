import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
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
  algorithm: number;
  rp_id: string;
  sign_count: number;
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
    algorithm: row.algorithm,
    rpId: row.rp_id,
    signCount: row.sign_count,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

class SqliteClockCredentialRepository implements ClockCredentialRepository {
  private readonly selectByEmployee: Database.Statement;
  private readonly insert: Database.Statement;
  private readonly touch: Database.Statement;
  private readonly removeByEmployee: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.selectByEmployee = sqlite.prepare(`SELECT * FROM hr_clock_credential WHERE employee_id = ?`);
    this.insert = sqlite.prepare(`
      INSERT INTO hr_clock_credential (id, employee_id, user_id, credential_id, public_key_spki, algorithm, rp_id, sign_count, created_at, last_used_at)
      VALUES (@id, @employee_id, @user_id, @credential_id, @public_key_spki, @algorithm, @rp_id, @sign_count, @created_at, @last_used_at)
    `);
    this.touch = sqlite.prepare(`UPDATE hr_clock_credential SET sign_count = ?, last_used_at = ? WHERE id = ?`);
    this.removeByEmployee = sqlite.prepare(`DELETE FROM hr_clock_credential WHERE employee_id = ?`);
  }

  async findByEmployeeId(employeeId: string): Promise<ClockCredential | null> {
    const row = this.selectByEmployee.get(employeeId) as ClockCredentialRow | undefined;
    return row ? toCredential(row) : null;
  }

  async create(credential: ClockCredential): Promise<void> {
    this.insert.run({
      id: credential.id,
      employee_id: credential.employeeId,
      user_id: credential.userId,
      credential_id: credential.credentialId,
      public_key_spki: credential.publicKeySpki,
      algorithm: credential.algorithm,
      rp_id: credential.rpId,
      sign_count: credential.signCount,
      created_at: credential.createdAt,
      last_used_at: credential.lastUsedAt,
    });
  }

  async recordUse(id: string, signCount: number, usedAt: string): Promise<void> {
    this.touch.run(signCount, usedAt, id);
  }

  async deleteByEmployeeId(employeeId: string): Promise<number> {
    return this.removeByEmployee.run(employeeId).changes;
  }
}

export type SqliteClockCredentialRepositoryHandle = ClockCredentialRepository & { close(): void };

export function createSqliteClockCredentialRepository(path: SqliteConnectionInput = ":memory:"): SqliteClockCredentialRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_CLOCK_CREDENTIAL);
  const repo = new SqliteClockCredentialRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteClockCredentialRepositoryHandle;
}
