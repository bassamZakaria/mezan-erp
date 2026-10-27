import { createHmac } from "node:crypto";
import pg from "pg";
import type { SqlDb } from "@mezan/persistence";
import { assertCollation, assertSchemaName, createTenantPool, deriveRolePassword, PLATFORM_SCHEMA, postgresDb, provisionTenantSchema } from "./postgres-db.js";

const SECRET_RE = /^[0-9a-f]{64}$/;

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

export interface TenantDatabasesOptions {
  readonly connectionString: string;
  readonly secret: string;
  readonly maxConnectionsPerSchema?: number;
}

export interface SchemaDatabase {
  readonly schema: string;
  readonly pool: pg.Pool;
  readonly db: SqlDb;
}

// The cloud's one door to Postgres: an owner pool used only to provision, and
// one pool per schema that connects as that schema's own role.
export class TenantDatabases {
  private readonly admin: pg.Pool;
  private readonly open = new Map<string, SchemaDatabase>();

  constructor(private readonly options: TenantDatabasesOptions) {
    if (!SECRET_RE.test(options.secret)) throw new InvalidTenantDbSecretError();
    this.admin = new pg.Pool({ connectionString: options.connectionString, max: 2 });
  }

  assertCollation(): Promise<void> {
    return assertCollation(this.admin);
  }

  async provision(schema: string): Promise<void> {
    await provisionTenantSchema(this.admin, schema, deriveRolePassword(this.options.secret, schema));
  }

  // CONTRACT: derived from MEZAN_TENANT_DB_SECRET; rotating the secret invalidates every evidence pack already signed.
  evidenceKey(schema: string): string {
    return createHmac("sha256", this.options.secret).update(`mezan-tenant-evidence:${assertSchemaName(schema)}`).digest("hex");
  }

  get(schema: string): SchemaDatabase {
    assertSchemaName(schema);
    let entry = this.open.get(schema);
    if (!entry) {
      const pool = createTenantPool({
        connectionString: this.options.connectionString,
        schema,
        password: deriveRolePassword(this.options.secret, schema),
        max: this.options.maxConnectionsPerSchema ?? 5,
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

  // Run as the database owner. The role carries the schema's name; a role
  // already gone means an earlier drop got that far, so a repeat finishes it.
  async drop(schema: string): Promise<void> {
    assertSchemaName(schema);
    if (schema === PLATFORM_SCHEMA) throw new PlatformSchemaDropRefusedError();
    await this.release(schema);
    const name = pg.escapeIdentifier(schema);
    const { rows } = await this.admin.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists", [schema]);
    if (rows[0]?.exists) await this.admin.query(`DROP OWNED BY ${name} CASCADE`);
    await this.admin.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
    await this.admin.query(`DROP ROLE IF EXISTS ${name}`);
  }

  async close(): Promise<void> {
    await Promise.all([...this.open.keys()].map((schema) => this.release(schema)));
    await this.admin.end();
  }
}
