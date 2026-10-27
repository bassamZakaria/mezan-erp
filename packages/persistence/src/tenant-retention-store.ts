import type Database from "better-sqlite3";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenant_retention (
  tenant_id        TEXT PRIMARY KEY,
  terminated_at    TEXT NOT NULL,
  delete_after     TEXT NOT NULL,
  extended_by      TEXT,
  extended_at      TEXT,
  extended_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_tenant_retention_due ON tenant_retention(delete_after);
CREATE TABLE IF NOT EXISTS tenant_tombstone (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  deleted_at  TEXT NOT NULL
);
`;

export interface TenantRetentionRecord {
  readonly tenantId: string;
  readonly terminatedAt: string;
  readonly deleteAfter: string;
  readonly lastExtension: { readonly by: string; readonly at: string; readonly reason: string } | null;
}

export interface TenantTombstone {
  readonly id: string;
  readonly code: string;
  readonly deletedAt: string;
}

export interface TenantRetentionStore {
  find(tenantId: string): Promise<TenantRetentionRecord | null>;
  /** Idempotent: a tenant already scheduled keeps the date it was given. */
  schedule(tenantId: string, terminatedAt: string, deleteAfter: string): Promise<TenantRetentionRecord>;
  /** Moves the date only forward; false when `deleteAfter` is not later than the stored one. */
  extend(tenantId: string, deleteAfter: string, by: { readonly actor: string; readonly at: string; readonly reason: string }): Promise<boolean>;
  due(nowIso: string): Promise<readonly TenantRetentionRecord[]>;
  tombstoneOf(tenantId: string): Promise<TenantTombstone | null>;
  /**
   * REQUIRED ORDERING: run inside the caller's platform transaction, after the tenant's files are gone. Removes
   * the tenant row and the rows that carry the tenant's own data (signup requests, module trials, the schedule)
   * and leaves only the tombstone. The platform's own billing records (subscriptions, payments, card checkouts)
   * and its audit trail are kept.
   */
  removeTenantRows(tenant: { readonly id: string; readonly code: string }, deletedAt: string): Promise<void>;
}

interface RetentionRow {
  tenant_id: string;
  terminated_at: string;
  delete_after: string;
  extended_by: string | null;
  extended_at: string | null;
  extended_reason: string | null;
}

const COLUMNS = "tenant_id, terminated_at, delete_after, extended_by, extended_at, extended_reason";

const recordOf = (row: RetentionRow): TenantRetentionRecord => ({
  tenantId: row.tenant_id,
  terminatedAt: row.terminated_at,
  deleteAfter: row.delete_after,
  lastExtension: row.extended_by && row.extended_at ? { by: row.extended_by, at: row.extended_at, reason: row.extended_reason ?? "" } : null,
});

export async function ensureTenantRetentionSchema(db: SqlDb): Promise<void> {
  await db.applySchema(SCHEMA);
}

export function createTenantRetentionStoreOn(db: SqlDb): TenantRetentionStore {
  const byId = (tenantId: string) => db.get<RetentionRow>(`SELECT ${COLUMNS} FROM tenant_retention WHERE tenant_id = ?`, [tenantId]);
  return {
    async find(tenantId) {
      const row = await byId(tenantId);
      return row ? recordOf(row) : null;
    },
    async schedule(tenantId, terminatedAt, deleteAfter) {
      await db.run(`INSERT INTO tenant_retention (tenant_id, terminated_at, delete_after) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`, [tenantId, terminatedAt, deleteAfter]);
      return recordOf((await byId(tenantId))!);
    },
    async extend(tenantId, deleteAfter, by) {
      const result = await db.run(
        `UPDATE tenant_retention SET delete_after = ?, extended_by = ?, extended_at = ?, extended_reason = ? WHERE tenant_id = ? AND delete_after < ?`,
        [deleteAfter, by.actor, by.at, by.reason, tenantId, deleteAfter],
      );
      return result.changes === 1;
    },
    async due(nowIso) {
      return (await db.all<RetentionRow>(`SELECT ${COLUMNS} FROM tenant_retention WHERE delete_after <= ? ORDER BY delete_after, tenant_id`, [nowIso])).map(recordOf);
    },
    async tombstoneOf(tenantId) {
      return (await db.get<TenantTombstone>(`SELECT id, code, deleted_at AS "deletedAt" FROM tenant_tombstone WHERE id = ?`, [tenantId])) ?? null;
    },
    async removeTenantRows(tenant, deletedAt) {
      await db.run(`DELETE FROM tenant WHERE id = ?`, [tenant.id]);
      await db.run(`DELETE FROM signup_request WHERE code = ?`, [tenant.code]);
      await db.run(`DELETE FROM module_trial WHERE tenant_id = ?`, [tenant.id]);
      await db.run(`DELETE FROM tenant_retention WHERE tenant_id = ?`, [tenant.id]);
      await db.run(`INSERT INTO tenant_tombstone (id, code, deleted_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`, [tenant.id, tenant.code, deletedAt]);
    },
  };
}

export function createTenantRetentionStore(sqlite: Database.Database): TenantRetentionStore {
  sqlite.exec(SCHEMA);
  return createTenantRetentionStoreOn(sqliteDb(sqlite));
}
