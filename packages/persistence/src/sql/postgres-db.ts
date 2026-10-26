import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { numberedPlaceholders, SqlDialect, type RunResult, type SqlDb, type SqlValue } from "./sql-db.js";

const TENANT_SCHEMA_RE = /^t_[a-z0-9_]{1,61}$/;
const TENANT_LOCK_CLASS = 7301;

const PG_INT2 = 21;
const PG_INT4 = 23;
const PG_INT8 = 20;
const PG_NUMERIC = 1700;
const INTEGRAL_RE = /^-?\d+$/;

const toBigInt = (value: string): bigint => BigInt(value);

const typeParsers: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: string) => {
    if (oid === PG_INT2 || oid === PG_INT4 || oid === PG_INT8) return toBigInt;
    if (oid === PG_NUMERIC) return (value: string) => (INTEGRAL_RE.test(value) ? BigInt(value) : value);
    return pg.types.getTypeParser(oid, format as "text");
  }) as pg.CustomTypesConfig["getTypeParser"],
};

export class InvalidSchemaNameError extends Error {
  constructor(schema: string) {
    super(`"${schema}" is not a valid tenant schema name.`);
  }
}

export class ConnectionOptionsInUrlError extends Error {
  constructor() {
    super("The Postgres connection string may not carry `options`: it would override every tenant's schema pin.");
  }
}

export class TenantSchemaMismatchError extends Error {
  constructor(expected: string, actual: string | null) {
    super(`A connection for tenant schema "${expected}" is on "${actual ?? "(none)"}".`);
  }
}

export class TransactionAbortedError extends Error {
  constructor() {
    super("The transaction was aborted by an earlier failed statement and has been rolled back.");
  }
}

export class UnsupportedCollationError extends Error {
  constructor(collate: string, ctype: string) {
    super(`The Postgres database must use C collation and ctype to sort and fold text as SQLite does (found ${collate} / ${ctype}).`);
  }
}

export function assertSchemaName(schema: string): string {
  if (!TENANT_SCHEMA_RE.test(schema)) throw new InvalidSchemaNameError(schema);
  return schema;
}

function tenantConnectionString(connectionString: string, schema: string, password: string): string {
  const url = new URL(connectionString);
  if (url.searchParams.has("options")) throw new ConnectionOptionsInUrlError();
  url.username = schema;
  url.password = password;
  return url.toString();
}

export interface TenantPoolOptions {
  readonly connectionString: string;
  readonly schema: string;
  readonly password: string;
  readonly max?: number;
  readonly idleTimeoutMillis?: number;
}

// TENANT ISOLATION: each tenant connects as its own role, which owns its schema
// and holds no privilege on any other (see provisionTenantSchema), and the
// schema is pinned on every connection when it opens. Nothing in this package
// issues `SET search_path` or `SET ROLE`.
export function createTenantPool(options: TenantPoolOptions): pg.Pool {
  const schema = assertSchemaName(options.schema);
  return new pg.Pool({
    connectionString: tenantConnectionString(options.connectionString, schema, options.password),
    max: options.max ?? 5,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    options: `-c search_path=${schema}`,
    types: typeParsers,
  });
}

export async function assertCollation(admin: pg.Pool | pg.Client): Promise<void> {
  const { rows } = await admin.query<{ datcollate: string; datctype: string }>(
    "SELECT datcollate, datctype FROM pg_database WHERE datname = current_database()",
  );
  const row = rows[0]!;
  if (row.datcollate !== "C" || row.datctype !== "C") throw new UnsupportedCollationError(row.datcollate, row.datctype);
}

// Run as the database owner. The tenant role is the schema's only grantee, so a
// query that names another tenant's schema is refused by Postgres itself.
export async function provisionTenantSchema(admin: pg.Pool | pg.Client, schema: string, password: string): Promise<void> {
  assertSchemaName(schema);
  await assertCollation(admin);
  const { rows } = await admin.query<{ db: string }>("SELECT current_database() AS db");
  const database = rows[0]!.db;
  await admin.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
  await admin.query(`REVOKE ALL ON DATABASE ${pg.escapeIdentifier(database)} FROM PUBLIC`);
  await admin.query(`CREATE ROLE ${schema} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD ${pg.escapeLiteral(password)}`);
  await admin.query(`GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(database)} TO ${schema}`);
  await admin.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${schema}`);
}

interface Level {
  queue: Promise<void>;
  readonly of?: OpenTransaction;
}

interface OpenTransaction extends Level {
  readonly client: pg.PoolClient;
  open: boolean;
  savepoints: number;
}

type Queryable = Pick<pg.PoolClient, "query">;

class PostgresDb implements SqlDb {
  readonly dialect = SqlDialect.Postgres;
  private readonly current = new AsyncLocalStorage<OpenTransaction>();
  private readonly level = new AsyncLocalStorage<Level>();

  constructor(
    private readonly pool: pg.Pool,
    readonly schema: string,
  ) {}

  private target(): Queryable {
    const tx = this.current.getStore();
    return tx?.open ? tx.client : this.pool;
  }

  private async query(sql: string, params: readonly SqlValue[]): Promise<pg.QueryResult> {
    return this.target().query(numberedPlaceholders(sql), params as unknown[]);
  }

  async all<Row>(sql: string, params: readonly SqlValue[] = []): Promise<Row[]> {
    return (await this.query(sql, params)).rows as Row[];
  }

  async get<Row>(sql: string, params: readonly SqlValue[] = []): Promise<Row | undefined> {
    return (await this.query(sql, params)).rows[0] as Row | undefined;
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<RunResult> {
    return { changes: (await this.query(sql, params)).rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.target().query(sql);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const outer = this.current.getStore();
    if (outer?.open) return this.savepoint(outer, fn);

    const client = await this.pool.connect();
    const tx: OpenTransaction = { client, open: true, savepoints: 0, queue: Promise.resolve() };
    let broken = false;
    try {
      await client.query("BEGIN");
      // REQUIRED: one writer per tenant at a time, as on SQLite. Every caller in
      // this codebase was written against SQLite's single writer, so check-then-
      // write sequences (stock, credit limits, numbering) rely on it.
      const { rows } = await client.query<{ schema: string | null }>(
        "SELECT pg_advisory_xact_lock($1, hashtext($2)), current_schema() AS schema",
        [TENANT_LOCK_CLASS, this.schema],
      );
      if (rows[0]?.schema !== this.schema) throw new TenantSchemaMismatchError(this.schema, rows[0]?.schema ?? null);
      const result = await this.current.run(tx, fn);
      // A statement that failed inside `fn` aborts the transaction even when `fn`
      // caught it, and Postgres then answers COMMIT with ROLLBACK, not an error.
      const commit = await client.query("COMMIT");
      if (commit.command !== "COMMIT") throw new TransactionAbortedError();
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      tx.open = false;
      client.release(broken);
    }
  }

  // Nested transactions of one transaction share its connection, so siblings
  // run one after another: interleaved savepoints roll back each other's work.
  private async savepoint<T>(tx: OpenTransaction, fn: () => Promise<T>): Promise<T> {
    const inner = this.level.getStore();
    const parent = inner?.of === tx ? inner : tx;
    const previous = parent.queue;
    let done!: () => void;
    parent.queue = new Promise<void>((resolve) => {
      done = resolve;
    });
    await previous;
    try {
      return await this.level.run({ queue: Promise.resolve(), of: tx }, () => this.runSavepoint(tx, fn));
    } finally {
      done();
    }
  }

  private async runSavepoint<T>(tx: OpenTransaction, fn: () => Promise<T>): Promise<T> {
    const name = `sp_${++tx.savepoints}`;
    await tx.client.query(`SAVEPOINT ${name}`);
    try {
      const result = await fn();
      await tx.client.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      await tx.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      await tx.client.query(`RELEASE SAVEPOINT ${name}`);
      throw error;
    }
  }
}

const adapters = new WeakMap<pg.Pool, PostgresDb>();

// REQUIRED: one adapter per pool. Two adapters would not see each other's open
// transaction, and a store nested in another's would wait on its own lock.
export function postgresDb(pool: pg.Pool, schema: string): SqlDb {
  assertSchemaName(schema);
  let db = adapters.get(pool);
  if (!db) {
    db = new PostgresDb(pool, schema);
    adapters.set(pool, db);
  }
  if (db.schema !== schema) throw new TenantSchemaMismatchError(db.schema, schema);
  return db;
}
