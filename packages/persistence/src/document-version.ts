import type Database from "better-sqlite3";

/**
 * الإصدار (row version) — optimistic concurrency for the documents two tills can
 * open at once (N-9).
 *
 * Before this, an update was last-write-wins and silent: two cashiers opened
 * the same invoice, both acted, and one act vanished with no trace anywhere.
 *
 * The version lives HERE, in persistence, and not on the domain entity, on
 * purpose: it is a property of the stored row, not of the document, and
 * threading it through every constructor and fixture would have changed far
 * more than the concurrency it guards.
 *
 * `last_modified_by` is what lets the refusal name a person. It is stamped by
 * the route that performed the winning change, so the next caller is told who
 * moved the document rather than only that somebody did.
 */
export interface DocumentVersionRow {
  readonly version: number;
  readonly lastModifiedBy: string | null;
}

export class StaleDocumentError extends Error {
  readonly code = "DOCUMENT_VERSION_CONFLICT";
  constructor(
    readonly id: string,
    readonly expected: number,
    readonly actual: number,
    readonly lastModifiedBy: string | null,
  ) {
    super(`Document "${id}" moved from version ${expected} to ${actual}.`);
    this.name = "StaleDocumentError";
  }
}

/** Adds the two columns to an existing table; new rows start at version 1. */
export function addVersionColumns(sqlite: Database.Database, table: string): void {
  const existing = new Set(
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!existing.has("version")) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
  }
  if (!existing.has("last_modified_by")) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN last_modified_by TEXT`);
  }
}

export interface DocumentVersionStore {
  read(id: string): Promise<DocumentVersionRow | null>;
  /**
   * The versions for a whole list page in ONE statement. A list serializer must
   * never fall back to `read` per row: that is a query per line of the screen.
   */
  readMany(ids: readonly string[]): Promise<ReadonlyMap<string, number>>;
  /** Called by every write path, so ANY change to the row moves the version. */
  bump(id: string): void;
  /** Records who made the change that just won, so the next stale caller can be told. */
  stampModifier(id: string, actor: string | null): Promise<void>;
}

const ID_CHUNK = 500;

export function createDocumentVersionStore(sqlite: Database.Database, table: string): DocumentVersionStore {
  const select = sqlite.prepare(`SELECT version, last_modified_by FROM ${table} WHERE id = ?`);
  const increment = sqlite.prepare(`UPDATE ${table} SET version = version + 1 WHERE id = ?`);
  const stamp = sqlite.prepare(`UPDATE ${table} SET last_modified_by = ? WHERE id = ?`);
  return {
    async read(id) {
      const row = select.get(id) as { version: number; last_modified_by: string | null } | undefined;
      return row ? { version: row.version, lastModifiedBy: row.last_modified_by } : null;
    },
    async readMany(ids) {
      const found = new Map<string, number>();
      // SQLite caps bound parameters per statement, so a long page is chunked
      // rather than sent as one enormous IN list.
      for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const chunk = ids.slice(i, i + ID_CHUNK);
        const rows = sqlite
          .prepare(`SELECT id, version FROM ${table} WHERE id IN (${chunk.map(() => "?").join(",")})`)
          .all(...chunk) as { id: string; version: number }[];
        for (const row of rows) found.set(row.id, row.version);
      }
      return found;
    },
    bump(id) {
      increment.run(id);
    },
    async stampModifier(id, actor) {
      stamp.run(actor, id);
    },
  };
}
