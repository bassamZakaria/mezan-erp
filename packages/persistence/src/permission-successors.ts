import { SqlDialect, type SqlDb } from "./sql/sql-db.js";

const MARKER_TABLE = `CREATE TABLE IF NOT EXISTS permission_grant_marker (name TEXT PRIMARY KEY, granted_at TEXT NOT NULL)`;

async function hasRoleTable(db: SqlDb): Promise<boolean> {
  const sql =
    db.dialect === SqlDialect.Postgres
      ? `SELECT 1 AS present FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'role'`
      : `SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'role'`;
  return (await db.get(sql)) !== undefined;
}

/**
 * INVARIANT: runs once per books and marker. A permission split off an
 * older one is given to every role that held the older one, so nobody loses an
 * ability on upgrade; after that the marker stands, and a grant an
 * administrator later removes is never put back.
 */
export async function grantSuccessorPermissionsOnce(db: SqlDb, marker: string, successors: ReadonlyMap<string, readonly string[]>): Promise<number> {
  await db.applySchema(MARKER_TABLE);
  if (await db.get(`SELECT 1 AS granted FROM permission_grant_marker WHERE name = ?`, [marker])) return 0;
  return db.transaction(async (): Promise<number> => {
    let changed = 0;
    if (await hasRoleTable(db)) {
      for (const row of await db.all<{ id: string; permissions: string }>(`SELECT id, permissions FROM role`)) {
        let permissions: unknown;
        try {
          permissions = JSON.parse(row.permissions);
        } catch {
          continue;
        }
        if (!Array.isArray(permissions)) continue;
        const held = new Set(permissions as string[]);
        const added = [...successors].flatMap(([older, newer]) => (held.has(older) ? newer.filter((code) => !held.has(code)) : []));
        const fresh = [...new Set(added)];
        if (fresh.length === 0) continue;
        await db.run(`UPDATE role SET permissions = ? WHERE id = ?`, [JSON.stringify([...(permissions as string[]), ...fresh]), row.id]);
        changed += 1;
      }
    }
    await db.run(`INSERT INTO permission_grant_marker (name, granted_at) VALUES (?, ?)`, [marker, new Date().toISOString()]);
    return changed;
  });
}
