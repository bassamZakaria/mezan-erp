import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import pg from "pg";
import { DatabaseBusyError, declaredAddableColumns, NulCharacterError, numberedPlaceholders, SqlDialect, type RunResult, type SqlDb, type SqlValue } from "@mezan/persistence";
import { translateDdl } from "./translate-ddl.js";

const TENANT_SCHEMA_RE = /^t_[a-z0-9_]{1,61}$/;
export const PLATFORM_SCHEMA = "platform";
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

export class ConnectionParameterInUrlError extends Error {
  constructor(readonly parameter: string) {
    super(`The Postgres connection string may not carry "${parameter}": only sslmode and application_name are allowed, so no parameter can replace a tenant's own role.`);
  }
}

export class TenantRoleMismatchError extends Error {
  constructor(readonly expected: string, readonly actual: string | null) {
    super(`Connected as role "${actual ?? "?"}" for schema "${expected}": every tenant must connect as its own role.`);
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
  if (schema !== PLATFORM_SCHEMA && !TENANT_SCHEMA_RE.test(schema)) throw new InvalidSchemaNameError(schema);
  return schema;
}

const ALLOWED_URL_PARAMETERS = new Set(["sslmode", "application_name"]);

function tenantConnectionString(connectionString: string, schema: string, password: string): string {
  const url = new URL(connectionString);
  if (url.searchParams.has("options")) throw new ConnectionOptionsInUrlError();
  for (const parameter of url.searchParams.keys()) if (!ALLOWED_URL_PARAMETERS.has(parameter)) throw new ConnectionParameterInUrlError(parameter);
  url.username = schema;
  url.password = password;
  return url.toString();
}

export const CONNECT_TIMEOUT_MS = 10_000;
const ROLE_STATEMENT_TIMEOUT = "120s";
const ROLE_IDLE_IN_TRANSACTION_TIMEOUT = "60s";
const ROLE_CONNECTION_LIMIT = 10;

export interface TenantPoolOptions {
  readonly connectionString: string;
  readonly schema: string;
  readonly password: string;
  readonly max?: number;
  readonly idleTimeoutMillis?: number;
  readonly onError?: (error: Error, schema: string) => void;
  readonly connectionTimeoutMillis?: number;
}

// TENANT ISOLATION: each tenant connects as its own role, which owns its schema
// and holds no privilege on any other (see provisionTenantSchema), and the
// schema is pinned on every connection when it opens. Nothing in this package
// issues `SET search_path` or `SET ROLE`.
export function createTenantPool(options: TenantPoolOptions): pg.Pool {
  const schema = assertSchemaName(options.schema);
  const pool = new pg.Pool({
    connectionString: tenantConnectionString(options.connectionString, schema, options.password),
    max: options.max ?? 5,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? CONNECT_TIMEOUT_MS,
    options: `-c search_path=${schema}`,
    types: typeParsers,
  });
  // REQUIRED: an idle client whose server connection drops emits "error" on the pool; unheard, it crashes the process.
  pool.on("error", (error) => options.onError?.(error, schema));
  return pool;
}

export async function assertCollation(admin: pg.Pool | pg.Client): Promise<void> {
  const { rows } = await admin.query<{ datcollate: string; datctype: string }>(
    "SELECT datcollate, datctype FROM pg_database WHERE datname = current_database()",
  );
  const row = rows[0]!;
  if (row.datcollate !== "C" || row.datctype !== "C") throw new UnsupportedCollationError(row.datcollate, row.datctype);
}

const INSUFFICIENT_PRIVILEGE = "42501";
const PROVISION_LOCK_CLASS = 7302;

async function ownerOnly(client: pg.Pool | pg.Client | pg.PoolClient, statement: string): Promise<void> {
  await client.query("SAVEPOINT owner_only");
  try {
    await client.query(statement);
    await client.query("RELEASE SAVEPOINT owner_only");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT owner_only");
    if ((error as { code?: string }).code !== INSUFFICIENT_PRIVILEGE) throw error;
  }
}

// Run as the database owner; safe to repeat. The role is the schema's only
// grantee, so a query that names another tenant's schema is refused by Postgres
// itself. A repeat resets the role's password to the one given.
export async function provisionTenantSchema(admin: pg.Pool | pg.Client, schema: string, password: string): Promise<void> {
  assertSchemaName(schema);
  await assertCollation(admin);
  const client = admin instanceof pg.Pool ? await admin.connect() : admin;
  const dropped = watchCheckedOut(client);
  try {
    await client.query("BEGIN");
    // REQUIRED: concurrent GRANT/REVOKE on the database race on pg_database's ACL row ("tuple concurrently updated").
    await client.query("SELECT pg_advisory_xact_lock($1, 0)", [PROVISION_LOCK_CLASS]);
    const { rows } = await client.query<{ db: string; exists: boolean }>(
      "SELECT current_database() AS db, EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists",
      [schema],
    );
    const { db: database, exists } = rows[0]!;
    await ownerOnly(client, "REVOKE ALL ON SCHEMA public FROM PUBLIC");
    await ownerOnly(client, `REVOKE ALL ON DATABASE ${pg.escapeIdentifier(database)} FROM PUBLIC`);
    const verb = exists ? "ALTER" : "CREATE";
    await client.query(`${verb} ROLE ${schema} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT ${ROLE_CONNECTION_LIMIT} PASSWORD ${pg.escapeLiteral(scramVerifier(password))}`);
    await client.query(`ALTER ROLE ${schema} SET statement_timeout = '${ROLE_STATEMENT_TIMEOUT}'`);
    await client.query(`ALTER ROLE ${schema} SET idle_in_transaction_session_timeout = '${ROLE_IDLE_IN_TRANSACTION_TIMEOUT}'`);
    await client.query(`GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(database)} TO ${schema}`);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema} AUTHORIZATION ${schema}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    dropped.stop();
    if (admin instanceof pg.Pool) (client as pg.PoolClient).release(dropped.happened());
  }
}

export async function dropTenantSchema(admin: pg.Pool | pg.Client, schema: string): Promise<void> {
  assertSchemaName(schema);
  const name = pg.escapeIdentifier(schema);
  const client = admin instanceof pg.Pool ? await admin.connect() : admin;
  const dropped = watchCheckedOut(client);
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, 0)", [PROVISION_LOCK_CLASS]);
    const { rows } = await client.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists", [schema]);
    if (rows[0]?.exists) await client.query(`DROP OWNED BY ${name} CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
    await client.query(`DROP ROLE IF EXISTS ${name}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    dropped.stop();
    if (admin instanceof pg.Pool) (client as pg.PoolClient).release(dropped.happened());
  }
}

const SCRAM_ITERATIONS = 4096;

// SECURITY: Postgres stores this verifier as-is, so the plaintext password never travels in a statement a server log could keep.
export function scramVerifier(password: string): string {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, "sha256");
  const storedKey = createHash("sha256").update(createHmac("sha256", salted).update("Client Key").digest()).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

export function deriveRolePassword(secret: string, schema: string): string {
  return createHmac("sha256", secret).update(`mezan-tenant-role:${assertSchemaName(schema)}`).digest("hex");
}

interface Level {
  queue: Promise<void>;
  readonly of?: OpenTransaction;
}

interface OpenTransaction extends Level {
  readonly client: pg.PoolClient;
  open: boolean;
  savepoints: number;
  readonly committed: (() => void)[];
}

type Queryable = Pick<pg.PoolClient, "query">;

const WRITER_WAIT_MS = 30_000;
const JSON_TEXT = /^\s*[[{]/;
const JSON_NUL_ESCAPE = /(?<!\\)(?:\\\\)*\\u0000/i;

// SECURITY: Postgres refuses a NUL in text, and one written as a JSON escape into a
// JSON-text column breaks every later ::jsonb cast of that column for the whole tenant.
function refuseNulCharacters(params: readonly SqlValue[]): void {
  for (const value of params) {
    if (typeof value !== "string") continue;
    if (value.includes("\u0000") || (JSON_TEXT.test(value) && JSON_NUL_ESCAPE.test(value))) throw new NulCharacterError();
  }
}

// REQUIRED: pg-pool listens for "error" only on idle clients; a checked-out client whose
// server session ends (idle-in-transaction timeout, restart) would otherwise crash the process.
function watchCheckedOut(client: pg.PoolClient | pg.Client): { happened(): boolean; stop(): void } {
  let happened = false;
  const onError = () => {
    happened = true;
  };
  client.on("error", onError);
  return { happened: () => happened, stop: () => client.off("error", onError) };
}

const POOL_TIMEOUT_MESSAGE = "timeout exceeded when trying to connect";

async function busyAware<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof Error && error.message.includes(POOL_TIMEOUT_MESSAGE)) throw new DatabaseBusyError(error);
    throw error;
  }
}

class PostgresDb implements SqlDb {
  readonly dialect = SqlDialect.Postgres;
  private readonly current = new AsyncLocalStorage<OpenTransaction>();
  private readonly level = new AsyncLocalStorage<Level>();
  private writerHeld = false;
  private readonly writersWaiting: (() => void)[] = [];

  constructor(
    private readonly pool: pg.Pool,
    readonly schema: string,
  ) {}

  private target(): Queryable {
    const tx = this.current.getStore();
    return tx?.open ? tx.client : this.pool;
  }

  private async query(sql: string, params: readonly SqlValue[]): Promise<pg.QueryResult> {
    refuseNulCharacters(params);
    return busyAware(this.target().query(numberedPlaceholders(sql), params as unknown[]));
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
    await busyAware(this.target().query(sql));
  }

  afterCommit(fn: () => void): void {
    const tx = this.current.getStore();
    const detached = () => this.current.exit(() => this.level.exit(fn));
    if (tx?.open) tx.committed.push(detached);
    else detached();
  }

  async applySchema(ddl: string): Promise<void> {
    const translated = translateDdl(ddl);
    await this.transaction(async () => {
      await this.exec("SET LOCAL statement_timeout = 0");
      const present = new Set(
        (await this.all<{ t: string; c: string }>("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = current_schema()")).map(
          (row) => `${row.t}.${row.c}`,
        ),
      );
      const tables = new Set([...present].map((key) => key.slice(0, key.indexOf("."))));
      for (const { table, name, type } of declaredAddableColumns(translated)) {
        const key = `${table.toLowerCase()}.${name.toLowerCase()}`;
        if (!tables.has(table.toLowerCase()) || present.has(key)) continue;
        await this.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${type}`);
      }
      await this.exec(translated);
    });
  }

  read<T>(fn: () => Promise<T>): Promise<T> {
    const tx = this.current.getStore();
    return tx?.open ? this.savepoint(tx, fn) : fn();
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const outer = this.current.getStore();
    if (outer?.open) return this.savepoint(outer, fn);

    // REQUIRED: writers queue here, not on the advisory lock, so a burst of writes
    // never holds every pooled connection while reads wait for one.
    await this.takeWriterTurn();
    try {
      return await this.outermost(fn);
    } finally {
      this.passWriterTurn();
    }
  }

  private async takeWriterTurn(): Promise<void> {
    if (!this.writerHeld) {
      this.writerHeld = true;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const at = this.writersWaiting.indexOf(arrive);
        if (at >= 0) this.writersWaiting.splice(at, 1);
        reject(new DatabaseBusyError(new Error(`waited ${WRITER_WAIT_MS}ms for the tenant's writer turn`)));
      }, WRITER_WAIT_MS);
      timer.unref?.();
      const arrive = () => {
        clearTimeout(timer);
        resolve();
      };
      this.writersWaiting.push(arrive);
    });
  }

  private passWriterTurn(): void {
    const next = this.writersWaiting.shift();
    if (next) next();
    else this.writerHeld = false;
  }

  private async outermost<T>(fn: () => Promise<T>): Promise<T> {
    const client = await busyAware(this.pool.connect());
    const tx: OpenTransaction = { client, open: true, savepoints: 0, queue: Promise.resolve(), committed: [] };
    const dropped = watchCheckedOut(client);
    let broken = false;
    try {
      await client.query("BEGIN");
      // REQUIRED: one writer per tenant at a time, as on SQLite. Every caller in
      // this codebase was written against SQLite's single writer, so check-then-
      // write sequences (stock, credit limits, numbering) rely on it.
      const { rows } = await client.query<{ schema: string | null; role: string | null }>(
        "SELECT pg_advisory_xact_lock($1, hashtext($2)), current_schema() AS schema, current_user AS role",
        [TENANT_LOCK_CLASS, this.schema],
      );
      if (rows[0]?.schema !== this.schema) throw new TenantSchemaMismatchError(this.schema, rows[0]?.schema ?? null);
      if (rows[0]?.role !== this.schema) throw new TenantRoleMismatchError(this.schema, rows[0]?.role ?? null);
      const result = await this.current.run(tx, fn);
      // A statement that failed inside `fn` aborts the transaction even when `fn`
      // caught it, and Postgres then answers COMMIT with ROLLBACK, not an error.
      const commit = await client.query("COMMIT");
      if (commit.command !== "COMMIT") throw new TransactionAbortedError();
      tx.open = false;
      for (const follow of tx.committed) setImmediate(follow);
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
      dropped.stop();
      client.release(broken || dropped.happened());
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
    if (!tx.open) throw new TransactionAbortedError();
    const name = `sp_${++tx.savepoints}`;
    const followUps = tx.committed.length;
    await tx.client.query(`SAVEPOINT ${name}`);
    try {
      const result = await fn();
      await tx.client.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      tx.committed.length = followUps;
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
