import type { Context } from "hono";
import {
  JournalEntryAlreadyReversedError,
  JournalEntryNotFoundError,
  JournalEntryNotPostedError,
  ReversalDateBeforeOriginalError,
  recordSensitiveEvent,
  type AuditSeverity,
  type AuditSink,
} from "@mezan/domain";
import { postingRefusalResponse } from "./posting-refusal.js";
import { tenantDay } from "./tenant-day.js";

export function reversalRefusalResponse(c: Context, err: unknown): Response | null {
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof ReversalDateBeforeOriginalError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 422);
  }
  if (err instanceof JournalEntryAlreadyReversedError || err instanceof JournalEntryNotPostedError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
  if (err instanceof JournalEntryNotFoundError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 404);
  }
  return null;
}

export interface ReversalRequest {
  readonly date: string | undefined;
  readonly memo: string | undefined;
}

export async function readReversalRequest(c: Context): Promise<ReversalRequest> {
  const body = (await c.req.json().catch(() => ({}))) as { date?: unknown; memo?: unknown } | null;
  const date = typeof body?.date === "string" && body.date !== "" ? await tenantDay(c, body.date) : undefined;
  const memo = typeof body?.memo === "string" && body.memo.trim() !== "" ? body.memo.trim() : undefined;
  return { date, memo };
}

export interface DocumentReversalAudit {
  readonly module: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly actor: string;
  readonly action?: string;
  readonly severity?: AuditSeverity;
  readonly details: Record<string, unknown>;
}

export async function recordDocumentReversal(audit: AuditSink | undefined, event: DocumentReversalAudit): Promise<void> {
  if (!audit) return;
  await recordSensitiveEvent(audit, {
    module: event.module,
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action ?? "REVERSE",
    actor: event.actor,
    severity: event.severity ?? "WARNING",
    details: event.details,
  });
}
