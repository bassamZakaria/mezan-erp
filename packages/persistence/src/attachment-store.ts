import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { refuseUnlessInserted } from "./insert-new.js";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import type { Attachment, AttachmentContent, AttachmentEntityType, AttachmentRepository } from "@mezan/domain";

/**
 * SQL-backed المرفقات store. The bytes live in the same database as
 * everything else, so the desktop backup — which copies that one file — carries
 * the attachments with it and a restore is not silently missing them.
 *
 * No listing statement selects `content`: a list of ten 5 MiB files would
 * otherwise pull 50 MiB through the route to render a table of names.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS attachment (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  byte_size   INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  notes       TEXT,
  content     BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachment_entity ON attachment (entity_type, entity_id);
`;

const META_COLUMNS = `id, entity_type, entity_id, file_name, mime_type, byte_size, uploaded_by, uploaded_at, notes`;

interface AttachmentRow {
  id: string;
  entity_type: string;
  entity_id: string;
  file_name: string;
  mime_type: string;
  byte_size: bigint;
  uploaded_by: string;
  uploaded_at: string;
  notes: string | null;
}

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    entityType: row.entity_type as AttachmentEntityType,
    entityId: row.entity_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    notes: row.notes,
  };
}

class SqlAttachmentRepository implements AttachmentRepository {
  constructor(private readonly db: SqlDb) {}

  async list(entityType: AttachmentEntityType, entityId: string): Promise<Attachment[]> {
    return (
      await this.db.all<AttachmentRow>(`SELECT ${META_COLUMNS} FROM attachment WHERE entity_type = ? AND entity_id = ? ORDER BY uploaded_at DESC, id DESC`, [entityType, entityId])
    ).map(toAttachment);
  }

  async listAll(): Promise<Attachment[]> {
    return (await this.db.all<AttachmentRow>(`SELECT ${META_COLUMNS} FROM attachment ORDER BY uploaded_at DESC, id DESC`)).map(toAttachment);
  }

  async findById(id: string): Promise<Attachment | null> {
    const row = await this.db.get<AttachmentRow>(`SELECT ${META_COLUMNS} FROM attachment WHERE id = ?`, [id]);
    return row ? toAttachment(row) : null;
  }

  async readContent(id: string): Promise<AttachmentContent | null> {
    const row = await this.db.get<AttachmentRow & { content: Uint8Array }>(`SELECT ${META_COLUMNS}, content FROM attachment WHERE id = ?`, [id]);
    if (!row) return null;
    return { attachment: toAttachment(row), bytes: new Uint8Array(row.content) };
  }

  async create(attachment: Attachment, bytes: Uint8Array): Promise<void> {
    const inserted = await this.db.run(
      `INSERT INTO attachment (${META_COLUMNS}, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      [
        attachment.id,
        attachment.entityType,
        attachment.entityId,
        attachment.fileName,
        attachment.mimeType,
        attachment.byteSize,
        attachment.uploadedBy,
        attachment.uploadedAt,
        attachment.notes,
        Buffer.from(bytes),
      ],
    );
    refuseUnlessInserted(attachment.id, inserted.changes);
  }

  async totalBytes(): Promise<number> {
    const row = await this.db.get<{ bytes: bigint | null }>(`SELECT CAST(COALESCE(SUM(byte_size), 0) AS BIGINT) AS bytes FROM attachment`);
    return Number(row?.bytes ?? 0);
  }

  async delete(id: string): Promise<void> {
    await this.db.run(`DELETE FROM attachment WHERE id = ?`, [id]);
  }
}

export async function ensureAttachmentSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createAttachmentRepository(db: SqlDb): AttachmentRepository {
  return new SqlAttachmentRepository(db);
}

/** Build the store on an EXISTING connection, so a composed app keeps one DB handle. */
export function createSqliteAttachmentRepository(sqlite: Database.Database): AttachmentRepository {
  sqlite.exec(CREATE_TABLE);
  return createAttachmentRepository(sqliteDb(sqlite));
}

export interface SqliteAttachmentStoreHandle {
  readonly attachments: AttachmentRepository;
  close(): void;
}

/** Open a SQLite-backed المرفقات store. ":memory:" for a throwaway, a path for real. */
export function createSqliteAttachmentStore(path: SqliteConnectionInput = ":memory:"): SqliteAttachmentStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  return {
    attachments: createSqliteAttachmentRepository(sqlite),
    close: () => {
      if (owned) sqlite.close();
    },
  };
}
