import { statSync } from "node:fs";
import type Database from "better-sqlite3";
import { EtaSubmissionStatusCode, NotificationChannelState } from "@mezan/domain";

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
  outbox(): OutboxHealthReading;
  eta(recentErrorLimit: number): EtaHealthReading;
  database(): DatabaseHealthReading;
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

export function createSqliteSystemHealthStore(sqlite: Database.Database): SystemHealthStore {
  const outboxStmt = sqlite.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN j.value = @queued THEN 1 ELSE 0 END), 0) AS queued,
       COALESCE(SUM(CASE WHEN j.value = @failed THEN 1 ELSE 0 END), 0) AS failed,
       MIN(CASE WHEN j.value = @queued THEN n.created_at END) AS oldest
     FROM notification n, json_each(n.channel_status_json) j
     WHERE n.channel_status_json LIKE '%"queued"%' OR n.channel_status_json LIKE '%"failed"%'`,
  );
  const etaCounts = sqlite.prepare(`SELECT status, COUNT(*) AS c FROM eta_submission GROUP BY status`);
  const etaOldest = sqlite.prepare(
    `SELECT MIN(created_at) AS oldest FROM eta_submission WHERE status IN (@ready, @pending, @error)`,
  );
  const etaErrors = sqlite.prepare(
    `SELECT internal_id, document_type, updated_at, errors FROM eta_submission WHERE status = @error ORDER BY updated_at DESC LIMIT @limit`,
  );

  return {
    outbox() {
      const row = outboxStmt.get({ queued: NotificationChannelState.Queued, failed: NotificationChannelState.Failed }) as {
        queued: number;
        failed: number;
        oldest: string | null;
      };
      return { queued: row.queued, failed: row.failed, oldestQueuedAt: row.oldest };
    },
    eta(recentErrorLimit) {
      const counts = new Map<string, number>();
      for (const row of etaCounts.all() as { status: string; c: number }[]) counts.set(row.status, row.c);
      const oldest = etaOldest.get({
        ready: EtaSubmissionStatusCode.Ready,
        pending: EtaSubmissionStatusCode.PendingSignature,
        error: EtaSubmissionStatusCode.Error,
      }) as { oldest: string | null };
      const errors = etaErrors.all({ error: EtaSubmissionStatusCode.Error, limit: recentErrorLimit }) as {
        internal_id: string;
        document_type: string;
        updated_at: string;
        errors: string;
      }[];
      return {
        ready: counts.get(EtaSubmissionStatusCode.Ready) ?? 0,
        pendingSignature: counts.get(EtaSubmissionStatusCode.PendingSignature) ?? 0,
        error: counts.get(EtaSubmissionStatusCode.Error) ?? 0,
        submitted: counts.get(EtaSubmissionStatusCode.Submitted) ?? 0,
        oldestUnsentAt: oldest.oldest,
        recentErrors: errors.map((r) => ({
          internalId: r.internal_id,
          documentType: r.document_type,
          updatedAt: r.updated_at,
          message: firstMessage(r.errors),
        })),
      };
    },
    database() {
      const pageSize = Number(sqlite.pragma("page_size", { simple: true }));
      const pages = Number(sqlite.pragma("page_count", { simple: true }));
      const free = Number(sqlite.pragma("freelist_count", { simple: true }));
      const wal = sqlite.name && sqlite.name !== ":memory:" ? fileBytes(`${sqlite.name}-wal`) : null;
      return { dbBytes: pageSize * pages, walBytes: wal, freeListBytes: pageSize * free };
    },
  };
}
