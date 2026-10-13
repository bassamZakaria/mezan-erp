import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertingNew } from "./insert-new.js";
import type { Attachment, AttachmentContent, AttachmentEntityType, AttachmentRepository } from "@mezan/domain";

/**
 * SQLite-backed المرفقات store. The bytes live in the same database file as
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
  byte_size: number;
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
    byteSize: row.byte_size,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    notes: row.notes,
  };
}

class SqliteAttachmentRepository implements AttachmentRepository {
  private readonly insert: Database.Statement;
  private readonly selectByEntity: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectContentById: Database.Statement;
  private readonly deleteById: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.insert = sqlite.prepare(`
      INSERT INTO attachment (id, entity_type, entity_id, file_name, mime_type, byte_size, uploaded_by, uploaded_at, notes, content)
      VALUES (@id, @entity_type, @entity_id, @file_name, @mime_type, @byte_size, @uploaded_by, @uploaded_at, @notes, @content)
    `);
    this.selectByEntity = sqlite.prepare(
      `SELECT ${META_COLUMNS} FROM attachment WHERE entity_type = ? AND entity_id = ? ORDER BY uploaded_at DESC, id DESC`,
    );
    this.selectAll = sqlite.prepare(`SELECT ${META_COLUMNS} FROM attachment ORDER BY uploaded_at DESC, id DESC`);
    this.selectById = sqlite.prepare(`SELECT ${META_COLUMNS} FROM attachment WHERE id = ?`);
    this.selectContentById = sqlite.prepare(`SELECT ${META_COLUMNS}, content FROM attachment WHERE id = ?`);
    this.deleteById = sqlite.prepare(`DELETE FROM attachment WHERE id = ?`);
  }

  async list(entityType: AttachmentEntityType, entityId: string): Promise<Attachment[]> {
    return (this.selectByEntity.all(entityType, entityId) as AttachmentRow[]).map(toAttachment);
  }

  async listAll(): Promise<Attachment[]> {
    return (this.selectAll.all() as AttachmentRow[]).map(toAttachment);
  }

  async findById(id: string): Promise<Attachment | null> {
    const row = this.selectById.get(id) as AttachmentRow | undefined;
    return row ? toAttachment(row) : null;
  }

  async readContent(id: string): Promise<AttachmentContent | null> {
    const row = this.selectContentById.get(id) as (AttachmentRow & { content: Buffer }) | undefined;
    if (!row) return null;
    return { attachment: toAttachment(row), bytes: new Uint8Array(row.content) };
  }

  async create(attachment: Attachment, bytes: Uint8Array): Promise<void> {
    insertingNew(attachment.id, () => this.insert.run({
      id: attachment.id,
      entity_type: attachment.entityType,
      entity_id: attachment.entityId,
      file_name: attachment.fileName,
      mime_type: attachment.mimeType,
      byte_size: attachment.byteSize,
      uploaded_by: attachment.uploadedBy,
      uploaded_at: attachment.uploadedAt,
      notes: attachment.notes,
      content: Buffer.from(bytes),
    }));
  }

  async delete(id: string): Promise<void> {
    this.deleteById.run(id);
  }
}

/** Build the store on an EXISTING connection, so a composed app keeps one DB handle. */
export function createSqliteAttachmentRepository(sqlite: Database.Database): AttachmentRepository {
  sqlite.exec(CREATE_TABLE);
  return new SqliteAttachmentRepository(sqlite);
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
