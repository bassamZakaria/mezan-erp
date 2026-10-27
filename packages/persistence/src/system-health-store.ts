import { statSync } from "node:fs";
import type Database from "better-sqlite3";
import { EtaSubmissionStatusCode, NotificationChannelState } from "@mezan/domain";
import { SqlDialect, type SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

export interface OutboxHealthReading {
  readonly queued: number;
  readonly failed: number;
  readonly oldestQueuedAt: string | null;
}

export interface EtaHealthError {
  readonly internalId: string;
  readonly documentType: string;
  readonly updatedAt: string;
  readonly message: string | null;
}

export interface EtaHealthReading {
  readonly ready: number;
  readonly pendingSignature: number;
  readonly error: number;
  readonly submitted: number;
  readonly oldestUnsentAt: string | null;
  readonly recentErrors: readonly EtaHealthError[];
}

export interface DatabaseHealthReading {
  readonly dbBytes: number;
  readonly walBytes: number | null;
  readonly freeListBytes: number;
}

export interface SystemHealthStore {
  outbox(): Promise<OutboxHealthReading>;
  eta(recentErrorLimit: number): Promise<EtaHealthReading>;
  database(): Promise<DatabaseHealthReading>;
}

const MESSAGE_MAX = 240;

function firstMessage(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const first = Array.isArray(parsed) ? parsed[0] : null;
    if (typeof first === "string") return first.slice(0, MESSAGE_MAX);
    if (first && typeof first === "object" && typeof (first as { message?: unknown }).message === "string") {
      return (first as { message: string }).message.slice(0, MESSAGE_MAX);
    }
  } catch {
    return null;
  }
  return null;
}

function fileBytes(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

function outboxSql(db: SqlDb): string {
  const channels = db.dialect === SqlDialect.Postgres ? "jsonb_each_text(n.channel_status_json::jsonb) j" : "json_each(n.channel_status_json) j";
  return `SELECT
       COALESCE(SUM(CASE WHEN j.value = ? THEN 1 ELSE 0 END), 0) AS queued,
       COALESCE(SUM(CASE WHEN j.value = ? THEN 1 ELSE 0 END), 0) AS failed,
       MIN(CASE WHEN j.value = ? THEN n.created_at END) AS oldest
     FROM notification n, ${channels}
     WHERE n.channel_status_json LIKE '%"queued"%' OR n.channel_status_json LIKE '%"failed"%'`;
}

async function databaseReading(db: SqlDb, dbFile: string | null): Promise<DatabaseHealthReading> {
  if (db.dialect === SqlDialect.Postgres) {
    const row = await db.get<{ bytes: bigint }>(
      `SELECT CAST(COALESCE(SUM(pg_total_relation_size(c.oid)), 0) AS BIGINT) AS bytes
         FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = current_schema() AND c.relkind = 'r'`,
    );
    return { dbBytes: Number(row!.bytes), walBytes: null, freeListBytes: 0 };
  }
  const row = await db.get<{ page_size: bigint; page_count: bigint; freelist_count: bigint }>(
    `SELECT s.page_size AS page_size, c.page_count AS page_count, f.freelist_count AS freelist_count
       FROM pragma_page_size() s, pragma_page_count() c, pragma_freelist_count() f`,
  );
  const pageSize = Number(row!.page_size);
  const wal = dbFile && dbFile !== ":memory:" ? fileBytes(`${dbFile}-wal`) : null;
  return { dbBytes: pageSize * Number(row!.page_count), walBytes: wal, freeListBytes: pageSize * Number(row!.freelist_count) };
}

export function createSystemHealthStore(db: SqlDb, dbFile: string | null = null): SystemHealthStore {
  const unsent = [EtaSubmissionStatusCode.Ready, EtaSubmissionStatusCode.PendingSignature, EtaSubmissionStatusCode.Error];
  return {
    async outbox() {
      const row = (await db.get<{ queued: bigint; failed: bigint; oldest: string | null }>(outboxSql(db), [
        NotificationChannelState.Queued,
        NotificationChannelState.Failed,
        NotificationChannelState.Queued,
      ]))!;
      return { queued: Number(row.queued), failed: Number(row.failed), oldestQueuedAt: row.oldest };
    },
    async eta(recentErrorLimit) {
      const counts = new Map<string, number>();
      for (const row of await db.all<{ status: string; c: bigint }>(`SELECT status, COUNT(*) AS c FROM eta_submission GROUP BY status`)) counts.set(row.status, Number(row.c));
      const oldest = await db.get<{ oldest: string | null }>(`SELECT MIN(created_at) AS oldest FROM eta_submission WHERE status IN (?, ?, ?)`, unsent);
      const errors = await db.all<{ internal_id: string; document_type: string; updated_at: string; errors: string }>(
        `SELECT internal_id, document_type, updated_at, errors FROM eta_submission WHERE status = ? ORDER BY updated_at DESC LIMIT ?`,
        [EtaSubmissionStatusCode.Error, recentErrorLimit],
      );
      return {
        ready: counts.get(EtaSubmissionStatusCode.Ready) ?? 0,
        pendingSignature: counts.get(EtaSubmissionStatusCode.PendingSignature) ?? 0,
        error: counts.get(EtaSubmissionStatusCode.Error) ?? 0,
        submitted: counts.get(EtaSubmissionStatusCode.Submitted) ?? 0,
        oldestUnsentAt: oldest?.oldest ?? null,
        recentErrors: errors.map((r) => ({
          internalId: r.internal_id,
          documentType: r.document_type,
          updatedAt: r.updated_at,
          message: firstMessage(r.errors),
        })),
      };
    },
    database: () => databaseReading(db, dbFile),
  };
}

export function createSqliteSystemHealthStore(sqlite: Database.Database): SystemHealthStore {
  return createSystemHealthStore(sqliteDb(sqlite), sqlite.name || null);
}
