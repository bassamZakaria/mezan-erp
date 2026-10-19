import type Database from "better-sqlite3";

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
  find(tenantId: string): TenantRetentionRecord | null;
  /** Idempotent: a tenant already scheduled keeps the date it was given. */
  schedule(tenantId: string, terminatedAt: string, deleteAfter: string): TenantRetentionRecord;
  /** Moves the date only forward; false when `deleteAfter` is not later than the stored one. */
  extend(tenantId: string, deleteAfter: string, by: { readonly actor: string; readonly at: string; readonly reason: string }): boolean;
  due(nowIso: string): readonly TenantRetentionRecord[];
  tombstoneOf(tenantId: string): TenantTombstone | null;
  /**
   * REQUIRED ORDERING: run inside the caller's platform transaction, after the tenant's files are gone. Removes
   * the tenant row and the rows that carry the tenant's own data (signup requests, module trials, the schedule)
   * and leaves only the tombstone. The platform's own billing records (subscriptions, payments, card checkouts)
   * and its audit trail are kept.
   */
  removeTenantRows(tenant: { readonly id: string; readonly code: string }, deletedAt: string): void;
}

interface RetentionRow {
  tenant_id: string;
  terminated_at: string;
  delete_after: string;
  extended_by: string | null;
  extended_at: string | null;
  extended_reason: string | null;
}

const recordOf = (row: RetentionRow): TenantRetentionRecord => ({
  tenantId: row.tenant_id,
  terminatedAt: row.terminated_at,
  deleteAfter: row.delete_after,
  lastExtension: row.extended_by && row.extended_at ? { by: row.extended_by, at: row.extended_at, reason: row.extended_reason ?? "" } : null,
});

export function createTenantRetentionStore(sqlite: Database.Database): TenantRetentionStore {
  sqlite.exec(SCHEMA);
  const byId = sqlite.prepare(`SELECT * FROM tenant_retention WHERE tenant_id = ?`);
  const insert = sqlite.prepare(`INSERT OR IGNORE INTO tenant_retention (tenant_id, terminated_at, delete_after) VALUES (?, ?, ?)`);
  const extend = sqlite.prepare(
    `UPDATE tenant_retention SET delete_after = @deleteAfter, extended_by = @actor, extended_at = @at, extended_reason = @reason WHERE tenant_id = @tenantId AND delete_after < @deleteAfter`,
  );
  const due = sqlite.prepare(`SELECT * FROM tenant_retention WHERE delete_after <= ? ORDER BY delete_after, tenant_id`);
  const tombstone = sqlite.prepare(`SELECT id, code, deleted_at AS deletedAt FROM tenant_tombstone WHERE id = ?`);
  const removals = [
    sqlite.prepare(`DELETE FROM tenant WHERE id = @id`),
    sqlite.prepare(`DELETE FROM signup_request WHERE code = @code`),
    sqlite.prepare(`DELETE FROM module_trial WHERE tenant_id = @id`),
    sqlite.prepare(`DELETE FROM tenant_retention WHERE tenant_id = @id`),
  ];
  const bury = sqlite.prepare(`INSERT OR IGNORE INTO tenant_tombstone (id, code, deleted_at) VALUES (@id, @code, @deletedAt)`);
  return {
    find(tenantId) {
      const row = byId.get(tenantId) as RetentionRow | undefined;
      return row ? recordOf(row) : null;
    },
    schedule(tenantId, terminatedAt, deleteAfter) {
      insert.run(tenantId, terminatedAt, deleteAfter);
      return recordOf(byId.get(tenantId) as RetentionRow);
    },
    extend(tenantId, deleteAfter, by) {
      return extend.run({ tenantId, deleteAfter, actor: by.actor, at: by.at, reason: by.reason }).changes === 1;
    },
    due(nowIso) {
      return (due.all(nowIso) as RetentionRow[]).map(recordOf);
    },
    tombstoneOf(tenantId) {
      return (tombstone.get(tenantId) as TenantTombstone | undefined) ?? null;
    },
    removeTenantRows(tenant, deletedAt) {
      for (const statement of removals) statement.run({ id: tenant.id, code: tenant.code });
      bury.run({ id: tenant.id, code: tenant.code, deletedAt });
    },
  };
}
