import type Database from "better-sqlite3";

const MARKER_TABLE = `CREATE TABLE IF NOT EXISTS permission_grant_marker (name TEXT PRIMARY KEY, granted_at TEXT NOT NULL)`;

/**
 * INVARIANT: runs once per books file and marker. A permission split off an
 * older one is given to every role that held the older one, so nobody loses an
 * ability on upgrade; after that the marker stands, and a grant an
 * administrator later removes is never put back.
 */
export function grantSuccessorPermissionsOnce(sqlite: Database.Database, marker: string, successors: ReadonlyMap<string, readonly string[]>): number {
  sqlite.exec(MARKER_TABLE);
  if (sqlite.prepare(`SELECT 1 FROM permission_grant_marker WHERE name = ?`).get(marker)) return 0;
  const grant = sqlite.transaction((): number => {
    let changed = 0;
    const hasRoles = sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'role'`).get() !== undefined;
    if (hasRoles) {
      const update = sqlite.prepare(`UPDATE role SET permissions = ? WHERE id = ?`);
      for (const row of sqlite.prepare(`SELECT id, permissions FROM role`).all() as { id: string; permissions: string }[]) {
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
        update.run(JSON.stringify([...(permissions as string[]), ...fresh]), row.id);
        changed += 1;
      }
    }
    sqlite.prepare(`INSERT INTO permission_grant_marker (name, granted_at) VALUES (?, ?)`).run(marker, new Date().toISOString());
    return changed;
  });
  return grant();
}
