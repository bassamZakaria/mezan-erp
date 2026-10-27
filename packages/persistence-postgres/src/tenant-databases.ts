import pg from "pg";
import type { SqlDb } from "@mezan/persistence";
import { assertSchemaName, createTenantPool, deriveRolePassword, postgresDb, provisionTenantSchema } from "./postgres-db.js";

const SECRET_RE = /^[0-9a-f]{64}$/;

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

  async provision(schema: string): Promise<void> {
    await provisionTenantSchema(this.admin, schema, deriveRolePassword(this.options.secret, schema));
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

  async release(schema: string): Promise<void> {
    const entry = this.open.get(schema);
    if (!entry) return;
    this.open.delete(schema);
    await entry.pool.end();
  }

  async close(): Promise<void> {
    await Promise.all([...this.open.keys()].map((schema) => this.release(schema)));
    await this.admin.end();
  }
}
