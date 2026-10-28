import { createHmac } from "node:crypto";
import pg from "pg";
import type { SqlDb } from "@mezan/persistence";
import { assertCollation, assertSchemaName, CONNECT_TIMEOUT_MS, createTenantPool, dropTenantSchema, deriveRolePassword, PLATFORM_SCHEMA, postgresDb, provisionTenantSchema } from "./postgres-db.js";

const SECRET_RE = /^[0-9a-f]{64}$/;
const PLATFORM_POOL_MAX = 8;

export class PlatformSchemaDropRefusedError extends Error {
  constructor() {
    super(`The "${PLATFORM_SCHEMA}" schema is never dropped.`);
  }
}

export class InvalidTenantDbSecretError extends Error {
  constructor() {
    super("MEZAN_TENANT_DB_SECRET must be 64 lower-case hex characters.");
  }
}

export enum SchemaKeyPurpose {
  Audit = "audit",
  Evidence = "evidence",
}

// CONTRACT: every audit chain and evidence pack of a schema is keyed on this; changing the master key or the derivation makes them all read as altered.
export function schemaKey(masterKey: string, purpose: SchemaKeyPurpose, schema: string): string {
  return createHmac("sha256", masterKey).update(`mezan-schema-key:${purpose}:${assertSchemaName(schema)}`).digest("hex");
}

export interface TenantDatabasesOptions {
  readonly connectionString: string;
  readonly secret: string;
  readonly maxConnectionsPerSchema?: number;
  readonly onPoolError?: (error: Error, schema: string) => void;
}

export interface SchemaDatabase {
  readonly schema: string;
  readonly pool: pg.Pool;
  readonly db: SqlDb;
}

export class TenantDatabases {
  private readonly admin: pg.Pool;
  private readonly open = new Map<string, SchemaDatabase>();

  constructor(private readonly options: TenantDatabasesOptions) {
    if (!SECRET_RE.test(options.secret)) throw new InvalidTenantDbSecretError();
    this.admin = new pg.Pool({ connectionString: options.connectionString, max: 2, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
    this.admin.on("error", (error) => options.onPoolError?.(error, "admin"));
  }

  assertCollation(): Promise<void> {
    return assertCollation(this.admin);
  }

  async provision(schema: string): Promise<void> {
    await provisionTenantSchema(this.admin, schema, deriveRolePassword(this.options.secret, schema));
  }

  // Re-sets each existing schema's role (its password follows the current secret) and
  // returns the schemas that do not exist, which must never be recreated empty here.
  async reprovisionExisting(schemas: readonly string[]): Promise<string[]> {
    const { rows } = await this.admin.query<{ nspname: string }>("SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[])", [schemas.map(assertSchemaName)]);
    const present = new Set(rows.map((row) => row.nspname));
    for (const schema of schemas) if (present.has(schema)) await this.provision(schema);
    return schemas.filter((schema) => !present.has(schema));
  }

  get(schema: string): SchemaDatabase {
    assertSchemaName(schema);
    let entry = this.open.get(schema);
    if (!entry) {
      const pool = createTenantPool({
        connectionString: this.options.connectionString,
        schema,
        password: deriveRolePassword(this.options.secret, schema),
        max: schema === PLATFORM_SCHEMA ? PLATFORM_POOL_MAX : (this.options.maxConnectionsPerSchema ?? 3),
        ...(this.options.onPoolError ? { onError: this.options.onPoolError } : {}),
      });
      entry = { schema, pool, db: postgresDb(pool, schema) };
      this.open.set(schema, entry);
    }
    return entry;
  }

  // REQUIRED ORDERING: detach before the pool's user closes, then end the pool.
  // The next `get` of the schema opens a fresh pool instead of one about to end.
  detach(entry: SchemaDatabase): void {
    if (this.open.get(entry.schema) === entry) this.open.delete(entry.schema);
  }

  async release(schema: string): Promise<void> {
    const entry = this.open.get(schema);
    if (!entry) return;
    this.open.delete(schema);
    await entry.pool.end();
  }

  async drop(schema: string): Promise<void> {
    assertSchemaName(schema);
    if (schema === PLATFORM_SCHEMA) throw new PlatformSchemaDropRefusedError();
    await this.release(schema);
    await dropTenantSchema(this.admin, schema);
  }

  async close(): Promise<void> {
    await Promise.all([...this.open.keys()].map((schema) => this.release(schema)));
    await this.admin.end();
  }
}
