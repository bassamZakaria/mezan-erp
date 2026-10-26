import type Database from "better-sqlite3";
import { withSqliteTransaction } from "../sqlite-connection.js";
import { SqlDialect, TransactionMode, type RunResult, type SqlDb, type SqlValue } from "./sql-db.js";

const STATEMENT_CACHE_LIMIT = 500;

function bound(params: readonly SqlValue[]): unknown[] {
  return params.map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : value));
}

class SqliteDb implements SqlDb {
  readonly dialect = SqlDialect.Sqlite;
  private readonly statements = new Map<string, Database.Statement>();

  constructor(private readonly sqlite: Database.Database) {}

  private statement(sql: string): Database.Statement {
    let statement = this.statements.get(sql);
    if (!statement) {
      if (this.statements.size >= STATEMENT_CACHE_LIMIT) this.statements.clear();
      statement = this.sqlite.prepare(sql);
      if (statement.reader) statement.safeIntegers(true);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  async all<Row>(sql: string, params: readonly SqlValue[] = []): Promise<Row[]> {
    return this.statement(sql).all(...bound(params)) as Row[];
  }

  async get<Row>(sql: string, params: readonly SqlValue[] = []): Promise<Row | undefined> {
    return this.statement(sql).get(...bound(params)) as Row | undefined;
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<RunResult> {
    return { changes: this.statement(sql).run(...bound(params)).changes };
  }

  async exec(sql: string): Promise<void> {
    this.sqlite.exec(sql);
  }

  transaction<T>(fn: () => Promise<T>, mode: TransactionMode = TransactionMode.Deferred): Promise<T> {
    return withSqliteTransaction(this.sqlite, fn, mode === TransactionMode.Immediate ? "BEGIN IMMEDIATE" : "BEGIN");
  }
}

const adapters = new WeakMap<Database.Database, SqliteDb>();

export function sqliteDb(sqlite: Database.Database): SqlDb {
  let db = adapters.get(sqlite);
  if (!db) {
    db = new SqliteDb(sqlite);
    adapters.set(sqlite, db);
  }
  return db;
}
